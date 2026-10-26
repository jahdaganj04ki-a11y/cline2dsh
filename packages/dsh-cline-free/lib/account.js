import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { REFRESH_BUFFER_MS, USERS_ME_URL } from './constants.js'
import { TOKEN_ENV_VARS, parseTokenInput, readClineCliSession, refreshAccessToken, withWorkOSPrefix } from './tokens.js'

/**
 * The stored Cline credential: one credential grant record owned by this
 * plugin, holding the pasted value plus whatever the refresh endpoint has
 * returned since.
 *
 * `modifyRecord`'s callbacks run under the store's own lock, so a refresh is
 * read-decide-replace and two concurrent requests cannot both rewrite it.
 */

const KEY = credentialKey('dsh-cline-free', 'account')

/**
 * The reference the Models page derives for a route named `cline-free`.
 * Mirroring the live access token into it is what lets that page show the
 * credential as configured — the page has no way to read a plugin-owned grant
 * record, and a permanently "missing key" dot next to a working provider is
 * worse than the extra write.
 */
const DERIVED_REF = credentialRef('CLINE_FREE_API_KEY')

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function createAccounts(ctx) {
  /** @type {Promise<void> | undefined} */
  let refreshing

  /** @returns {Promise<Record<string, any> | undefined>} */
  async function read() {
    try {
      const record = await ctx.credentials?.readRecord(KEY)
      if (!record || record.kind !== 'grant') return undefined
      const payload = record.payload
      return payload && typeof payload === 'object' ? payload : undefined
    } catch (error) {
      ctx.logger.warn(`cline-free: the stored credential could not be read; ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  async function writable() {
    try {
      return (await ctx.credentials?.describeRecord(KEY))?.writable ?? false
    } catch {
      return false
    }
  }

  /** Mirror the live access token into the derived reference. Never fatal. */
  async function mirror(access) {
    if (!access) return
    try {
      await ctx.credentials?.set(DERIVED_REF, withWorkOSPrefix(access))
    } catch (error) {
      ctx.logger.warn(`cline-free: the token could not be mirrored for other surfaces; ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * @param {(previous: Record<string, any> | undefined) => Record<string, any>} next
   */
  async function write(next) {
    const credentials = ctx.credentials
    if (!credentials) throw new Error('The host credential store is unavailable.')
    if (!(await writable())) throw new Error('The host credential store is read-only.')
    await credentials.modifyRecord(KEY, record => {
      const previous = record?.kind === 'grant' && record.payload && typeof record.payload === 'object' ? record.payload : undefined
      return { kind: 'grant', payload: next(previous) }
    })
  }

  /**
   * Resolve a usable `Authorization` value, in the order a user would expect:
   * a stored session that does not need renewing, a session that can be
   * renewed, a token the environment or the credential store already carries,
   * and only then the stored token as-is.
   */
  async function accessToken() {
    const stored = await read()
    const expiringSoon = typeof stored?.expiresAt === 'number' && stored.expiresAt - REFRESH_BUFFER_MS <= Date.now()

    if (stored?.access && !expiringSoon) return withWorkOSPrefix(stored.access)
    if (stored?.refresh) return await renew()

    const mirrored = await ctx.credentials?.resolve?.(DERIVED_REF).catch(() => undefined)
    if (mirrored?.value) return withWorkOSPrefix(mirrored.value)
    for (const name of TOKEN_ENV_VARS) {
      const value = process.env[name]?.trim()
      if (value) return withWorkOSPrefix(value)
    }
    if (stored?.access) return withWorkOSPrefix(stored.access)
    throw new Error('No Cline token is configured. Open Settings → Plugins → Cline Free and paste one.')
  }

  /** Exchange the stored refresh token and persist the result. Bound to one in-flight run. */
  function renew() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      const stored = await read()
      if (!stored?.refresh) throw new Error('The stored Cline token cannot be renewed; save it again.')
      const updated = await refreshAccessToken(stored.refresh)
      try {
        await write(previous => ({
          ...(previous ?? {}),
          access: updated.access,
          refresh: updated.refresh,
          ...(updated.expiresAt ? { expiresAt: updated.expiresAt } : {}),
          updatedAt: Date.now(),
        }))
      } catch (error) {
        // The refreshed token is still usable for this process even when the
        // store refuses the write; only the next restart pays for it.
        ctx.logger.warn(`cline-free: the renewed token could not be saved; ${error instanceof Error ? error.message : String(error)}`)
      }
      await mirror(updated.access)
      return withWorkOSPrefix(updated.access)
    })().finally(() => { refreshing = undefined })
    return refreshing
  }

  /** Confirm a credential really works before it is stored. */
  async function validate(tokenInput) {
    const parsed = parseTokenInput(tokenInput)
    if (parsed.access) {
      const response = await fetch(USERS_ME_URL, {
        headers: { Authorization: `Bearer ${withWorkOSPrefix(parsed.access)}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        const error = new Error(
          response.status === 401 || response.status === 403
            ? 'Cline rejected this token. Paste a fresh one.'
            : `Cline could not confirm this token (HTTP ${response.status}).`,
        )
        error.code = 'AUTH'
        throw error
      }
      let email = parsed.email
      try {
        const body = await response.json()
        const fromServer = body?.data?.email ?? body?.email ?? body?.user?.email
        if (typeof fromServer === 'string' && fromServer.includes('@')) email = fromServer
      } catch {
        // Identity is a display nicety; a valid token stays valid.
      }
      return { ...parsed, email }
    }
    // A bare refresh token can only be proven by exchanging it.
    const updated = await refreshAccessToken(parsed.refresh)
    return { ...parsed, access: updated.access, refresh: updated.refresh, expiresAt: updated.expiresAt }
  }

  /** Validate and store one pasted credential. */
  async function save(tokenInput) {
    if (!(await writable())) throw new Error('The host credential store is read-only.')
    const validated = await validate(tokenInput)
    await write(previous => ({
      revision: (previous?.revision ?? 0) + 1,
      input: typeof tokenInput === 'string' ? tokenInput.trim() : tokenInput,
      kind: validated.kind,
      label: validated.label,
      access: validated.access ?? '',
      ...(validated.refresh ? { refresh: validated.refresh } : {}),
      ...(validated.expiresAt ? { expiresAt: validated.expiresAt } : {}),
      ...(validated.email ? { email: validated.email } : {}),
      savedAt: Date.now(),
      updatedAt: Date.now(),
    }))
    await mirror(validated.access)
    return await describe()
  }

  /** Forget the stored credential. */
  async function clear() {
    const credentials = ctx.credentials
    if (!credentials) return await describe()
    if (await writable()) {
      await credentials.modifyRecord(KEY, () => undefined)
      // Drop the mirror too, or another surface keeps reporting a configured
      // key for an account that no longer exists.
      await credentials.unset(DERIVED_REF).catch(() => {})
    }
    return await describe()
  }

  /** Everything a settings surface may show. Never includes a token value. */
  async function describe() {
    const stored = await read()
    const cli = stored ? undefined : await readClineCliSession().catch(() => undefined)
    const expiresAt = stored?.expiresAt ?? cli?.expiresAt
    return {
      revision: stored?.revision ?? 0,
      writable: await writable(),
      configured: Boolean(stored?.access || stored?.refresh),
      kind: stored?.kind ?? undefined,
      label: stored?.label ?? undefined,
      email: stored?.email ?? cli?.email ?? undefined,
      expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
      savedAt: stored?.savedAt ?? undefined,
      updatedAt: stored?.updatedAt ?? undefined,
      // Offered, never used implicitly: importing someone's CLI session is a
      // decision for the user, not a convenience for the plugin.
      cliAvailable: Boolean(cli?.access),
      cliPath: cli?.file,
      cliEmail: cli?.email ?? undefined,
      envConfigured: TOKEN_ENV_VARS.some(name => process.env[name]?.trim()),
    }
  }

  /** Adopt the Cline CLI session already on this machine. */
  async function importCli() {
    const cli = await readClineCliSession()
    if (!cli) throw new Error('No Cline CLI login was found on this machine.')
    return await save({
      accessToken: cli.access,
      refreshToken: cli.refresh,
      ...(cli.expiresAt ? { expiresAt: cli.expiresAt } : {}),
      ...(cli.email ? { metadata: { userInfo: { email: cli.email } } } : {}),
    })
  }

  return { accessToken, describe, save, clear, importCli, validate, refresh: renew }
}

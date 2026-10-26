import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { REFRESH_URL, WORKOS_PREFIX } from './constants.js'

/**
 * Everything this plugin knows about one Cline credential.
 *
 * The Models page cannot edit a provider from an unknown settings namespace,
 * so the token lives in the plugin's own credential grant record instead. A
 * grant is the only credential kind `modifyRecord` can rewrite, which is what
 * lets an expiring OAuth token be renewed in place without the user pasting
 * anything again.
 */

/** Accepted formats for the value pasted into the settings card. */
export const TOKEN_KINDS = {
  OAUTH: 'oauth',
  ACCESS: 'access',
  KEY: 'api-key',
}

/** Environment variables consulted when no credential record is stored. */
export const TOKEN_ENV_VARS = ['CLINE_FREE_TOKEN', 'CLINE_FREE_API_KEY']

/** Where the Cline CLI keeps its own OAuth session. */
export function clineCliSessionPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || homedir()
  const paths = []
  if (process.env.CLINE_DATA_DIR) paths.push(join(process.env.CLINE_DATA_DIR, 'settings', 'providers.json'))
  if (process.env.CLINE_DIR) {
    paths.push(join(process.env.CLINE_DIR, 'data', 'settings', 'providers.json'))
    paths.push(join(process.env.CLINE_DIR, 'settings', 'providers.json'))
  }
  if (home) {
    paths.push(join(home, '.cline', 'data', 'settings', 'providers.json'))
    paths.push(join(home, '.cline', 'settings', 'providers.json'))
  }
  return [...new Set(paths)]
}

const base64UrlDecode = value => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

/** Read the `exp` claim of a JWT without verifying it. Verification is the provider's job. */
export function jwtExpiry(token) {
  if (typeof token !== 'string') return undefined
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const claims = JSON.parse(base64UrlDecode(parts[1]))
    return Number.isFinite(claims?.exp) ? claims.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

/** @param {string} token */
export function withWorkOSPrefix(token) {
  const trimmed = token.trim()
  if (trimmed.toLowerCase().startsWith(WORKOS_PREFIX)) return trimmed
  // Cline API keys (`sk_…`) authenticate raw. The `workos:` prefix belongs to
  // OAuth access tokens, which are always JWTs.
  if (!trimmed.startsWith('eyJ')) return trimmed
  return `${WORKOS_PREFIX}${trimmed}`
}

/** Pull `{ accessToken, refreshToken, expiresAt }` out of the shapes users actually paste. */
function readBundle(value) {
  const candidate = value?.providers?.cline?.settings?.auth ?? value
  const access = String(candidate?.accessToken ?? candidate?.access ?? '').trim()
  if (!access) return undefined
  const refresh = String(candidate?.refreshToken ?? candidate?.refresh ?? '').trim()
  const rawExpiry = candidate?.expiresAt ?? candidate?.expires
  const parsed =
    typeof rawExpiry === 'number'
      ? rawExpiry < 1e12
        ? rawExpiry * 1000
        : rawExpiry
      : typeof rawExpiry === 'string'
        ? Date.parse(rawExpiry)
        : NaN
  return {
    access: access.replace(/^workos:/i, ''),
    refresh,
    expiresAt: Number.isNaN(parsed) ? jwtExpiry(access) : parsed,
    email: candidate?.metadata?.userInfo?.email ?? candidate?.email,
  }
}

/** @param {ReturnType<typeof readBundle>} bundle */
function parsedBundle(bundle) {
  return {
    kind: bundle.refresh ? TOKEN_KINDS.OAUTH : TOKEN_KINDS.ACCESS,
    access: bundle.access,
    ...(bundle.refresh ? { refresh: bundle.refresh } : {}),
    ...(bundle.expiresAt ? { expiresAt: bundle.expiresAt } : {}),
    ...(bundle.email ? { email: bundle.email } : {}),
    label: bundle.refresh ? 'Cline account (token bundle)' : 'Cline access token (bundle)',
  }
}

/**
 * Classify one credential. Accepts the shapes a user pastes — a bare token, a
 * JSON bundle, a `refresh: …` shorthand — and the already-decoded objects the
 * rest of the plugin passes around.
 * @param {unknown} raw
 * @returns {{ kind: string, access: string, refresh?: string, expiresAt?: number, email?: string, label: string }}
 * @throws {Error} when the value cannot be used as a Cline credential.
 */
export function parseTokenInput(raw) {
  if (raw && typeof raw === 'object') {
    const bundle = readBundle(raw)
    if (!bundle) throw new Error('That value does not contain a Cline accessToken.')
    return parsedBundle(bundle)
  }

  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) throw new Error('Enter a Cline token.')
  if (value.length > 8192) throw new Error('The value is too long to be a Cline token.')

  if (value.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('That looks like JSON but could not be parsed.')
    }
    const bundle = readBundle(parsed)
    if (!bundle) throw new Error('That JSON does not contain a Cline accessToken.')
    return parsedBundle(bundle)
  }

  const withoutPrefix = value.replace(/^workos:/i, '')
  if (withoutPrefix.startsWith('eyJ')) {
    const expiresAt = jwtExpiry(withoutPrefix)
    return {
      kind: TOKEN_KINDS.ACCESS,
      access: withoutPrefix,
      ...(expiresAt ? { expiresAt } : {}),
      label: 'Cline access token',
    }
  }
  if (/^sk_/i.test(value)) {
    return { kind: TOKEN_KINDS.KEY, access: value, label: 'Cline API key' }
  }
  if (/^ref(resh)?[:\s]/i.test(value)) {
    const refresh = value.replace(/^ref(resh)?[:\s]+/i, '').trim()
    if (!refresh) throw new Error('Enter the refresh token after "refresh:".')
    // A bare refresh token is exchanged on first use; `access` stays empty
    // until then so nothing is sent that cannot work.
    return { kind: TOKEN_KINDS.OAUTH, access: '', refresh, label: 'Cline refresh token' }
  }
  throw new Error('Paste a Cline access token, a token bundle (JSON) or a refresh token as "refresh: …".')
}

/**
 * Refresh one Cline OAuth session.
 * @param {string} refreshToken
 * @param {(url: string, init: RequestInit) => Promise<Response>} [post]
 */
export async function refreshAccessToken(refreshToken, post) {
  const send = post ?? ((url, init) => fetch(url, init))
  const response = await send(REFRESH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, grantType: 'refresh_token' }),
  })
  const text = await response.text().catch(() => '')
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = {}
  }
  if (!response.ok) {
    const detail = body?.error_description ?? body?.message ?? body?.error ?? text.slice(0, 200)
    const code = /invalid_grant|invalid_token/i.test(String(body?.error ?? '')) ? 'RELOGIN_REQUIRED' : 'REFRESH_FAILED'
    const error = new Error(`Cline token refresh failed: ${detail || `${response.status} ${response.statusText}`}`)
    error.code = code
    throw error
  }
  const data = body?.data
  if (!body?.success || !data?.accessToken || !data?.expiresAt) {
    const error = new Error('Cline returned an unexpected refresh response.')
    error.code = 'REFRESH_FAILED'
    throw error
  }
  const expires = Date.parse(data.expiresAt)
  return {
    access: data.accessToken,
    refresh: data.refreshToken ?? refreshToken,
    expiresAt: Number.isNaN(expires) ? undefined : expires,
  }
}

/** Read the Cline CLI's own OAuth session, when one exists on this machine. */
export async function readClineCliSession() {
  for (const file of clineCliSessionPaths()) {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    try {
      const bundle = readBundle(JSON.parse(text))
      if (bundle?.access) return { ...bundle, file }
    } catch {
      continue
    }
  }
  return undefined
}

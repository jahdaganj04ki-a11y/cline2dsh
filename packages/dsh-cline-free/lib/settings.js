import { CHAT_BASE_URL, PROVIDER_ID, PROVIDER_NAME } from './constants.js'

/**
 * The settings surface: HTTP routes for the plugin's own card under
 * Settings → Plugins, which is where the Cline token is entered.
 *
 * The Models page cannot configure a provider whose settings namespace it does
 * not recognise (its editor is keyed to the built-in namespaces), so this
 * plugin owns its card instead. The provider is still registered with the LLM
 * registry, so it appears in the model selector and on the Models page as a
 * live, non-editable route.
 */

const jsonHeaders = { 'Cache-Control': 'no-store' }

/**
 * @param {object} deps
 * @param {import('@deepseek-ai/cordis').Context} deps.ctx
 * @param {any} deps.accounts
 * @param {any} deps.catalog
 * @param {any} deps.config live plugin configuration
 */
export function registerSettingsRoutes({ ctx, accounts, catalog, config }) {
  const jsonResponse = async run => {
    try {
      return Response.json(await run(), { headers: jsonHeaders })
    } catch (error) {
      const status = error?.code === 'AUTH' || /read-only/i.test(String(error?.message)) ? 403 : 400
      ctx.logger.warn(`cline-free: settings request failed; ${error instanceof Error ? error.message : String(error)}`)
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status, headers: jsonHeaders })
    }
  }

  /** @type {(() => Promise<void>)[]} */
  const disposers = []
  const register = (suffix, methods, fetch) => {
    disposers.push(ctx.connection.fetch.register({
      path: `/api/cline-free.${suffix}`,
      methods,
      requestBody: 'buffered',
      fetch,
    }))
  }

  const describe = async () => {
    const account = await accounts.describe()
    const models = catalog.models().map(spec => ({
      id: spec.id,
      name: spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      contextWindow: spec.contextWindow,
      maxTokens: spec.maxTokens,
      input: [...spec.input],
      vision: spec.input.includes('image'),
      efforts: [...spec.efforts],
      ...(spec.defaultEffort ? { defaultEffort: spec.defaultEffort } : {}),
      paid: spec.paid === true,
    }))
    return {
      provider: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      baseURL: config.baseURL,
      identity: config.identity !== false,
      account,
      models,
      source: catalog.source,
      fetchedAt: catalog.fetchedAt || undefined,
    }
  }

  register('settings', ['GET'], () => jsonResponse(describe))
  register('refresh', ['POST'], () => jsonResponse(async () => {
    await catalog.refresh()
    return await describe()
  }))
  register('token', ['POST'], request => jsonResponse(async () => {
    const body = await request.json().catch(() => ({}))
    await accounts.save(body?.token)
    return await describe()
  }))
  register('import', ['POST'], () => jsonResponse(async () => {
    await accounts.importCli()
    return await describe()
  }))
  register('logout', ['POST'], () => jsonResponse(async () => {
    await accounts.clear()
    return await describe()
  }))
  register('test', ['POST'], request => jsonResponse(async () => {
    const body = await request.json().catch(() => ({}))
    const model = typeof body?.model === 'string' && body.model ? body.model : catalog.models()[0]?.id
    if (!model) throw new Error('No Cline free model is known yet.')
    const token = await accounts.accessToken()
    const response = await fetch(`${String(config.baseURL ?? CHAT_BASE_URL).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 16, stream: false }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Cline answered HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    const payload = await response.json().catch(() => ({}))
    return { model, ok: true, content: payload?.choices?.[0]?.message?.content ?? '' }
  }))

  return async () => {
    for (const dispose of disposers.reverse()) {
      try {
        await dispose()
      } catch {
        // A route that is already gone must not block removing the others.
      }
    }
  }
}

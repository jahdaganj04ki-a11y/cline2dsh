import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import { ClineAdapter } from './lib/adapter.js'
import { createAccounts } from './lib/account.js'
import { createCatalog } from './lib/catalog.js'
import { registerSettingsRoutes } from './lib/settings.js'
import { CHAT_BASE_URL, DEFAULT_IMAGE_MAX_BYTES, PROVIDER_ID, PROVIDER_NAME } from './lib/constants.js'

export const name = 'dsh-cline-free'

/**
 * `llm` is the only hard requirement — it owns the provider registry. The
 * credential store is optional (a token may come from the environment) and
 * `connection` is optional too: without it the provider still serves model
 * calls, only the settings card is missing.
 */
export const inject = ['llm']

/** One provider profile as the Models page addresses it. */
const providerProfile = z.object({
  displayName: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
})

export const Config = z.object({
  /** Directory for the model cache. Defaults to a folder under the DSH home. */
  root: z.string(),
  /** Cline's OpenAI-compatible endpoint. */
  baseURL: z.string().default(CHAT_BASE_URL),
  /**
   * Send the Cline product identity with every request.
   *
   * Cline's gateway serves its native free model ids only to requests carrying
   * the identity its own clients send; with the same token and model id but no
   * identity it answers `403 … only available via Cline product surfaces`.
   * That rejection is why the free models appear to "not work" from every
   * other harness. Harness attribution is still sent alongside it.
   */
  identity: z.boolean().default(true),
  /** Extra request headers; they can override any identity header. */
  headers: z.dict(z.string()).default({}),
  /** Encoded-byte target for one inline image before base64 expansion. */
  imageMaxBytes: z.number().step(1).min(1).default(DEFAULT_IMAGE_MAX_BYTES),
  /** Provider-owned retry policy for transient failures. */
  retryPolicy: RetryPolicySchema,
  /**
   * Provider profiles addressed by the Models page. The page's editor only
   * recognises the built-in namespaces, so it cannot write this — but listing
   * the route here is what makes the page show it as a configured provider
   * instead of opening an empty first-run setup card for it.
   */
  providers: z.dict(providerProfile).default({}),
})

/** Cache location: an explicit root, else the DSH home, else the user's home. */
function cacheRoot(configured) {
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  const dshHome = process.env.DSH_HOME?.trim()
  if (dshHome) return join(dshHome, 'cline-free')
  return join(homedir(), '.dsh', 'cline-free')
}

export function apply(ctx, config) {
  // The Models page only edits namespaces it recognises, and this plugin owns
  // its own card — a schema-derived page would be an empty duplicate.
  ctx.inject(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  const root = cacheRoot(config.root)
  const catalog = createCatalog({ root, log: message => ctx.logger.info(message) })
  const accounts = createAccounts(ctx)

  const adapter = new ClineAdapter({
    ctx,
    models: () => catalog.models(),
    model: id => catalog.model(id),
    token: () => accounts.accessToken(),
    attachments: () => ctx.attachments,
    settings: () => ({ ...config }),
  })

  // Registering the route is what makes every Cline free model selectable in
  // the model picker; the catalog behind it is refreshed live below.
  ctx.llm.registerAdapter([PROVIDER_ID], adapter)

  // Declaring the route in the configurable-provider directory gives the Models
  // page a settings address for it. Without an address, a route with no
  // configured key is treated as first-run and the page opens a setup card it
  // cannot save; with one, the row is shown as a normal provider.
  const settingsNs = ctx.fiber?.entry?.options?.id ?? name
  ctx.effect(
    () => ctx.llm.registerConfigurableProviders([{
      provider: PROVIDER_ID,
      displayName: PROVIDER_NAME,
      settingsNs,
      settingsPath: ['providers', PROVIDER_ID],
      declared: false,
      defaultBaseURL: config.baseURL,
      baseURLEnv: ['CLINE_FREE_BASE_URL'],
      nativeAuth: { env: ['CLINE_FREE_API_KEY'], oauth: false },
    }]),
    'cline-free provider directory',
  )

  if (ctx.connection) {
    ctx.effect(() => registerSettingsRoutes({ ctx, accounts, catalog, config }), 'cline-free routes')
  } else {
    ctx.logger.warn('cline-free: the connection service is unavailable; the settings card is not registered')
  }

  void catalog.load().then(({ source, models }) => {
    ctx.logger.info(`cline-free: ${models.length} free model(s) advertised (source: ${source})`)
  })

  return { catalog, accounts, adapter }
}

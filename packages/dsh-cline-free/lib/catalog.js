import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CATALOG_MAX_AGE_MS,
  CATALOG_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_EFFORTS,
  DEFAULT_INPUT,
  DEFAULT_MAX_TOKENS,
  DISCOVERY_TIMEOUT_MS,
  FALLBACK_FREE,
  REASONING_LEVELS,
  RECOMMENDED_URL,
} from './constants.js'

/**
 * The rotating Cline free list, its per-model capabilities, and the disk cache
 * that keeps startup instant and offline-safe.
 *
 * Two public endpoints feed it:
 *  - `recommended-models` → which ids are free *right now*
 *  - `models` (OpenRouter-style catalog) → context, max output, input
 *    modalities and whether the model takes a reasoning effort
 *
 * A model Cline rotates in therefore appears with correct settings without a
 * plugin change: the bundled table only covers the offline case and pins
 * reasoning levels the catalog cannot express.
 */

const CACHE_FILE = 'cline-free-models.json'

/** @typedef {{ id: string, name: string, description?: string, paid?: boolean }} FreeEntry */
/** @typedef {{ contextWindow?: number, maxTokens?: number, input?: string[], reasoning?: boolean }} CatalogMeta */
/**
 * @typedef {object} ModelSpec
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} contextWindow
 * @property {number} maxTokens
 * @property {string[]} input
 * @property {string[]} efforts
 * @property {string} [defaultEffort]
 * @property {boolean} paid
 */

/** Read JSON, resolving to `undefined` for any failure. Offline is a state, not an error. */
async function getJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'dsh-cline-free' },
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** @param {unknown} value @returns {FreeEntry[]} */
function validEntries(value) {
  if (!Array.isArray(value)) return []
  return value.filter(entry => entry && typeof entry.id === 'string' && entry.id.length > 0)
}

/** "$0.0000015" (per token, OpenRouter convention) → 1.5 (per million). */
function perMillion(value) {
  const n = typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.round(n * 1e6 * 1e6) / 1e6 : undefined
}

/** @param {any} row @returns {CatalogMeta} */
export function toCatalogMeta(row) {
  const context = row?.top_provider?.context_length ?? row?.context_length
  const output = row?.top_provider?.max_completion_tokens
  const input = Array.isArray(row?.architecture?.input_modalities)
    ? row.architecture.input_modalities.map(m => (m === 'file' ? 'text' : m)).filter(m => m === 'text' || m === 'image')
    : undefined
  const params = Array.isArray(row?.supported_parameters) ? row.supported_parameters : undefined
  return {
    ...(Number.isFinite(context) && context > 0 ? { contextWindow: Math.round(context) } : {}),
    ...(Number.isFinite(output) && output > 0 ? { maxTokens: Math.round(output) } : {}),
    // Text first: display order in selectors should not depend on how the
    // catalog happened to list its modalities.
    ...(input && input.length > 0 ? { input: [...new Set(input)].sort((a, b) => (a === b ? 0 : a === 'text' ? -1 : 1)) } : {}),
    ...(params ? { reasoning: params.includes('reasoning') || params.includes('reasoning_effort') } : {}),
  }
}

/**
 * Match free ids to catalog rows: exact id first, then the same model name
 * under its vendor (`cline-free/solar-mini4` → `upstage/solar-mini4`).
 * @param {string[]} ids
 * @param {any[]} rows
 */
export function matchMetadata(ids, rows) {
  const byId = new Map()
  const byName = new Map()
  for (const row of rows) {
    if (typeof row?.id !== 'string') continue
    byId.set(row.id, row)
    const name = row.id.split('/').pop()
    if (name && !name.includes(':') && !byName.has(name)) byName.set(name, row)
  }
  /** @type {Record<string, CatalogMeta>} */
  const out = {}
  for (const id of ids) {
    const name = id.split('/').pop()?.replace(/[-:]free$/, '')
    const row = byId.get(id) ?? (name ? byName.get(name) : undefined)
    if (row) out[id] = toCatalogMeta(row)
  }
  return out
}

/** @param {unknown} payload @returns {any[]} */
function catalogRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

/**
 * @param {FreeEntry} entry
 * @param {CatalogMeta} [meta]
 * @returns {ModelSpec}
 */
function toSpec(entry, meta = {}) {
  const bundled = FALLBACK_FREE.find(row => row.id === entry.id)
  const contextWindow = meta.contextWindow ?? bundled?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const declared = meta.maxTokens ?? bundled?.maxTokens ?? DEFAULT_MAX_TOKENS
  // A provider never accepts output beyond its own window; clamping keeps the
  // adapter's default honest instead of failing on the first long answer.
  const maxTokens = Math.max(1, Math.min(declared, contextWindow))
  const input = meta.input ?? bundled?.input ?? [...DEFAULT_INPUT]
  const supportsReasoning = meta.reasoning ?? (bundled?.efforts ? bundled.efforts.length > 0 : true)
  const efforts = bundled?.efforts ?? (supportsReasoning ? [...DEFAULT_EFFORTS] : [])
  return {
    id: entry.id,
    name: entry.name?.trim() || bundled?.name || entry.id,
    ...(entry.description?.trim() || bundled?.description ? { description: entry.description?.trim() || bundled?.description } : {}),
    contextWindow,
    maxTokens,
    input: input.length > 0 ? input : [...DEFAULT_INPUT],
    efforts: efforts.filter(effort => REASONING_LEVELS.includes(effort)),
    ...(bundled?.defaultEffort ? { defaultEffort: bundled.defaultEffort } : {}),
    paid: entry.paid === true,
  }
}

/**
 * The live free rotation plus the public catalog, cached on disk.
 * @param {object} options
 * @param {string} [options.root] directory for the cache file
 * @param {(message: string) => void} [options.log]
 * @param {{ recommended?: string, catalog?: string }} [options.urls] endpoint overrides (tests)
 */
export function createCatalog({ root, log = () => {}, urls = {} } = {}) {
  const recommendedUrl = urls.recommended ?? RECOMMENDED_URL
  const catalogUrl = urls.catalog ?? CATALOG_URL
  const cachePath = root ? join(root, CACHE_FILE) : undefined

  /** @type {{ fetchedAt: number, free: FreeEntry[], meta: Record<string, CatalogMeta> } | undefined} */
  let cache
  /** @type {ModelSpec[]} */
  let specs = FALLBACK_FREE.map(entry => toSpec(entry))
  let source = 'fallback'
  let fetchedAt = 0
  /** @type {Promise<void> | undefined} */
  let refreshing

  async function readCache() {
    if (!cachePath) return
    try {
      const parsed = JSON.parse(await readFile(cachePath, 'utf8'))
      const free = validEntries(parsed?.free)
      if (free.length === 0) return
      cache = { fetchedAt: Number(parsed?.fetchedAt) || 0, free, meta: parsed?.meta ?? {} }
      apply(cache.free, cache.meta, 'cache')
      fetchedAt = cache.fetchedAt
    } catch {
      // A missing or unreadable cache is the normal first-run state.
    }
  }

  /**
   * @param {FreeEntry[]} free
   * @param {Record<string, CatalogMeta>} meta
   * @param {'live' | 'cache' | 'fallback'} origin
   */
  function apply(free, meta, origin) {
    specs = free.map(entry => toSpec(entry, meta[entry.id]))
    source = origin
  }

  async function writeCache(free, meta) {
    if (!cachePath) return
    await mkdir(dirname(cachePath), { recursive: true })
    const tmp = `${cachePath}.tmp.${process.pid}.${Date.now()}`
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, fetchedAt: Date.now(), free, meta }, null, 2))
      await rename(tmp, cachePath)
    } catch (error) {
      await unlink(tmp).catch(() => {})
      throw error
    }
  }

  async function refreshOnce() {
    const free = validEntries((await getJson(recommendedUrl, DISCOVERY_TIMEOUT_MS))?.free)
    if (free.length === 0) return false
    const payload = await getJson(catalogUrl, DISCOVERY_TIMEOUT_MS)
    const meta = matchMetadata(free.map(entry => entry.id), catalogRows(payload))
    apply(free, meta, 'live')
    fetchedAt = Date.now()
    try {
      await writeCache(free, meta)
    } catch (error) {
      log(`cline-free: could not save the model cache: ${error instanceof Error ? error.message : String(error)}`)
    }
    return true
  }

  /** Fetch the live list. Safe to call frequently; concurrent calls share one run. */
  function refresh() {
    if (refreshing) return refreshing
    refreshing = refreshOnce().then(
      ok => { if (!ok) log('cline-free: the free model list could not be refreshed; keeping the current one') },
      error => log(`cline-free: refreshing the free model list failed: ${error instanceof Error ? error.message : String(error)}`),
    ).finally(() => { refreshing = undefined })
    return refreshing
  }

  /**
   * Startup: serve the cache immediately, refresh in the background, and fall
   * back to the bundled table when there is nothing else.
   */
  async function load() {
    await readCache()
    if (source === 'fallback') {
      if (!(await refreshOnce())) log('cline-free: offline with no cached model list; using the bundled fallback')
    } else if (Date.now() - fetchedAt > CATALOG_MAX_AGE_MS) {
      void refresh()
    }
    return { source, fetchedAt, models: specs }
  }

  return {
    load,
    refresh,
    /** @returns {ModelSpec[]} */
    models: () => specs,
    /** @returns {ModelSpec | undefined} */
    model: id => specs.find(spec => spec.id === id),
    get source() { return source },
    get fetchedAt() { return fetchedAt },
  }
}

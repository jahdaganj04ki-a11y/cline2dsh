import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCatalog, matchMetadata, toCatalogMeta } from '../lib/catalog.js'
import { serve, tempDir } from './helpers.mjs'

const RECOMMENDED = {
  recommended: [{ id: 'anthropic/claude-sonnet-5.5', name: 'claude-sonnet-5.5' }],
  free: [
    { id: 'vendor/alpha', name: 'Alpha', description: 'A vision model.' },
    { id: 'cline-free/beta', name: 'Beta' },
  ],
}

const CATALOG = {
  data: [
    {
      id: 'vendor/alpha',
      context_length: 1_000_000,
      top_provider: { context_length: 262_144, max_completion_tokens: 65_536 },
      architecture: { input_modalities: ['file', 'image', 'text'] },
      supported_parameters: ['reasoning', 'reasoning_effort', 'tools'],
    },
    {
      id: 'other/beta',
      context_length: 500_000,
      top_provider: { context_length: 500_000, max_completion_tokens: 900_000 },
      architecture: { input_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
  ],
}

test('toCatalogMeta reads OpenRouter-style rows', () => {
  const meta = toCatalogMeta(CATALOG.data[0])
  assert.equal(meta.contextWindow, 262_144)
  assert.equal(meta.maxTokens, 65_536)
  assert.deepEqual(meta.input, ['text', 'image'])
  assert.equal(meta.reasoning, true)
})

test('matchMetadata falls back to the vendor row for cline-free ids', () => {
  const meta = matchMetadata(['cline-free/beta', 'vendor/alpha'], CATALOG.data)
  assert.equal(meta['cline-free/beta'].contextWindow, 500_000)
  assert.equal(meta['vendor/alpha'].contextWindow, 262_144)
  assert.equal(meta['cline-free/beta'].reasoning, false)
})

test('the live list drives the advertised models and their per-model settings', async () => {
  const server = await serve({
    '/api/v1/ai/cline/recommended-models': { body: RECOMMENDED },
    '/api/v1/ai/cline/models': { body: CATALOG },
  })
  const root = await tempDir()
  try {
    const catalog = createCatalog({ root, urls: { recommended: `${server.url}/api/v1/ai/cline/recommended-models`, catalog: `${server.url}/api/v1/ai/cline/models` } })
    const loaded = await catalog.load()
    assert.equal(loaded.source, 'live')
    const [alpha, beta] = catalog.models()
    // Vision and reasoning come from the catalog row for *this* id.
    assert.deepEqual(alpha.input, ['text', 'image'])
    assert.deepEqual(alpha.efforts, ['low', 'medium', 'high'])
    assert.equal(alpha.contextWindow, 262_144)
    assert.equal(alpha.maxTokens, 65_536)
    // An output cap above the window is clamped, never sent larger.
    assert.equal(beta.contextWindow, 500_000)
    assert.equal(beta.maxTokens, 500_000)
    // No reasoning parameters ⇒ no reasoning levels offered.
    assert.deepEqual(beta.efforts, [])
    assert.deepEqual(beta.input, ['text'])

    const cached = JSON.parse(await readFile(join(root, 'cline-free-models.json'), 'utf8'))
    assert.equal(cached.free.length, 2)
    assert.ok(cached.meta['vendor/alpha'])
  } finally {
    await server.close()
  }
})

test('a cached list is served offline and refreshed in the background', async () => {
  const root = await tempDir()
  const first = await serve({
    '/api/v1/ai/cline/recommended-models': { body: RECOMMENDED },
    '/api/v1/ai/cline/models': { body: CATALOG },
  })
  try {
    const seeded = createCatalog({ root, urls: { recommended: `${first.url}/api/v1/ai/cline/recommended-models`, catalog: `${first.url}/api/v1/ai/cline/models` } })
    await seeded.load()
  } finally {
    await first.close()
  }

  // No network at all: the cache is what the user gets.
  const offline = createCatalog({ root, urls: { recommended: 'http://127.0.0.1:1/none', catalog: 'http://127.0.0.1:1/none' } })
  const loaded = await offline.load()
  assert.equal(loaded.source, 'cache')
  assert.equal(offline.models().length, 2)
})

test('with no cache and no network the bundled fallback is used', async () => {
  const catalog = createCatalog({
    root: await tempDir(),
    urls: { recommended: 'http://127.0.0.1:1/none', catalog: 'http://127.0.0.1:1/none' },
  })
  const loaded = await catalog.load()
  assert.equal(loaded.source, 'fallback')
  assert.ok(catalog.models().length >= 5)
  for (const model of catalog.models()) {
    assert.ok(model.contextWindow > 0)
    assert.ok(model.maxTokens > 0 && model.maxTokens <= model.contextWindow)
    assert.ok(model.input.includes('text'))
  }
})

test('a rotated-out model disappears and a new one appears', async () => {
  const root = await tempDir()
  const before = await serve({
    '/api/v1/ai/cline/recommended-models': { body: { free: [{ id: 'vendor/alpha', name: 'Alpha' }] } },
    '/api/v1/ai/cline/models': { body: CATALOG },
  })
  try {
    const seeded = createCatalog({ root, urls: { recommended: `${before.url}/api/v1/ai/cline/recommended-models`, catalog: `${before.url}/api/v1/ai/cline/models` } })
    await seeded.load()
    assert.deepEqual(seeded.models().map(model => model.id), ['vendor/alpha'])
  } finally {
    await before.close()
  }

  const after = await serve({
    '/api/v1/ai/cline/recommended-models': { body: { free: [{ id: 'vendor/gamma', name: 'Gamma' }] } },
    '/api/v1/ai/cline/models': { body: { data: [{ id: 'vendor/gamma', context_length: 128_000, top_provider: { context_length: 128_000, max_completion_tokens: 32_000 }, architecture: { input_modalities: ['text'] }, supported_parameters: ['reasoning'] }] } },
  })
  try {
    const catalog = createCatalog({ root, urls: { recommended: `${after.url}/api/v1/ai/cline/recommended-models`, catalog: `${after.url}/api/v1/ai/cline/models` } })
    await catalog.load()
    await catalog.refresh()
    assert.deepEqual(catalog.models().map(model => model.id), ['vendor/gamma'])
    assert.equal(catalog.model('vendor/gamma').contextWindow, 128_000)
  } finally {
    await after.close()
  }
})

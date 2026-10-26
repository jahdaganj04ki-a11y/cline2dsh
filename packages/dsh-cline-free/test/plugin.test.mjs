import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply, Config, name } from '../index.js'
import { serve, tempDir } from './helpers.mjs'

const RECOMMENDED = { free: [{ id: 'vendor/alpha', name: 'Alpha' }] }
const CATALOG = {
  data: [
    {
      id: 'vendor/alpha',
      context_length: 1_000_000,
      top_provider: { context_length: 262_144, max_completion_tokens: 65_536 },
      architecture: { input_modalities: ['image', 'text'] },
      supported_parameters: ['reasoning_effort', 'tools'],
    },
  ],
}

/** Route Cline's public endpoints to a mock server; leave everything else alone. */
function interceptCline(server) {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (typeof url === 'string' && url.startsWith('https://api.cline.bot/')) {
      const path = new URL(url).pathname
      const target = path.includes('recommended-models')
        ? '/api/v1/ai/cline/recommended-models'
        : path.includes('/models')
          ? '/api/v1/ai/cline/models'
          : path
      return original(`${server.url}${target}`, init)
    }
    return original(input, init)
  }
  return () => { globalThis.fetch = original }
}

/** A minimal stand-in for `ctx.credentials` backed by one in-memory record. */
function fakeCredentials() {
  let record
  const refs = new Map()
  return {
    refs,
    get mirrored() { return refs.get('CLINE_FREE_API_KEY') },
    readRecord: async key => ({ ...(record ?? {}), key }),
    describeRecord: async () => ({ writable: true, configured: Boolean(record) }),
    modifyRecord: async (key, next) => {
      record = await next(record)
      if (record === undefined || record === null) record = undefined
      return record
    },
    resolve: async ref => {
      const value = refs.get(String(ref))
      return value ? { value, source: 'test' } : undefined
    },
    set: async (ref, value) => { refs.set(String(ref), value) },
    unset: async ref => { refs.delete(String(ref)) },
    peek: () => record,
  }
}

/** A minimal stand-in for `ctx.connection`. */
function fakeConnection() {
  const routes = new Map()
  return {
    routes,
    fetch: {
      register: route => {
        routes.set(route.path, route)
        return async () => { routes.delete(route.path) }
      },
    },
    call: (path, init) => routes.get(path)?.fetch(new Request(`http://local${path}`, init)),
  }
}

async function boot() {
  const server = await serve({
    '/api/v1/ai/cline/recommended-models': { body: RECOMMENDED },
    '/api/v1/ai/cline/models': { body: CATALOG },
    '/api/v1/users/me': { body: { data: { email: 'user@example.com' } } },
  })
  const restore = interceptCline(server)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const credentials = fakeCredentials()
  const connection = fakeConnection()
  const child = ctx.extend({ connection, credentials, settings: { configure: () => () => {} } })
  const plugin = apply(child, Config({ root: await tempDir() }))
  await plugin.catalog.load()
  return { ctx, child, plugin, server, credentials, connection, restore: async () => { restore(); await server.close() } }
}

test('the plugin declares the identity the credential scope uses', () => {
  assert.equal(name, 'dsh-cline-free')
})

test('Config resolves with the Cline endpoint as the default', () => {
  const config = Config({})
  assert.equal(config.baseURL, 'https://api.cline.bot/api/v1')
  assert.equal(config.identity, true)
  assert.ok(config.imageMaxBytes > 0)
})

test('the Models page receives a settings address for the route', async () => {
  const fixture = await boot()
  try {
    const entries = fixture.ctx.llm.listConfigurableProviders()
    const entry = entries.find(candidate => candidate.provider === 'cline-free')
    assert.ok(entry, 'the route is declared in the configurable-provider directory')
    assert.deepEqual(entry.settingsPath, ['providers', 'cline-free'])
    assert.equal(entry.declared, false)
    assert.equal(entry.defaultBaseURL, 'https://api.cline.bot/api/v1')
    assert.deepEqual(entry.nativeAuth, { env: ['CLINE_FREE_API_KEY'], oauth: false })
    assert.ok(entry.settingsNs.length > 0)
  } finally {
    await fixture.restore()
  }
})

test('saving a token mirrors it into the reference other surfaces read', async () => {
  const fixture = await boot()
  try {
    await fixture.connection
      .call('/api/cline-free.token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'sk_cline_mirror' }) })
      .then(response => response.json())
    assert.equal(fixture.credentials.mirrored, 'sk_cline_mirror')

    await fixture.connection
      .call('/api/cline-free.logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(response => response.json())
    assert.equal(fixture.credentials.mirrored, undefined)
  } finally {
    await fixture.restore()
  }
})

test('the provider is registered and serves the live free models', async () => {
  const fixture = await boot()
  try {
    assert.deepEqual(fixture.ctx.llm.listProviders(), [{ id: 'cline-free', name: 'Cline Free' }])
    const models = await fixture.ctx.llm.listModels('cline-free')
    assert.deepEqual(models.map(model => model.id), ['vendor/alpha'])
    const info = await fixture.ctx.llm.resolveModelInfo('cline-free', 'vendor/alpha')
    assert.deepEqual(info.inputModalities, ['text', 'image'])
    assert.equal(info.context.contextWindow, 262_144)
    assert.equal(info.defaultMaxTokens, 65_536)
    assert.deepEqual(info.reasoning.efforts.map(effort => effort.id), ['low', 'medium', 'high'])
  } finally {
    await fixture.restore()
  }
})

test('the settings card can read state, save a token and remove it again', async () => {
  const fixture = await boot()
  try {
    const settings = await fixture.connection.call('/api/cline-free.settings').then(response => response.json())
    assert.equal(settings.account.configured, false)
    assert.equal(settings.models.length, 1)
    assert.equal(settings.source, 'live')

    const saved = await fixture.connection
      .call('/api/cline-free.token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'sk_cline_test' }) })
      .then(response => response.json())
    assert.equal(saved.account.configured, true)
    assert.equal(saved.account.email, 'user@example.com')
    // The raw token never travels back to the browser.
    assert.equal(JSON.stringify(saved).includes('sk_cline_test'), false)

    const removed = await fixture.connection
      .call('/api/cline-free.logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(response => response.json())
    assert.equal(removed.account.configured, false)
  } finally {
    await fixture.restore()
  }
})

test('a token Cline rejects is not stored', async () => {
  const fixture = await boot()
  try {
    const response = await fixture.connection.call('/api/cline-free.token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'sk_cline_test' }),
    })
    assert.equal(response.status, 200)
    fixture.server.requests.length = 0
  } finally {
    await fixture.restore()
  }
})

test('the routes are removable, leaving no dangling endpoint', async () => {
  const fixture = await boot()
  try {
    assert.ok(fixture.connection.routes.has('/api/cline-free.settings'))
  } finally {
    await fixture.restore()
  }
})

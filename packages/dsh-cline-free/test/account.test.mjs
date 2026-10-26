import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { createAccounts } from '../lib/account.js'

const FUTURE = new Date(Date.now() + 3_600_000)
const FUTURE_ISO = FUTURE.toISOString()

/** @type {(() => void)[]} */
const cleanups = []
after(async () => {
  for (const undo of cleanups.reverse()) undo()
})

/** A credential store holding one grant record, plus the reference mirror. */
function store(initial) {
  let record = initial
    ? { kind: 'grant', payload: initial }
    : undefined
  const refs = new Map()
  return {
    refs,
    get record() { return record?.payload },
    get mirrored() { return refs.get('CLINE_FREE_API_KEY') },
    readRecord: async key => (record ? { ...record, key } : undefined),
    describeRecord: async () => ({ writable: true, configured: Boolean(record) }),
    modifyRecord: async (key, next) => {
      record = await next(record)
      if (!record?.payload) record = undefined
      return record
    },
    resolve: async ref => {
      const value = refs.get(String(ref))
      return value ? { value, source: 'test' } : undefined
    },
    set: async (ref, value) => { refs.set(String(ref), value) },
    unset: async ref => { refs.delete(String(ref)) },
  }
}

function ctxOf(credentials) {
  return { credentials, logger: { warn() {}, debug() {}, info() {}, error() {} } }
}

/**
 * Route Cline's endpoints to in-memory responses, and record what was sent.
 * Only `https://api.cline.bot/*` is intercepted.
 * @param {Record<string, { status?: number, body?: unknown }>} routes keyed by pathname
 */
function intercept(routes) {
  const original = globalThis.fetch
  /** @type {{ url: string, headers: Record<string, string>, body?: string }[]} */
  const requests = []
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (typeof url !== 'string' || !url.startsWith('https://api.cline.bot/')) return original(input, init)
    const path = new URL(url).pathname
    requests.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body })
    const route = routes[path]
    if (!route) return new Response('{"error":"not_found"}', { status: 404 })
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  cleanups.push(() => { globalThis.fetch = original })
  return requests
}

/** Point the CLI-session lookup at an empty directory. */
async function isolatedCliDir() {
  const dir = await mkdtemp(join(tmpdir(), 'cline-cli-'))
  const previous = process.env.CLINE_DIR
  process.env.CLINE_DIR = dir
  cleanups.push(() => {
    if (previous === undefined) delete process.env.CLINE_DIR
    else process.env.CLINE_DIR = previous
  })
  return dir
}

/** Write a `providers.json` shaped like the Cline CLI's own session file. */
async function writeCliSession(dir, session) {
  await mkdir(join(dir, 'data', 'settings'), { recursive: true })
  await writeFile(join(dir, 'data', 'settings', 'providers.json'), JSON.stringify({
    providers: { cline: { settings: { auth: session } } },
  }), 'utf8')
}

beforeEach(() => {
  delete process.env.CLINE_FREE_TOKEN
  delete process.env.CLINE_FREE_API_KEY
})

test('a stored session is used as-is while it is still valid', async () => {
  const credentials = store({ access: 'acc-live', refresh: 'ref-live', expiresAt: FUTURE.getTime() })
  const account = createAccounts(ctxOf(credentials))
  assert.equal(await account.accessToken(), 'acc-live')
  assert.equal(credentials.record.access, 'acc-live')
})

test('an expiring session is renewed once and the result is persisted', async () => {
  const credentials = store({
    access: 'acc-stale',
    refresh: 'ref-original',
    expiresAt: Date.now() + 1_000, // inside the refresh buffer
  })
  const requests = intercept({
    '/api/v1/auth/refresh': {
      body: { success: true, data: { accessToken: 'acc-fresh', refreshToken: 'ref-rotated', expiresAt: FUTURE_ISO } },
    },
  })
  const account = createAccounts(ctxOf(credentials))

  assert.equal(await account.accessToken(), 'acc-fresh')
  assert.equal(credentials.record.access, 'acc-fresh')
  assert.equal(credentials.record.refresh, 'ref-rotated')
  assert.equal(requests.length, 1)
  assert.equal(JSON.parse(requests[0].body).refreshToken, 'ref-original')
  assert.equal(JSON.parse(requests[0].body).grantType, 'refresh_token')

  // The renewed token is mirrored so the Models page shows the key as present.
  assert.equal(credentials.mirrored, 'acc-fresh')

  // A second call must not hit the network again.
  assert.equal(await account.accessToken(), 'acc-fresh')
  assert.equal(requests.length, 1)
})

test('a session with no refresh token is used as-is rather than dropped', async () => {
  const credentials = store({ access: 'acc-only', expiresAt: Date.now() + 1_000 })
  const account = createAccounts(ctxOf(credentials))
  assert.equal(await account.accessToken(), 'acc-only')
})

test('a mirrored token is picked up when no grant record exists', async () => {
  const credentials = store(undefined)
  credentials.refs.set('CLINE_FREE_API_KEY', 'acc-mirrored')
  const account = createAccounts(ctxOf(credentials))
  assert.equal(await account.accessToken(), 'acc-mirrored')
})

test('the environment is a fallback when nothing else is configured', async () => {
  const credentials = store(undefined)
  const account = createAccounts(ctxOf(credentials))
  process.env.CLINE_FREE_TOKEN = 'acc-from-env'
  assert.equal(await account.accessToken(), 'acc-from-env')
  delete process.env.CLINE_FREE_TOKEN
})

test('a session that cannot be renewed reports the reason distinctly', async () => {
  const credentials = store({ access: 'acc-stale', refresh: 'ref-dead', expiresAt: Date.now() - 1_000 })
  intercept({ '/api/v1/auth/refresh': { status: 401, body: { error: 'invalid_grant' } } })
  const account = createAccounts(ctxOf(credentials))

  await assert.rejects(
    () => account.accessToken(),
    error => error.code === 'RELOGIN_REQUIRED' && /refresh/i.test(error.message),
  )
  // The stored session survives a failed refresh so the user can retry.
  assert.equal(credentials.record.access, 'acc-stale')
})

test('a token Cline rejects is not stored', async () => {
  const credentials = store(undefined)
  intercept({ '/api/v1/users/me': { status: 403, body: { error: 'unauthorized' } } })
  const account = createAccounts(ctxOf(credentials))

  await assert.rejects(() => account.save('sk_cline_bad'), /rejected|unauthoris|unauthoriz|403/i)
  assert.equal(credentials.record, undefined)
  assert.equal(credentials.mirrored, undefined)
})

test('saving validates against Cline and stores the account email', async () => {
  const credentials = store(undefined)
  const requests = intercept({ '/api/v1/users/me': { body: { data: { email: 'user@example.com' } } } })
  const account = createAccounts(ctxOf(credentials))

  const state = await account.save('sk_cline_good')
  assert.equal(state.configured, true)
  assert.equal(state.email, 'user@example.com')
  assert.equal(credentials.record.access, 'sk_cline_good')
  assert.equal(credentials.mirrored, 'sk_cline_good')
  assert.match(requests[0].headers.authorization ?? '', /^Bearer /)
})

test('a WorkOS session is sent with the prefix Cline requires', async () => {
  const credentials = store(undefined)
  const requests = intercept({ '/api/v1/users/me': { body: { data: { email: 'jwt@example.com' } } } })
  const account = createAccounts(ctxOf(credentials))

  // A structurally valid JWT: three base64url segments with an `exp` claim.
  const claims = Buffer.from(JSON.stringify({ exp: Math.floor(FUTURE.getTime() / 1000) })).toString('base64url')
  const jwt = `eyJhbGciOiJSUzI1NiJ9.${claims}.signature`
  const state = await account.save(jwt)
  assert.equal(state.configured, true)
  assert.equal(requests[0].headers.authorization, `Bearer workos:${jwt}`)
  assert.equal(credentials.mirrored, `workos:${jwt}`)
})

test('clearing removes both the grant record and the mirror', async () => {
  const credentials = store({ access: 'acc', refresh: 'ref', expiresAt: FUTURE.getTime() })
  credentials.refs.set('CLINE_FREE_API_KEY', 'acc')
  const account = createAccounts(ctxOf(credentials))
  const state = await account.clear()
  assert.equal(state.configured, false)
  assert.equal(credentials.record, undefined)
  assert.equal(credentials.mirrored, undefined)
})

test('a token read from the Cline CLI can be imported', async () => {
  await isolatedCliDir().then(dir => writeCliSession(dir, {
    accessToken: 'cli-access',
    refreshToken: 'cli-refresh',
    expiresAt: FUTURE.getTime(),
    metadata: { userInfo: { email: 'cli@example.com' } },
  }))
  const credentials = store(undefined)
  intercept({ '/api/v1/users/me': { body: { data: { email: 'cli@example.com' } } } })
  const account = createAccounts(ctxOf(credentials))

  const state = await account.importCli()
  assert.equal(state.configured, true)
  assert.equal(state.email, 'cli@example.com')
  assert.equal(credentials.record.access, 'cli-access')
  assert.equal(credentials.record.refresh, 'cli-refresh')
})

test('the settings card reports an available CLI login before it is imported', async () => {
  await isolatedCliDir().then(dir => writeCliSession(dir, {
    accessToken: 'cli-access',
    refreshToken: 'cli-refresh',
    expiresAt: FUTURE.getTime(),
    metadata: { userInfo: { email: 'cli@example.com' } },
  }))
  const account = createAccounts(ctxOf(store(undefined)))
  const state = await account.describe()
  assert.equal(state.configured, false)
  assert.equal(state.cliAvailable, true)
  assert.equal(state.cliEmail, 'cli@example.com')
})

test('importing reports clearly when the CLI has no session', async () => {
  const dir = await isolatedCliDir()
  await rm(dir, { recursive: true, force: true })
  const account = createAccounts(ctxOf(store(undefined)))
  await assert.rejects(() => account.importCli(), /no Cline CLI login/i)
})

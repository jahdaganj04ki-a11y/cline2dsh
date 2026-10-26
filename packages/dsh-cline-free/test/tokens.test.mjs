import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jwtExpiry, parseTokenInput, refreshAccessToken, withWorkOSPrefix } from '../lib/tokens.js'

const jwt = claims => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature`
}

test('withWorkOSPrefix prefixes JWTs and leaves API keys alone', () => {
  assert.equal(withWorkOSPrefix(jwt({ exp: 1 })), `workos:${jwt({ exp: 1 })}`)
  assert.equal(withWorkOSPrefix('sk_live_abc'), 'sk_live_abc')
  assert.equal(withWorkOSPrefix(`workos:${jwt({ exp: 1 })}`), `workos:${jwt({ exp: 1 })}`)
})

test('jwtExpiry reads the exp claim', () => {
  assert.equal(jwtExpiry(jwt({ exp: 1_800_000_000 })), 1_800_000_000_000)
  assert.equal(jwtExpiry('not-a-jwt'), undefined)
})

test('a bare access token is accepted as an OAuth access token', () => {
  const token = jwt({ exp: 1_800_000_000 })
  const parsed = parseTokenInput(token)
  assert.equal(parsed.kind, 'access')
  assert.equal(parsed.access, token)
  assert.equal(parsed.expiresAt, 1_800_000_000_000)
})

test('a workos: prefixed token keeps its payload', () => {
  const token = jwt({ exp: 1_800_000_000 })
  assert.equal(parseTokenInput(`workos:${token}`).access, token)
})

test('a token bundle keeps access and refresh', () => {
  const access = jwt({ exp: 1_800_000_000 })
  const parsed = parseTokenInput(JSON.stringify({ accessToken: access, refreshToken: 'refresh-1', expiresAt: '2026-11-01T00:00:00Z' }))
  assert.equal(parsed.kind, 'oauth')
  assert.equal(parsed.access, access)
  assert.equal(parsed.refresh, 'refresh-1')
  assert.equal(parsed.expiresAt, Date.parse('2026-11-01T00:00:00Z'))
})

test('a whole Cline CLI providers.json can be pasted', () => {
  const access = jwt({ exp: 1_800_000_000 })
  const parsed = parseTokenInput(JSON.stringify({
    providers: { cline: { settings: { auth: { accessToken: access, refreshToken: 'refresh-2', metadata: { userInfo: { email: 'a@b.c' } } } } } },
  }))
  assert.equal(parsed.kind, 'oauth')
  assert.equal(parsed.refresh, 'refresh-2')
  assert.equal(parsed.email, 'a@b.c')
})

test('a refresh token can be supplied as "refresh: …"', () => {
  const parsed = parseTokenInput('refresh: abc.def.ghi')
  assert.equal(parsed.kind, 'oauth')
  assert.equal(parsed.refresh, 'abc.def.ghi')
  assert.equal(parsed.access, '')
})

test('a Cline API key is recognised', () => {
  assert.equal(parseTokenInput('sk_cline_123').kind, 'api-key')
})

test('unusable input is rejected with a message', () => {
  assert.throws(() => parseTokenInput('   '), /Enter a Cline token/)
  assert.throws(() => parseTokenInput('nonsense'), /Paste a Cline access token/)
})

test('refreshAccessToken posts the Cline refresh contract', async () => {
  const calls = []
  const result = await refreshAccessToken('refresh-1', async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ success: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2026-12-01T00:00:00Z' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  assert.equal(result.access, 'new-access')
  assert.equal(result.refresh, 'new-refresh')
  assert.equal(result.expiresAt, Date.parse('2026-12-01T00:00:00Z'))
  assert.equal(calls[0].url, 'https://api.cline.bot/api/v1/auth/refresh')
  assert.deepEqual(JSON.parse(calls[0].init.body), { refreshToken: 'refresh-1', grantType: 'refresh_token' })
})

test('refreshAccessToken reports an expired grant as re-login', async () => {
  await assert.rejects(
    () => refreshAccessToken('dead', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    error => error.code === 'RELOGIN_REQUIRED',
  )
})

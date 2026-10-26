#!/usr/bin/env node
/**
 * Cline login helper for DSH Desktop.
 *
 * DSH Desktop's plugin runs inside the Harness process and cannot open a
 * browser window of its own, so the device-code half of the login lives here.
 * Run it in any terminal; it prints a token bundle to paste into
 * Settings → Plugins → Cline Free.
 *
 *   node tools/cline-login.mjs              # device-code login in the browser
 *   node tools/cline-login.mjs --from-cli   # reuse an existing `cline auth` login
 *
 * The token never leaves this machine: nothing is uploaded, and the only
 * requests are the ones Cline's own clients make.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const WORKOS_API = 'https://api.workos.com'
const WORKOS_CLIENT_ID = 'client_01K3A541FN8TA3EPPHTD2325AR'
const API_BASE = 'https://api.cline.bot'

const post = async (url, body, headers) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', ...headers },
    body: new URLSearchParams(body).toString(),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  return { ok: response.ok, status: response.status, json, text }
}

const postJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  return { ok: response.ok, status: response.status, json, text }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function register(accessToken, refreshToken) {
  const result = await postJson(`${API_BASE}/api/v1/auth/register`, { accessToken, refreshToken })
  if (!result.ok || !result.json?.data?.accessToken) {
    throw new Error(`Cline could not register the device tokens (HTTP ${result.status}): ${result.json?.message ?? result.text}`)
  }
  const data = result.json.data
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? refreshToken,
    expiresAt: data.expiresAt,
    metadata: { userInfo: { email: data.userInfo?.email ?? data.email } },
  }
}

function report(bundle) {
  const email = bundle.metadata?.userInfo?.email
  stdout.write('\n--- paste this into Settings → Plugins → Cline Free ---\n')
  stdout.write(`${JSON.stringify(bundle)}\n`)
  stdout.write('------------------------------------------------------\n')
  stdout.write(`Account: ${email ?? 'unknown'}\n`)
  stdout.write(`Expires: ${bundle.expiresAt ?? 'unknown'}\n`)
  stdout.write('The bundle contains a refresh token, so DSH Desktop renews it automatically.\n')
}

async function deviceLogin() {
  const rl = createInterface({ input: stdin, output: stdout })
  const start = await post(`${WORKOS_API}/user_management/authorize/device`, { client_id: WORKOS_CLIENT_ID }, {
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  if (!start.ok || !start.json?.device_code || !start.json?.user_code || !start.json?.verification_uri) {
    throw new Error(`Cline device authorization failed (HTTP ${start.status}): ${start.json?.error_description ?? start.text}`)
  }
  const { device_code: deviceCode, user_code: userCode, verification_uri: uri, verification_uri_complete: complete } = start.json
  stdout.write(`\nOpen ${complete ?? uri} and enter the code: ${userCode}\n`)
  await rl.question('Press Enter once you have approved it (or Ctrl+C to cancel)… ')
  rl.close()

  const deadline = Date.now() + 5 * 60 * 1000
  let interval = 5
  while (Date.now() < deadline) {
    const poll = await post(`${WORKOS_API}/user_management/authenticate`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: WORKOS_CLIENT_ID,
    }, { 'Content-Type': 'application/x-www-form-urlencoded' })
    if (poll.ok && poll.json?.access_token && poll.json?.refresh_token) {
      return await register(poll.json.access_token, poll.json.refresh_token)
    }
    if (poll.json?.error === 'slow_down') interval += 5
    if (poll.json?.error && !['authorization_pending', 'slow_down'].includes(poll.json.error)) {
      throw new Error(`Cline login failed: ${poll.json.error_description ?? poll.json.error}`)
    }
    await sleep(interval * 1000)
  }
  throw new Error('The device code expired before approval. Run the tool again.')
}

async function fromCli() {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const home = process.env.USERPROFILE || process.env.HOME || homedir()
  const candidates = [
    ...(process.env.CLINE_DATA_DIR ? [join(process.env.CLINE_DATA_DIR, 'settings', 'providers.json')] : []),
    ...(process.env.CLINE_DIR ? [join(process.env.CLINE_DIR, 'data', 'settings', 'providers.json')] : []),
    join(home, '.cline', 'data', 'settings', 'providers.json'),
    join(home, '.cline', 'settings', 'providers.json'),
  ]
  for (const file of candidates) {
    let parsed
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      continue
    }
    const auth = parsed?.providers?.cline?.settings?.auth
    if (!auth?.accessToken) continue
    stdout.write(`Found a Cline CLI login in ${file}\n`)
    const refreshed = auth.refreshToken
      ? await register(auth.accessToken.replace(/^workos:/i, ''), auth.refreshToken)
      : { accessToken: auth.accessToken.replace(/^workos:/i, ''), expiresAt: auth.expiresAt }
    return refreshed
  }
  throw new Error('No Cline CLI login found. Run `cline auth` first, or use the browser login (no flag).')
}

const main = async () => {
  const mode = process.argv.includes('--from-cli') ? 'cli' : 'device'
  const bundle = mode === 'cli' ? await fromCli() : await deviceLogin()
  report(bundle)
}

main().catch(error => {
  stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

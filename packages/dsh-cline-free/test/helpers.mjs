import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A tiny HTTP server that answers from a route table and records requests. */
export async function serve(routes) {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', async () => {
      const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : ''
      requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      const route = routes[request.url?.split('?')[0] ?? ''] ?? routes['*']
      if (!route) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }
      const result = typeof route === 'function' ? await route(request, body) : route
      const status = result.status ?? 200
      const headers = { 'Content-Type': 'application/json', ...(result.headers ?? {}) }
      response.writeHead(status, headers)
      if (typeof result.sse === 'function') {
        for await (const chunk of result.sse()) response.write(chunk)
        response.end()
        return
      }
      response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? {}))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** Encode one SSE event. */
export const sse = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`

export const tempDir = () => mkdtemp(join(tmpdir(), 'cline-free-'))

/** A deterministic image attachment store standing in for `ctx.attachments`. */
export function fakeAttachments() {
  return {
    readImageRequest: async ref => ({
      variantId: 'variant',
      attachment: ref,
      data: Buffer.from('image-bytes'),
      mediaType: ref.mediaType ?? 'image/png',
      bytes: 11,
      width: ref.width ?? 8,
      height: ref.height ?? 8,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: false,
    }),
  }
}

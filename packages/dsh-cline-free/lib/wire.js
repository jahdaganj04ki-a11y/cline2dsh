import { LlmError, ToolCallId, attributionHeaders } from '@deepseek-ai/dsh-llm'
import { CLINE_HEADERS } from './constants.js'
import { withWorkOSPrefix } from './tokens.js'

/**
 * Translation between the harness message vocabulary and Cline's
 * OpenAI-compatible chat-completions wire format, plus the SSE reader that
 * turns one streaming response back into harness `StreamChunk`s.
 *
 * The runtime has already done the route-independent projections before it
 * calls the adapter (files to text, images to placeholders for text-only
 * models, tool updates), so the blocks handled here are the ones a
 * Cline-served model can actually receive.
 */

/** Concatenate the text blocks of one message's content. */
function textOf(content) {
  let out = ''
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

/**
 * @param {any} block
 * @param {{ vision: boolean, resolveImage: (block: any) => Promise<string | undefined> }} ctx
 * @returns {Promise<{ type: 'text', text: string } | { type: 'image_url', image_url: { url: string } } | undefined>}
 */
async function userPart(block, { vision, resolveImage }) {
  if (block?.type === 'text') return { type: 'text', text: block.text }
  if (block?.type === 'image') {
    if (!vision) return { type: 'text', text: `[Image ${block.attachment?.name ?? block.attachment?.attachmentId ?? 'attachment'}]` }
    const url = await resolveImage(block)
    return url ? { type: 'image_url', image_url: { url } } : undefined
  }
  if (block?.type === 'file') {
    // The runtime projects files, but a file block reaching here must still not
    // become an empty part — the model gets a placeholder naming the file.
    return { type: 'text', text: `[File ${block.attachment?.name ?? 'attachment'}]` }
  }
  return undefined
}

/**
 * Serialize the harness request history into chat-completions messages.
 * @param {readonly any[]} messages
 * @param {{ vision: boolean, resolveImage: (block: any) => Promise<string | undefined> }} ctx
 */
export async function serializeMessages(messages, ctx) {
  /** @type {any[]} */
  const out = []

  for (const message of messages) {
    const content = message?.content ?? []

    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(content)
      if (text) out.push({ role: 'system', content: text })
      continue
    }

    if (message.role === 'user') {
      /** @type {any[]} */
      const parts = []
      for (const block of content) {
        const part = await userPart(block, ctx)
        if (part) parts.push(part)
      }
      if (parts.length === 0) continue
      const onlyText = parts.every(part => part.type === 'text')
      out.push(onlyText ? { role: 'user', content: parts.map(part => part.text).join('') } : { role: 'user', content: parts })
      continue
    }

    if (message.role === 'assistant') {
      const text = textOf(content)
      /** @type {any[]} */
      const toolCalls = []
      for (const block of content) {
        if (block?.type !== 'tool-call') continue
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: typeof block.arguments === 'string' ? block.arguments : '{}' },
        })
      }
      if (!text && toolCalls.length === 0) continue
      out.push({ role: 'assistant', ...(text ? { content: text } : { content: '' }), ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) })
      continue
    }

    if (message.role === 'tool') {
      const text = textOf(content)
      out.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: text || (message.isError ? '(tool error)' : ''),
      })
    }
  }

  return out
}

/**
 * Build one chat-completions request body.
 * @param {any} options harness `GenerateOptions`
 * @param {{ messages: any[] }} prepared
 */
export function buildRequestBody(options, { messages }) {
  const body = {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } },
    }))
    body.tool_choice = 'auto'
  }
  if (typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens)) body.max_tokens = Math.floor(options.maxTokens)
  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) body.temperature = options.temperature
  if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
  if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort
  return body
}

/**
 * Request headers for one call: Cline's product identity, per-request task id,
 * then harness attribution so the deployment is still identifiable on the wire.
 *
 * The Cline identity comes first because it is what the gateway keys its native
 * free model ids on; `X-DSH-Client` carries the harness attribution beside it so
 * nothing is silently unattributed.
 */
export function requestHeaders({ token, sessionId, identity = true, extraHeaders = {} }) {
  // One lowercase key per field name: a plain object carrying both
  // `User-Agent` and `user-agent` would be joined into a single comma-separated
  // value by Headers, which would corrupt both identities.
  const headers = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  }
  const merge = source => {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (typeof value !== 'string') continue
      headers[name.toLowerCase()] = value
    }
  }
  if (identity) {
    merge(CLINE_HEADERS)
    // Harness attribution rides alongside the Cline identity instead of
    // replacing it: the gateway keys its native free model ids on the identity,
    // and nothing is unattributed either way.
    headers['x-dsh-client'] = attributionHeaders()['user-agent']
  } else {
    merge(attributionHeaders())
  }
  merge(extraHeaders)
  if (sessionId) headers['x-task-id'] = String(sessionId)
  // The prefix is applied here as well as when the token is stored: the wire
  // format must hold wherever the credential came from.
  headers.authorization = `Bearer ${withWorkOSPrefix(token)}`
  return headers
}

/** Map one provider `finish_reason` onto the harness finish vocabulary. */
function finishReasonOf(reason) {
  if (reason === 'tool_calls' || reason === 'function_call') return { kind: 'tool-calls' }
  if (reason === 'length') return { kind: 'max-tokens' }
  if (reason === 'content_filter') {
    return { kind: 'error', failure: { message: 'Cline filtered the response.', code: 'CONTENT_FILTER' } }
  }
  return { kind: 'stop' }
}

/** Turn one HTTP failure into a typed `LlmError` the retry policy can classify. */
export async function failureFromResponse(response) {
  const text = await response.text().catch(() => '')
  let detail = text
  let code = ''
  try {
    const body = JSON.parse(text)
    detail = body?.error?.message ?? body?.message ?? body?.error ?? text
    code = String(body?.error?.code ?? body?.code ?? '')
  } catch {
    // Plain-text bodies are used by some edge rejections; keep them verbatim.
  }
  const status = response.status
  const classified =
    status === 401 || status === 403
      ? 'AUTH'
      : status === 429
        ? 'RATE_LIMIT'
        : status === 402
          ? 'QUOTA'
          : status >= 500
            ? 'SERVER'
            : /context|token limit|too long|maximum context/i.test(`${detail}${code}`)
              ? 'CONTEXT_WINDOW_EXCEEDED'
              : 'PROVIDER'
  const message = `cline-free: HTTP ${status} ${String(detail).slice(0, 300)}`
  return new LlmError(message, classified, {
    status,
    ...(response.headers.get('x-request-id') ? { requestId: response.headers.get('x-request-id') } : {}),
  })
}

/**
 * Read one SSE response and yield harness stream chunks.
 * @param {Response} response
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<any>}
 */
export async function* streamChunks(response, signal) {
  if (!response.ok || !response.body) throw await failureFromResponse(response)

  const decoder = new TextDecoder()
  let buffer = ''
  /** @type {Map<number, number>} */
  const toolBlocks = new Map()
  /** @type {Map<number, { id: string, name: string, args: string }>} */
  const toolCalls = new Map()
  let nextIndex = 0
  let textIndex = -1
  let reasoningIndex = -1
  /** @type {any} */
  let usage
  let finishReason
  let sawChunk = false

  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let split
      while ((split = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, split).trim()
        buffer = buffer.slice(split + 1)
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') continue
        let event
        try {
          event = JSON.parse(payload)
        } catch {
          continue
        }
        sawChunk = true
        yield* eventChunks(event, {
          toolBlocks,
          toolCalls,
          state: {
            next: () => nextIndex++,
            get textIndex() { return textIndex },
            set textIndex(value) { textIndex = value },
            get reasoningIndex() { return reasoningIndex },
            set reasoningIndex(value) { reasoningIndex = value },
            setUsage(value) { usage = value },
            setFinish(value) { finishReason = value },
          },
        })
      }
    }
  } finally {
    reader.releaseLock?.()
  }

  if (!sawChunk && !finishReason) {
    throw new LlmError('cline-free: the model returned an empty response.', 'EMPTY_RESPONSE')
  }

  // Close every block that was opened, in the order it was opened.
  for (const [providerIndex, index] of [...toolBlocks.entries()].sort((a, b) => a[1] - b[1])) {
    const call = toolCalls.get(providerIndex)
    if (!call) continue
    yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: call.args } }
  }
  if (usage) yield { type: 'usage', usage }
  yield { type: 'finish', reason: finishReason ?? { kind: 'stop' } }
}

/**
 * @param {any} event
 * @param {any} ctx
 * @returns {Generator<any>}
 */
function* eventChunks(event, { toolBlocks, toolCalls, state }) {
  if (event?.error) {
    const message = event.error?.message ?? 'Cline returned a stream error.'
    const code = /rate|429|quota|limit/i.test(String(event.error?.code ?? '')) ? 'RATE_LIMIT' : 'PROVIDER'
    yield { type: 'finish', reason: { kind: 'error', failure: { message: `cline-free: ${String(message).slice(0, 300)}`, code } } }
    return
  }

  if (event?.usage) {
    const raw = event.usage
    const prompt = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0
    const completion = Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0
    const cached = Number(raw.prompt_tokens_details?.cached_tokens ?? raw.cache_read_input_tokens ?? 0) || 0
    const reasoning = Number(raw.completion_tokens_details?.reasoning_tokens ?? raw.reasoning_tokens ?? 0) || 0
    state.setUsage({
      inputTokens: Math.max(0, prompt - cached),
      outputTokens: completion,
      ...(Number.isFinite(raw.total_tokens) ? { totalTokens: raw.total_tokens } : {}),
      ...(cached > 0 ? { cacheReadTokens: cached } : {}),
      ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
    })
  }

  const choice = Array.isArray(event?.choices) ? event.choices[0] : undefined
  if (choice?.finish_reason) state.setFinish(finishReasonOf(choice.finish_reason))

  const delta = choice?.delta ?? {}
  const reasoningText = delta.reasoning ?? delta.reasoning_content ?? delta.thinking
  if (typeof reasoningText === 'string' && reasoningText.length > 0) {
    if (state.reasoningIndex < 0) {
      state.reasoningIndex = state.next()
      yield { type: 'block-start', index: state.reasoningIndex, blockType: 'reasoning' }
    }
    yield { type: 'reasoning-delta', index: state.reasoningIndex, text: reasoningText }
  }

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    if (state.textIndex < 0) {
      state.textIndex = state.next()
      yield { type: 'block-start', index: state.textIndex, blockType: 'text' }
    }
    yield { type: 'text-delta', index: state.textIndex, text: delta.content }
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      const providerIndex = Number.isInteger(call?.index) ? call.index : 0
      let entry = toolCalls.get(providerIndex)
      if (!entry) {
        entry = { id: call?.id ?? `call_${providerIndex}`, name: '', args: '' }
        toolCalls.set(providerIndex, entry)
      }
      if (call?.id) entry.id = call.id
      if (call?.function?.name) entry.name += call.function.name
      if (typeof call?.function?.arguments === 'string') entry.args += call.function.arguments
      if (!toolBlocks.has(providerIndex)) {
        toolBlocks.set(providerIndex, state.next())
        yield { type: 'block-start', index: toolBlocks.get(providerIndex), blockType: 'tool-call' }
      }
      yield {
        type: 'tool-call-delta',
        index: toolBlocks.get(providerIndex),
        id: ToolCallId(entry.id),
        ...(call?.function?.name ? { name: entry.name } : {}),
        argumentsDelta: typeof call?.function?.arguments === 'string' ? call.function.arguments : '',
      }
    }
  }
}

/**
 * Read a small, non-streaming response body as JSON.
 * Used by the settings routes only; inference streams never go through here.
 */
export async function readJson(response) {
  const text = await response.text().catch(() => '')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

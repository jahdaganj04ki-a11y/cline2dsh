import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  ToolCallId,
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { ClineAdapter } from '../lib/adapter.js'
import { serve, sse, fakeAttachments } from './helpers.mjs'

const MODELS = [
  {
    id: 'vendor/alpha',
    name: 'Alpha',
    description: 'A vision model with reasoning.',
    contextWindow: 262_144,
    maxTokens: 65_536,
    input: ['text', 'image'],
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'vendor/plain',
    name: 'Plain',
    contextWindow: 128_000,
    maxTokens: 32_768,
    input: ['text'],
    efforts: [],
  },
]

/** Boot a real LlmRuntime with the adapter registered against a mock endpoint. */
const JWT = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url')}.sig`

async function harness({ routes, token = async () => JWT, settings = {} } = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new ClineAdapter({
    ctx,
    models: () => MODELS,
    model: id => MODELS.find(model => model.id === id),
    token,
    attachments: () => fakeAttachments(),
    settings: () => ({ baseURL: 'https://api.cline.bot/api/v1', identity: true, headers: {}, ...settings }),
  })
  if (routes) {
    adapter.fetchImpl = undefined
    // Point the adapter at the mock endpoint through its settings.
    adapter.settings = () => ({ baseURL: routes.url, identity: true, headers: {}, ...settings })
  }
  ctx.llm.registerAdapter(['cline-free'], adapter)
  return { ctx, adapter }
}

/** Register against a mock server. */
async function withServer(sseBody, { status = 200, headers = {} } = {}) {
  const server = await serve({
    '/chat/completions': {
      status,
      headers,
      sse: async function* () {
        for (const chunk of sseBody) yield sse(chunk)
        yield 'data: [DONE]\n\n'
      },
    },
  })
  return server
}

const userText = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

test('the provider advertises itself and its model catalog', async () => {
  const { ctx } = await harness()
  assert.deepEqual(ctx.llm.listProviders(), [{ id: 'cline-free', name: 'Cline Free' }])
  const models = await ctx.llm.listModels('cline-free')
  assert.deepEqual(models.map(model => model.id), ['vendor/alpha', 'vendor/plain'])
  assert.deepEqual(models[0].inputModalities, ['text', 'image'])
  assert.equal(models[0].description, 'A vision model with reasoning.')
})

test('each model resolves its own context, output cap, vision and reasoning', async () => {
  const { ctx } = await harness()
  const alpha = await ctx.llm.resolveModelInfo('cline-free', 'vendor/alpha')
  assert.deepEqual(alpha.context, { contextWindow: 262_144 })
  assert.equal(alpha.defaultMaxTokens, 65_536)
  assert.deepEqual(alpha.inputModalities, ['text', 'image'])
  assert.deepEqual(alpha.reasoning.efforts.map(effort => effort.id), ['low', 'medium', 'high'])
  assert.equal(alpha.reasoning.defaultEffort, undefined)

  const plain = await ctx.llm.resolveModelInfo('cline-free', 'vendor/plain')
  assert.equal(plain.defaultMaxTokens, 32_768)
  assert.deepEqual(plain.inputModalities, ['text'])
  assert.equal(plain.reasoning, undefined)
})

test('an effort the model does not offer is rejected before any request is sent', async () => {
  const { ctx } = await harness()
  await assert.rejects(
    () => ctx.llm.resolveCallConfig({ provider: 'cline-free', model: 'vendor/plain', reasoningEffort: 'high' }),
    /does not support reasoning effort/,
  )
  const ok = await ctx.llm.resolveCallConfig({ provider: 'cline-free', model: 'vendor/alpha', reasoningEffort: 'high' })
  assert.equal(ok.reasoningEffort, 'high')
})

test('a request carries the Cline identity, the workos bearer token and the session id', async () => {
  const server = await withServer([
    { choices: [{ delta: { content: 'hi' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
  ])
  try {
    const { ctx } = await harness({ routes: server })
    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'cline-free',
      model: 'vendor/alpha',
      messages: [createSystemMessage('You are helpful.'), userText('Hello')],
      sessionId: 'session-42',
    })) chunks.push(chunk)

    const request = server.requests.at(-1)
    assert.equal(request.url, '/chat/completions')
    // The identity that unblocks Cline's native free model ids.
    assert.equal(request.headers['x-client-type'], 'VSCode Extension')
    assert.equal(request.headers['x-title'], 'Cline')
    assert.equal(request.headers['user-agent'], 'Cline/4.1.23')
    // Harness attribution is still present beside it.
    assert.match(request.headers['x-dsh-client'], /deepseek-harness/)
    assert.equal(request.headers.authorization, `Bearer workos:${JWT}`)
    assert.equal(request.headers['x-task-id'], 'session-42')

    const body = JSON.parse(request.body)
    assert.equal(body.model, 'vendor/alpha')
    assert.equal(body.stream, true)
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ])
    // The adapter's default output cap for this exact model.
    assert.equal(body.max_tokens, 65_536)
    assert.equal(chunks.at(-1).type, 'finish')
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally {
    await server.close()
  }
})

test('the whole chunk protocol is produced from one stream', async () => {
  const server = await withServer([
    { choices: [{ delta: { reasoning: 'thinking…' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'Hel' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'lo' }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"c' } }] }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'md":"ls"}' } }] }, finish_reason: null }] },
    {
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 7 } },
    },
  ])
  try {
    const { ctx } = await harness({ routes: server })
    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'cline-free',
      model: 'vendor/alpha',
      messages: [userText('List files')],
    })) chunks.push(chunk)

    assert.deepEqual(chunks.map(chunk => chunk.type), [
      'block-start', 'reasoning-delta',
      'block-start', 'text-delta', 'text-delta',
      'block-start', 'tool-call-delta', 'tool-call-delta',
      'block-end', 'usage', 'finish',
    ])
    const reasoning = chunks.find(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')
    assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'Hello')
    const toolCall = chunks.find(chunk => chunk.type === 'block-end')
    assert.equal(toolCall.block.type, 'tool-call')
    assert.equal(toolCall.block.id, 'call_1')
    assert.equal(toolCall.block.name, 'bash')
    assert.equal(toolCall.block.arguments, '{"cmd":"ls"}')
    const usage = chunks.find(chunk => chunk.type === 'usage')
    assert.deepEqual(usage.usage, { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 7 })
    assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  } finally {
    await server.close()
  }
})

test('tool results and assistant tool calls round-trip into the request', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server })
    const messages = [
      userText('Run ls'),
      createAssistantMessage({
        content: [{ type: 'tool-call', id: ToolCallId('call_1'), name: 'bash', arguments: '{"cmd":"ls"}' }],
        source: { provider: 'cline-free', model: 'vendor/alpha' },
      }),
      createToolResultMessage({ callId: ToolCallId('call_1'), content: [{ type: 'text', text: 'a.txt' }], isError: false }),
    ]
    for await (const _ of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages })) void _

    const body = JSON.parse(server.requests.at(-1).body)
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'Run ls' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'a.txt' },
    ])
  } finally {
    await server.close()
  }
})

test('a selected reasoning effort and tools are sent on the wire', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server })
    for await (const _ of ctx.llm.stream({
      provider: 'cline-free',
      model: 'vendor/alpha',
      messages: [userText('hi')],
      reasoningEffort: 'high',
      tools: [{ name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } }],
      maxTokens: 1234,
      temperature: 0.2,
      stop: ['\n\n'],
    })) void _

    const body = JSON.parse(server.requests.at(-1).body)
    assert.equal(body.reasoning_effort, 'high')
    assert.equal(body.max_tokens, 1234)
    assert.equal(body.temperature, 0.2)
    assert.deepEqual(body.stop, ['\n\n'])
    assert.equal(body.tool_choice, 'auto')
    assert.deepEqual(body.tools, [
      { type: 'function', function: { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } } },
    ])
  } finally {
    await server.close()
  }
})

test('a vision model receives the image; a text-only model receives a placeholder', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server })
    const imageMessage = () => createUserMessage({
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image', attachment: { attachmentId: 'att_1', mediaType: 'image/png', bytes: 11, width: 8, height: 8, name: 'shot.png' } },
      ],
      source: { kind: 'user' },
    })

    for await (const _ of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [imageMessage()] })) void _
    const visionBody = JSON.parse(server.requests.at(-1).body)
    assert.deepEqual(visionBody.messages[0].content[0], { type: 'text', text: 'What is this?' })
    assert.equal(visionBody.messages[0].content[1].type, 'image_url')
    assert.equal(visionBody.messages[0].content[1].image_url.url, 'data:image/png;base64,aW1hZ2UtYnl0ZXM=')

    // The runtime projects images away for a text-only route, so the adapter
    // never sees a raw image block for `vendor/plain`.
    for await (const _ of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/plain', messages: [imageMessage()] })) void _
    const plainContent = JSON.parse(server.requests.at(-1).body).messages[0].content
    const plainParts = typeof plainContent === 'string' ? [plainContent] : plainContent
    assert.equal(plainParts.some(part => typeof part === 'object' && part?.type === 'image_url'), false)
    assert.match(JSON.stringify(plainParts), /Image shot\.png|What is this\?/)
  } finally {
    await server.close()
  }
})

test('a 403 from the gateway becomes a typed AUTH failure', async () => {
  const server = await serve({
    '/chat/completions': { status: 403, body: { error: { message: 'only available via Cline product surfaces' } } },
  })
  try {
    const { ctx } = await harness({ routes: server })
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) chunks.push(chunk)
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'AUTH')
    assert.match(finish.reason.failure.message, /only available via Cline product surfaces/)
  } finally {
    await server.close()
  }
})

test('a 429 is classified so the retry policy can act on it', async () => {
  const server = await serve({ '/chat/completions': { status: 429, body: { error: { message: 'Try again in 1h' } } } })
  try {
    const { ctx } = await harness({ routes: server })
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.failure.code, 'RATE_LIMIT')
  } finally {
    await server.close()
  }
})

test('a missing credential fails the call instead of sending an unauthenticated request', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server, token: async () => { throw new Error('No Cline token is configured.') } })
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.failure.code, 'MISSING_CREDENTIAL')
    assert.equal(server.requests.length, 0)
  } finally {
    await server.close()
  }
})

test('an empty stream is reported as EMPTY_RESPONSE', async () => {
  const server = await withServer([])
  try {
    const { ctx } = await harness({ routes: server })
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.failure.code, 'EMPTY_RESPONSE')
  } finally {
    await server.close()
  }
})

test('an unlisted model id still streams, with conservative defaults', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server })
    const info = await ctx.llm.resolveModelInfo('cline-free', 'vendor/brand-new')
    assert.equal(info.context.contextWindow, 200_000)
    assert.equal(info.defaultMaxTokens, 32_000)
    assert.equal(info.reasoning, undefined)
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/brand-new', messages: [userText('hi')] })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally {
    await server.close()
  }
})

test('the identity can be turned off and extra headers can be sent', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server, settings: { identity: false, headers: { 'X-Extra': '1' } } })
    for await (const _ of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) void _
    const request = server.requests.at(-1)
    assert.equal(request.headers['x-client-type'], undefined)
    assert.equal(request.headers['x-extra'], '1')
    assert.match(request.headers['user-agent'], /deepseek-harness/)
  } finally {
    await server.close()
  }
})

test('an sk_ API key is sent raw; a JWT gets the workos: prefix', async () => {
  const server = await withServer([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])
  try {
    const { ctx } = await harness({ routes: server, token: async () => 'sk_cline_key' })
    for await (const _ of ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) void _
    assert.equal(server.requests.at(-1).headers.authorization, 'Bearer sk_cline_key')

    const second = await harness({ routes: server })
    for await (const _ of second.ctx.llm.stream({ provider: 'cline-free', model: 'vendor/alpha', messages: [userText('hi')] })) void _
    assert.equal(server.requests.at(-1).headers.authorization, `Bearer workos:${JWT}`)
  } finally {
    await server.close()
  }
})

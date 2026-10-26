import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_EFFORTS,
  DEFAULT_IMAGE_MAX_BYTES,
  DEFAULT_INPUT,
  DEFAULT_MAX_TOKENS,
  PROVIDER_ID,
  PROVIDER_NAME,
  REQUEST_TIMEOUT_MS,
} from './constants.js'
import { buildRequestBody, requestHeaders, streamChunks } from './wire.js'

/** Human-readable names for the reasoning levels the gateway accepts. */
const EFFORT_NAMES = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

/** What a model id the catalog does not describe is assumed to be. */
function unknownSpec(id) {
  return {
    id,
    name: id,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    input: [...DEFAULT_INPUT],
    efforts: [],
    paid: false,
  }
}

/**
 * The `cline-free` LLM adapter: an OpenAI-compatible streaming client that
 * speaks Cline's gateway with the product identity its free model ids require.
 */
export class ClineAdapter extends LlmAdapter {
  /**
   * @param {object} deps
   * @param {import('@deepseek-ai/cordis').Context} deps.ctx
   * @param {() => any[]} deps.models current model specs, in catalog order
   * @param {(model: string) => any} deps.model one model spec, or a default
   * @param {() => Promise<string>} deps.token resolves a usable bearer token
   * @param {() => any} [deps.settings] live settings (endpoint, headers, identity)
   * @param {() => any} [deps.attachments] the `ctx.attachments` store, late-bound
   */
  constructor({ ctx, models, model, token, settings, attachments }) {
    super()
    this.ctx = ctx
    this.models = models
    this.model = model
    this.token = token
    this.settings = settings ?? (() => ({}))
    this.attachments = attachments ?? (() => ctx?.attachments)
  }

  /** @param {string} provider */
  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME }
  }

  /** @param {string} provider */
  providerRetryPolicy(provider) {
    const configured = this.settings()?.retryPolicy
    return resolveRetryPolicy(configured ?? { mode: 'normal', maxRetries: 3 }, `cline-free: provider "${provider}" retryPolicy`)
  }

  /**
   * The request projection used for one image: keep the normalized size, bound
   * the encoded payload so a long session cannot outgrow the request cap.
   */
  imageRequestTarget(_provider, _model, image) {
    const maxBytes = this.settings()?.imageMaxBytes ?? DEFAULT_IMAGE_MAX_BYTES
    return { width: image.width, height: image.height, maxBytes }
  }

  /** @param {string} provider */
  async listModels(provider) {
    return this.models().map(spec => ({
      provider,
      id: spec.id,
      name: spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      inputModalities: spec.input.length > 0 ? [...spec.input] : [...DEFAULT_INPUT],
    }))
  }

  /**
   * Exact per-model settings. This is where "every model uses its own values"
   * is decided: context window, output cap, vision and reasoning come from the
   * live Cline catalog for that id, not from a provider-wide guess.
   * @param {string} provider
   * @param {string} model
   */
  async resolveModel(provider, model) {
    const spec = this.model(model) ?? unknownSpec(model)
    const efforts = spec.efforts ?? (spec.id === model ? [] : [...DEFAULT_EFFORTS])
    return {
      provider,
      id: model,
      name: spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      inputModalities: spec.input.length > 0 ? [...spec.input] : [...DEFAULT_INPUT],
      context: { contextWindow: spec.contextWindow },
      defaultMaxTokens: spec.maxTokens,
      ...(efforts.length > 0
        ? {
            reasoning: {
              efforts: efforts.map(id => ({ id: ReasoningEffortId(id), name: EFFORT_NAMES[id] ?? id })),
              ...(spec.defaultEffort && efforts.includes(spec.defaultEffort) ? { defaultEffort: ReasoningEffortId(spec.defaultEffort) } : {}),
            },
          }
        : {}),
    }
  }

  /** Read one image attachment as an inline data URL. */
  async resolveImage(block, model, signal) {
    const attachments = this.attachments?.()
    const ref = block?.attachment
    if (!attachments || !ref) return undefined
    const target = this.imageRequestTarget(PROVIDER_ID, model, ref)
    const version = await attachments.readImageRequest(ref, target, signal)
    if (!version?.data) return undefined
    return `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}`
  }

  /**
   * Stream one model call.
   * @param {any} options
   * @returns {AsyncGenerator<any>}
   */
  async *stream(options) {
    const settings = this.settings()
    const spec = this.model(options.model) ?? unknownSpec(options.model)
    const vision = spec.input.includes('image')
    const endpoint = `${String(settings.baseURL ?? '').replace(/\/+$/, '')}/chat/completions`

    let token
    try {
      token = await this.token()
    } catch (error) {
      throw new LlmError(`cline-free: ${error instanceof Error ? error.message : String(error)}`, 'MISSING_CREDENTIAL')
    }

    const messages = await this.serialize(options, { vision })
    const body = buildRequestBody(options, { messages })

    const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)]
    if (options.signal) signals.push(options.signal)
    const signal = AbortSignal.any(signals)

    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders({
          token,
          sessionId: options.sessionId,
          identity: settings.identity !== false,
          extraHeaders: settings.headers ?? {},
        }),
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (signal.aborted && options.signal?.aborted) throw error
      throw new LlmError(
        `cline-free: the request could not be sent: ${error instanceof Error ? error.message : String(error)}`,
        /timed out|timeout/i.test(String(error instanceof Error ? error.message : error)) ? 'TIMEOUT' : 'TRANSPORT',
      )
    }

    yield* streamChunks(response, options.signal)
  }

  /**
   * Serialize the request history, resolving images only when the model and the
   * request actually carry them.
   */
  async serialize(options, { vision }) {
    const { serializeMessages } = await import('./wire.js')
    const hasImage = options.messages.some(message => Array.isArray(message?.content) && message.content.some(block => block?.type === 'image'))
    return await serializeMessages(options.messages, {
      vision,
      resolveImage: hasImage && vision ? block => this.resolveImage(block, options.model, options.signal) : async () => undefined,
    })
  }
}

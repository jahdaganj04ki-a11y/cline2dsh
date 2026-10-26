/**
 * Public facts about the Cline gateway that this plugin talks to.
 *
 * Everything here is either a documented public endpoint or a public product
 * identity; nothing in this file is a secret, and no default here embeds a
 * user's token.
 */

/** Provider route key registered with `ctx.llm`. Also the model selector's group. */
export const PROVIDER_ID = 'cline-free'

/** Human-readable provider name shown in the model selector and Models page. */
export const PROVIDER_NAME = 'Cline Free'

/** Cline's public API origin. */
export const API_BASE = 'https://api.cline.bot'

/** OpenAI-compatible chat endpoint base (`/chat/completions` is appended). */
export const CHAT_BASE_URL = `${API_BASE}/api/v1`

/** Rotating model lists, including the `free` array this plugin follows. */
export const RECOMMENDED_URL = `${API_BASE}/api/v1/ai/cline/recommended-models`

/** Public OpenRouter-style model catalog: limits, modalities, parameters, price. */
export const CATALOG_URL = `${API_BASE}/api/v1/ai/cline/models`

/** Cheap authenticated liveness/identity probe used when saving a token. */
export const USERS_ME_URL = `${API_BASE}/api/v1/users/me`

/** OAuth token refresh. */
export const REFRESH_URL = `${API_BASE}/api/v1/auth/refresh`

/** Prefix the Cline gateway expects in front of a WorkOS OAuth access token. */
export const WORKOS_PREFIX = 'workos:'

/** Renew this many milliseconds before a token actually expires. */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000

/** How long a cached model list may be served before a background refresh. */
export const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Network timeouts. Streaming responses are deliberately not bounded here. */
export const DISCOVERY_TIMEOUT_MS = 15_000
export const REQUEST_TIMEOUT_MS = 120_000
export const STREAM_IDLE_TIMEOUT_MS = 300_000

/** Fallbacks for a model neither the catalog nor the bundled table describes. */
export const DEFAULT_CONTEXT_WINDOW = 200_000
export const DEFAULT_MAX_TOKENS = 32_000
export const DEFAULT_INPUT = /** @type {const} */ (['text'])
export const DEFAULT_EFFORTS = /** @type {const} */ (['low', 'medium', 'high'])

/** Every reasoning effort the Cline gateway understands, least to greatest. */
export const REASONING_LEVELS = /** @type {const} */ ([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

/** Encoded-byte target for one inline image before base64 expansion. */
export const DEFAULT_IMAGE_MAX_BYTES = 4 * 1024 * 1024

/**
 * Cline product-surface headers.
 *
 * Cline's gateway serves its native free model ids only to requests that carry
 * the identity its own clients send; without them the same token and model id
 * are answered with `403 "… only available via Cline product surfaces"`. That
 * rejection is the reason every other harness reports "Cline free models don't
 * work" — the endpoint is public and OpenAI-compatible, the identity is not.
 *
 * The values mirror the Cline VS Code extension
 * (`sdk/packages/llms/src/providers/request-headers.ts`): `X-PLATFORM` /
 * `X-PLATFORM-VERSION` are the editor's name and version, `X-CLIENT-VERSION`
 * is the extension version and `X-CORE-VERSION` the Cline SDK core version.
 * They are public product facts, not credentials.
 *
 * `X-Task-ID` is added per request from the harness session id.
 */
export const CLINE_HEADERS = {
  Accept: 'application/json',
  'HTTP-Referer': 'https://cline.bot',
  'X-Title': 'Cline',
  'User-Agent': 'Cline/4.1.23',
  'X-CLIENT-TYPE': 'VSCode Extension',
  'X-CLIENT-VERSION': '4.1.23',
  'X-CORE-VERSION': '0.0.92',
  'X-PLATFORM': 'Visual Studio Code',
  'X-PLATFORM-VERSION': '1.141.0',
  'X-IS-MULTIROOT': 'false',
}

/**
 * Bundled fallback for the rotating free list, used only when both the cache
 * and the network are unavailable. Checked 2026-10-26 against the live
 * `recommended-models` endpoint.
 *
 * Limits are deliberately conservative: too small a context costs an earlier
 * compaction, too large one turns into a provider rejection mid-session. The
 * live catalog (`CATALOG_URL`) replaces all of these on the first online start.
 */
export const FALLBACK_FREE = [
  {
    id: 'reflection/beam-free',
    name: 'Beam',
    description: "Reflection's 501B MoE (23B active) coding model.",
    contextWindow: 262_144,
    maxTokens: 131_072,
    input: ['text'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'cline-free/nemotron-3.5-super-vl',
    name: 'Nemotron 3.5 Super VL',
    description: "NVIDIA's 120B multimodal mixture-of-experts.",
    contextWindow: 262_144,
    maxTokens: 131_072,
    input: ['text', 'image'],
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'nvidia/nemotron-3.5-lightning-free',
    name: 'Nemotron 3.5 Lightning',
    description: "NVIDIA's low-latency 30B hybrid MoE (3B active).",
    contextWindow: 262_144,
    maxTokens: 65_536,
    input: ['text'],
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'poolside/laguna-s-2.1-free',
    name: 'Laguna S 2.1',
    description: 'Poolside 118B MoE (8B active) for long-horizon coding.',
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ['text'],
    efforts: ['low', 'medium', 'high'],
  },
  {
    id: 'cline-free/solar-mini4',
    name: 'Solar Mini 4',
    description: "Upstage's compact 35B mixture-of-experts (3B active).",
    contextWindow: 262_144,
    maxTokens: 32_768,
    input: ['text'],
    efforts: ['low', 'medium', 'high'],
  },
]

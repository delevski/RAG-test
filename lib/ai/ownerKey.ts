import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Owner mode: the site owner stores a permanent Anthropic key in the
 * ANTHROPIC_API_KEY env var. The site is public, so that key is spendable
 * ONLY when the request proves ownership with RAG_OWNER_TOKEN - a random
 * document session never authorizes spend. The token is compared
 * timing-safe after hashing (no length or prefix leak).
 */

export const OWNER_MODE_NOT_CONFIGURED =
  'OWNER_MODE_NOT_CONFIGURED: set ANTHROPIC_API_KEY and RAG_OWNER_TOKEN to enable owner mode'
export const OWNER_TOKEN_INVALID = 'OWNER_TOKEN_INVALID'

/**
 * The site is public and Hobby-tier Vercel has no per-route rate limiting,
 * so the token is the ONLY spend gate. Refuse to arm owner mode with a
 * weak token: below this length the deployment behaves as unconfigured.
 */
export const MIN_OWNER_TOKEN_CHARS = 16

export function ownerModeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.ANTHROPIC_API_KEY &&
      env.RAG_OWNER_TOKEN &&
      env.RAG_OWNER_TOKEN.length >= MIN_OWNER_TOKEN_CHARS
  )
}

function hash(v: string): Buffer {
  return createHash('sha256').update(v).digest()
}

/** True when the presented token matches the configured one, timing-safe. */
export function ownerTokenMatches(
  presented: unknown,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (typeof presented !== 'string' || presented.length === 0 || presented.length > 256) {
    return false
  }
  const configured = env.RAG_OWNER_TOKEN
  if (!configured) return false
  return timingSafeEqual(hash(presented), hash(configured))
}

export type ClaudeKeyResolution =
  | { key: string; source: 'owner' }
  | { key: string; source: 'byok' }
  | { key: null; source: null }

/**
 * Decides which Anthropic key (if any) a request may use.
 * A presented ownerToken always decides first: it must match, otherwise the
 * request fails loudly instead of silently falling back to another path.
 */
export function resolveClaudeKey(
  body: { ownerToken?: unknown; anthropicKey?: unknown },
  env: NodeJS.ProcessEnv = process.env
): ClaudeKeyResolution {
  if (body.ownerToken !== undefined && body.ownerToken !== null && body.ownerToken !== '') {
    if (!ownerModeConfigured(env)) throw new Error(OWNER_MODE_NOT_CONFIGURED)
    if (!ownerTokenMatches(body.ownerToken, env)) throw new Error(OWNER_TOKEN_INVALID)
    return { key: env.ANTHROPIC_API_KEY as string, source: 'owner' }
  }
  if (typeof body.anthropicKey === 'string' && body.anthropicKey.length > 0) {
    return { key: body.anthropicKey, source: 'byok' }
  }
  return { key: null, source: null }
}

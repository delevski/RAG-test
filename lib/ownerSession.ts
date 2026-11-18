import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { OWNER_SESSION_SENTINEL } from '../lib/ownerSessionId'
import { ownerModeConfigured, ownerTokenMatches } from '../lib/ai/ownerKey'

/**
 * Remembered owner login. After the passphrase is verified once, the server
 * sets an HttpOnly, Secure, SameSite=Strict cookie holding only an expiry and
 * an HMAC of it. The passphrase itself is never stored in the browser.
 * Revoke everywhere: change RAG_OWNER_TOKEN (the HMAC key derives from it).
 * Revoke this device: log out (clears the cookie).
 */
export const OWNER_COOKIE = 'rag_owner'
export const OWNER_SESSION_DAYS = 30

function sign(exp: string, env: NodeJS.ProcessEnv): string {
  const key = createHash('sha256').update('rag-owner-session|' + (env.RAG_OWNER_TOKEN ?? '')).digest()
  return createHmac('sha256', key).update(exp).digest('hex')
}

export function makeOwnerCookieValue(now = Date.now(), env: NodeJS.ProcessEnv = process.env): string {
  const exp = String(Math.floor(now / 1000) + OWNER_SESSION_DAYS * 86400)
  return `${exp}.${sign(exp, env)}`
}

export function ownerCookieValid(value: unknown, now = Date.now(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (!ownerModeConfigured(env) || typeof value !== 'string') return false
  const [exp, mac] = value.split('.')
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false
  const a = Buffer.from(mac), b = Buffer.from(sign(exp, env))
  return a.length === b.length && timingSafeEqual(a, b)
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
}

export function cookieHeader(value: string, maxAgeSec: number): string {
  return `${OWNER_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`
}

export function sessionCookieFromRequest(req: { headers?: Record<string, any> }, env: NodeJS.ProcessEnv = process.env): boolean {
  return ownerCookieValid(readCookie(req.headers?.cookie, OWNER_COOKIE), Date.now(), env)
}

/**
 * Swap the sentinel for the real configured token when a valid session cookie
 * accompanies the request, so every existing check keeps working unchanged.
 * Anything else passes through untouched (sentinel without cookie fails).
 */
export function resolveOwnerCredential(
  req: { headers?: Record<string, any> },
  presented: unknown,
  env: NodeJS.ProcessEnv = process.env
): unknown {
  if (presented === OWNER_SESSION_SENTINEL) {
    return sessionCookieFromRequest(req, env) ? env.RAG_OWNER_TOKEN : '__expired_session__'
  }
  return presented
}

export { ownerTokenMatches }

import test from 'node:test'
import assert from 'node:assert/strict'
import { makeOwnerCookieValue, ownerCookieValid, resolveOwnerCredential, OWNER_COOKIE } from '../lib/ownerSession'
import { OWNER_SESSION_SENTINEL } from '../lib/ownerSessionId'
const env = { RAG_OWNER_TOKEN: 'a-long-owner-passphrase-1', ANTHROPIC_API_KEY: 'x' } as any
test('cookie valid, expires, tamper and rotation fail', () => {
  const v = makeOwnerCookieValue(Date.now(), env)
  assert.ok(ownerCookieValid(v, Date.now(), env))
  assert.ok(!ownerCookieValid(v, Date.now() + 31 * 86400e3, env))
  assert.ok(!ownerCookieValid(v.slice(0, -2) + '00', Date.now(), env))
  assert.ok(!ownerCookieValid(v, Date.now(), { ...env, RAG_OWNER_TOKEN: 'another-long-passphrase-2' }))
  assert.ok(!ownerCookieValid(undefined, Date.now(), env))
})
test('sentinel resolves only with a valid cookie', () => {
  const ok = { headers: { cookie: `${OWNER_COOKIE}=${makeOwnerCookieValue(Date.now(), env)}` } }
  assert.equal(resolveOwnerCredential(ok, OWNER_SESSION_SENTINEL, env), env.RAG_OWNER_TOKEN)
  assert.notEqual(resolveOwnerCredential({ headers: {} }, OWNER_SESSION_SENTINEL, env), env.RAG_OWNER_TOKEN)
  assert.equal(resolveOwnerCredential({ headers: {} }, 'typed', env), 'typed')
})
test('cross-origin cookie use is refused', () => {
  const c = `${OWNER_COOKIE}=${makeOwnerCookieValue(Date.now(), env)}`
  const mk = (extra: any) => ({ method: 'POST', headers: { cookie: c, host: 'rag.ordel.dev', ...extra } })
  assert.equal(resolveOwnerCredential(mk({ origin: 'https://rag.ordel.dev' }), OWNER_SESSION_SENTINEL, env), env.RAG_OWNER_TOKEN)
  assert.notEqual(resolveOwnerCredential(mk({ origin: 'https://evil.example' }), OWNER_SESSION_SENTINEL, env), env.RAG_OWNER_TOKEN)
  assert.notEqual(resolveOwnerCredential(mk({ 'sec-fetch-site': 'cross-site' }), OWNER_SESSION_SENTINEL, env), env.RAG_OWNER_TOKEN)
})

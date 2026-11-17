/**
 * BYOK (bring-your-own-key) helpers. A visitor may supply their own
 * Anthropic key for a single request; the key is validated in shape only,
 * used for that request, and never persisted or logged.
 */
export function validateAnthropicKey(key: unknown): string | null {
  if (key === undefined || key === null || key === '') return null
  if (typeof key !== 'string') throw new Error('INVALID_ANTHROPIC_KEY')
  if (key.length < 20 || key.length > 512 || !key.startsWith('sk-ant-')) {
    throw new Error('INVALID_ANTHROPIC_KEY')
  }
  return key
}

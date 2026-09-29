import { afterEach, describe, expect, it } from 'vitest'
import { consumeReturnTo, rememberReturnTo } from './returnTo'

describe('post-login return path', () => {
  afterEach(() => localStorage.clear())

  // Should: return the remembered path once, then forget it.
  it('returns the remembered path exactly once', () => {
    rememberReturnTo('/checkin?code=ABCD1234', 1_000)
    expect(consumeReturnTo(2_000)).toBe('/checkin?code=ABCD1234')
    expect(consumeReturnTo(3_000)).toBeNull()
  })

  // Should not: return a path remembered longer ago than a magic link stays valid.
  it('drops a stale path', () => {
    rememberReturnTo('/committee/kiosk/pair?code=x', 0)
    expect(consumeReturnTo(16 * 60 * 1000)).toBeNull()
  })

  // Impact: the path is used for a post-login redirect; accepting other
  // origins would make login an open redirect.
  // Should not: accept protocol-relative or absolute URLs.
  it('rejects off-site destinations', () => {
    for (const bad of ['//evil.example/x', 'https://evil.example', '/\\evil.example']) {
      rememberReturnTo(bad, 0)
      expect(consumeReturnTo(1)).toBeNull()
    }
    localStorage.setItem('return_to', JSON.stringify({ path: '//evil.example', at: 0 }))
    expect(consumeReturnTo(1)).toBeNull()
  })

  // Should: ignore a corrupted stored value.
  it('ignores malformed storage', () => {
    localStorage.setItem('return_to', 'not json')
    expect(consumeReturnTo()).toBeNull()
  })
})

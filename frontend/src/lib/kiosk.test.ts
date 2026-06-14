import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkInShift,
  clearKioskToken,
  getBarStatus,
  getKioskCode,
  getKioskToken,
  kioskPairApprove,
  kioskPairStart,
  kioskPairStatus,
  setKioskToken,
} from './auth'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('kiosk auth helpers', () => {
  beforeEach(() => {
    // authenticatedFetch needs a JWT in localStorage.
    localStorage.setItem('auth_token', 'test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('getKioskCode sends X-Kiosk-Token and hits the checkin-code endpoint', async () => {
    setKioskToken('device-token-123')
    const fetchMock = vi.fn().mockResolvedValue(
      json({ code: 'ABCD1234', url: 'http://x/checkin?code=ABCD1234', period_seconds: 30 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const cc = await getKioskCode()
    expect(cc.code).toBe('ABCD1234')

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/kiosk/checkin-code')
    // Device-authenticated, NOT a user Bearer token.
    expect(opts.headers).toMatchObject({ 'X-Kiosk-Token': 'device-token-123' })
  })

  it('getKioskCode throws when no device token is enrolled', async () => {
    clearKioskToken()
    await expect(getKioskCode()).rejects.toThrow(/not enrolled/i)
  })

  it('checkInShift posts the code with Bearer auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ checked_in: true, was_signed_up: false, bar_opened: true }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await checkInShift('ABCD1234')
    expect(res.checked_in).toBe(true)
    expect(res.was_signed_up).toBe(false)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/shifts/check-in')
    expect(opts.method).toBe('POST')
    expect(opts.headers).toMatchObject({ Authorization: 'Bearer test-token' })
    expect(JSON.parse(opts.body)).toEqual({ code: 'ABCD1234' })
  })

  it('checkInShift surfaces the server error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: 'Invalid or expired code' }, 400))
    vi.stubGlobal('fetch', fetchMock)
    await expect(checkInShift('nope')).rejects.toThrow('Invalid or expired code')
  })

  it('getBarStatus is unauthenticated (no Authorization header)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ is_open: true, opened_at: null }))
    vi.stubGlobal('fetch', fetchMock)

    const s = await getBarStatus()
    expect(s.is_open).toBe(true)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/bar-status')
    expect(opts?.headers).toBeUndefined()
  })

  it('pair helpers hit the right endpoints with the right auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 'pair-1' }))
      .mockResolvedValueOnce(json({ status: 'pending' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await kioskPairStart('a'.repeat(64))).toBe('pair-1')
    expect(await kioskPairStatus('pair-1')).toBe('pending')
    await kioskPairApprove('pair-1', 'Till PC')

    expect(fetchMock.mock.calls[0][0]).toContain('/api/kiosk/pair/start')
    expect(fetchMock.mock.calls[1][0]).toContain('/api/kiosk/pair/status?code=pair-1')
    expect(fetchMock.mock.calls[2][0]).toContain('/api/kiosk/pair/approve')
    // pair/start is public; pair/approve is committee-authenticated.
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('the device token persists in localStorage', () => {
    setKioskToken('persisted-token')
    expect(getKioskToken()).toBe('persisted-token')
    expect(localStorage.getItem('kiosk_token')).toBe('persisted-token')
    clearKioskToken()
    expect(getKioskToken()).toBeNull()
  })
})

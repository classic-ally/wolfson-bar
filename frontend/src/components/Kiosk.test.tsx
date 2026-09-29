import { createHash } from 'node:crypto'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Kiosk from './Kiosk'
import { getKioskToken, setKioskToken, sha256Hex } from '../lib/auth'

// jsdom has no canvas; encode the QR payload into the data URL instead.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async (text: string) => `data:qr;${text}`) },
}))

type Reply = Response | Error
type Handler = (path: string, init?: RequestInit) => Reply

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const code = (c: string) => json({ code: c, url: `http://bar/checkin?code=${c}`, period_seconds: 30 })
const offline = () => new TypeError('Failed to fetch')

/** Replies in order, then keeps repeating the last one. */
function sequence(...replies: (() => Reply)[]): () => Reply {
  let i = 0
  return () => replies[Math.min(i++, replies.length - 1)]()
}

function stubServer(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const reply = handler(url.pathname + url.search, init)
    if (reply instanceof Error) throw reply
    return reply
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const qrSrc = (testId: string) => screen.getByTestId(testId).getAttribute('src')

describe('Kiosk screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // WebCrypto resolves on a thread-pool callback that fake timers can't
    // flush; a synchronous sha256 keeps pairing deterministic.
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (_algorithm, data) => {
      const digest = createHash('sha256').update(data as Uint8Array).digest()
      return new Uint8Array(digest).buffer
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // Impact: regression guard — any failed refresh wiped the device token and
  // left the screen stuck on "Starting kiosk…", so a Wi-Fi blip or deploy
  // needed a committee member to re-pair the bar PC.
  // Should: keep the device token through server errors and network failures.
  // Should: show that it is reconnecting, then resume showing fresh codes.
  it('stays enrolled through outages and recovers', async () => {
    setKioskToken('device-token')
    const checkinCode = sequence(
      () => code('C1'), // boot
      () => code('C1'), // first refresh
      () => json({ error: 'Internal error' }, 500),
      offline,
      () => code('C2'),
    )
    const fetchMock = stubServer((path) =>
      path.startsWith('/api/kiosk/checkin-code') ? checkinCode() : json({}, 404),
    )

    render(<Kiosk />)
    await advance(0)
    expect(qrSrc('checkin-qr')).toContain('code=C1')

    await advance(10_000) // 500
    expect(screen.getByRole('status').textContent).toMatch(/reconnecting/i)
    await advance(2_000) // network failure
    expect(getKioskToken()).toBe('device-token')

    await advance(4_000) // back online
    expect(screen.queryByRole('status')).toBeNull()
    expect(qrSrc('checkin-qr')).toContain('code=C2')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/pair/start'))).toBe(false)
  })

  // Impact: after a power cut the PC often boots before the network or backend is up.
  // Should: stay enrolled and keep retrying when the server is unreachable at boot.
  it('survives booting while the server is down', async () => {
    setKioskToken('device-token')
    const checkinCode = sequence(offline, offline, () => code('C1'))
    stubServer((path) => (path.startsWith('/api/kiosk/checkin-code') ? checkinCode() : json({}, 404)))

    render(<Kiosk />)
    await advance(0)
    expect(screen.getByRole('status').textContent).toMatch(/reconnecting/i)
    expect(getKioskToken()).toBe('device-token')

    await advance(2_000)
    expect(qrSrc('checkin-qr')).toContain('code=C1')
  })

  // Should: forget the device token and show a new pairing QR once the kiosk is revoked.
  it('re-pairs after being revoked mid-session', async () => {
    setKioskToken('device-token')
    const checkinCode = sequence(
      () => code('C1'),
      () => code('C1'),
      () => json({ error: 'Kiosk not enrolled' }, 401),
    )
    stubServer((path) => {
      if (path.startsWith('/api/kiosk/checkin-code')) return checkinCode()
      if (path === '/api/kiosk/pair/start') return json({ code: 'pair-1' })
      if (path.startsWith('/api/kiosk/pair/status')) return json({ status: 'pending' })
      return json({}, 404)
    })

    render(<Kiosk />)
    await advance(0)
    expect(qrSrc('checkin-qr')).toContain('code=C1')

    await advance(10_000)
    expect(getKioskToken()).toBeNull()
    expect(qrSrc('pairing-qr')).toContain('code=pair-1')
  })

  // Should: start a fresh pairing when the displayed one expires.
  it('replaces an expired pairing QR', async () => {
    const pairStart = sequence(
      () => json({ code: 'pair-1' }),
      () => json({ code: 'pair-2' }),
    )
    stubServer((path) => {
      if (path === '/api/kiosk/pair/start') return pairStart()
      if (path.startsWith('/api/kiosk/pair/status')) return json({ status: 'expired' })
      return json({}, 404)
    })

    render(<Kiosk />)
    await advance(0)
    expect(qrSrc('pairing-qr')).toContain('code=pair-1')

    await advance(3_000)
    expect(qrSrc('pairing-qr')).toContain('code=pair-2')
  })

  // Should: store the raw token whose hash it registered, then show check-in codes.
  it('enrols once a committee member approves', async () => {
    let registeredHash = ''
    stubServer((path, init) => {
      if (path === '/api/kiosk/pair/start') {
        registeredHash = JSON.parse(String(init?.body)).token_hash
        return json({ code: 'pair-1' })
      }
      if (path.startsWith('/api/kiosk/pair/status')) return json({ status: 'approved' })
      if (path.startsWith('/api/kiosk/checkin-code')) return code('C1')
      return json({}, 404)
    })

    render(<Kiosk />)
    await advance(0)
    await advance(3_000)

    const token = getKioskToken()
    expect(token).not.toBeNull()
    expect(await sha256Hex(token!)).toBe(registeredHash)
    expect(qrSrc('checkin-qr')).toContain('code=C1')
  })
})

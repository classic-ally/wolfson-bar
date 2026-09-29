import { describe, expect, it } from 'vitest'
import { AuthError } from './auth'
import { isRevoked, nextRefreshDelay, pairingIsDead } from './kioskPolicy'

describe('kiosk failure policy', () => {
  // Impact: regression guard — any failed refresh used to wipe the device
  // token, so a Wi-Fi blip or deploy de-enrolled the bar PC.
  // Should: treat only a 401 as the kiosk being revoked.
  // Should not: treat network failures or server errors as revocation.
  it('only a 401 revokes the kiosk', () => {
    expect(isRevoked(new AuthError('Kiosk not enrolled', 401))).toBe(true)
    expect(isRevoked(new AuthError('Internal error', 500))).toBe(false)
    expect(isRevoked(new AuthError('Bad gateway', 502))).toBe(false)
    expect(isRevoked(new TypeError('Failed to fetch'))).toBe(false)
    expect(isRevoked(new AuthError('Kiosk not enrolled'))).toBe(false)
  })

  // Should: refresh three times per code period while healthy.
  it('refreshes three times per code period when healthy', () => {
    expect(nextRefreshDelay(30, 0)).toBe(10_000)
    expect(nextRefreshDelay(null, 0)).toBe(10_000)
  })

  // Should: back off exponentially while offline, capped at 30 seconds.
  it('backs off while the server is unreachable', () => {
    expect(nextRefreshDelay(30, 1)).toBe(2_000)
    expect(nextRefreshDelay(30, 2)).toBe(4_000)
    expect(nextRefreshDelay(30, 3)).toBe(8_000)
    expect(nextRefreshDelay(30, 10)).toBe(30_000)
  })

  // Should: start a new pairing once the current one has expired or disappeared.
  it('restarts pairing on expired or unknown status', () => {
    expect(pairingIsDead('expired')).toBe(true)
    expect(pairingIsDead('unknown')).toBe(true)
    expect(pairingIsDead('pending')).toBe(false)
    expect(pairingIsDead('approved')).toBe(false)
  })
})

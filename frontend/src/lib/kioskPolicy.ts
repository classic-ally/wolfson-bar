// Decisions the kiosk screen makes after a failed request. Kept pure so the
// rules that decide whether the bar PC stays enrolled are unit-testable.

import { AuthError } from './auth'

const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 30_000
const DEFAULT_PERIOD_SECONDS = 30

/**
 * Only a 401 means the server no longer recognises this kiosk. Anything else
 * (offline, a deploy, a 5xx) is transient and must not discard the device
 * token, or the PC needs a committee member to re-pair it.
 */
export function isRevoked(e: unknown): boolean {
  return e instanceof AuthError && e.status === 401
}

/**
 * Delay before the next check-in code fetch: three refreshes per code period
 * while healthy, exponential backoff (capped) while the server is unreachable.
 */
export function nextRefreshDelay(periodSeconds: number | null, consecutiveFailures: number): number {
  if (consecutiveFailures > 0) {
    return Math.min(MIN_BACKOFF_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS)
  }
  return ((periodSeconds ?? DEFAULT_PERIOD_SECONDS) * 1000) / 3
}

/** Pairing statuses after which the kiosk should start a fresh pairing. */
export function pairingIsDead(status: string): boolean {
  return status === 'expired' || status === 'unknown'
}

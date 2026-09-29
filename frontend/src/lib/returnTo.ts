// Where to send the user after they sign in. Login can round-trip through an
// email (magic link) or a full reload (passkey), so the path is kept in
// localStorage rather than router state.

const RETURN_TO_KEY = 'return_to'

// Magic links are valid for 15 minutes; a return path older than that is stale.
const MAX_AGE_MS = 15 * 60 * 1000

interface Stored {
  path: string
  at: number
}

/** Only same-origin absolute paths; rejects `//evil.example` and full URLs. */
function isSafePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}

export function rememberReturnTo(path: string, now: number = Date.now()): void {
  if (!isSafePath(path)) return
  const stored: Stored = { path, at: now }
  localStorage.setItem(RETURN_TO_KEY, JSON.stringify(stored))
}

/** Read and clear the remembered path. Returns null if none, stale, or unsafe. */
export function consumeReturnTo(now: number = Date.now()): string | null {
  const raw = localStorage.getItem(RETURN_TO_KEY)
  localStorage.removeItem(RETURN_TO_KEY)
  if (!raw) return null
  try {
    const { path, at } = JSON.parse(raw) as Stored
    if (typeof path !== 'string' || typeof at !== 'number') return null
    if (now - at > MAX_AGE_MS || !isSafePath(path)) return null
    return path
  } catch {
    return null
  }
}

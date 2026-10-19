/**
 * Parse a backend timestamp: either SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) or
 * RFC 3339, as `created_at` uses. Returns null for missing or unreadable input.
 */
export function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago". */
export function timeAgo(date: Date | null, now: Date = new Date()): string {
  if (!date) return 'at an unknown time'
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}

import { describe, expect, it } from 'vitest'
import { parseTimestamp, timeAgo } from './onboarding'

describe('onboarding times', () => {
  // Impact: step times come from SQLite as UTC without a zone marker, while
  // join dates are RFC 3339; reading the former as local time shifts them.
  // Should: read SQLite timestamps as UTC and RFC 3339 timestamps as given.
  // Should not: return a date for missing or unreadable timestamps.
  it('parses both backend timestamp formats', () => {
    expect(parseTimestamp('2026-06-17 18:45:00')?.toISOString()).toBe('2026-06-17T18:45:00.000Z')
    expect(parseTimestamp('2026-06-17T18:45:00+00:00')?.toISOString()).toBe('2026-06-17T18:45:00.000Z')
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp('not a date')).toBeNull()
  })

  // Should: describe how long ago something happened in days, then weeks, then months.
  it('describes elapsed time', () => {
    const now = new Date('2026-06-30T12:00:00Z')
    expect(timeAgo(new Date('2026-06-30T08:00:00Z'), now)).toBe('today')
    expect(timeAgo(new Date('2026-06-29T08:00:00Z'), now)).toBe('yesterday')
    expect(timeAgo(new Date('2026-06-25T12:00:00Z'), now)).toBe('5 days ago')
    expect(timeAgo(new Date('2026-06-02T12:00:00Z'), now)).toBe('4 weeks ago')
    expect(timeAgo(new Date('2026-03-01T12:00:00Z'), now)).toBe('4 months ago')
    expect(timeAgo(null, now)).toBe('at an unknown time')
  })
})

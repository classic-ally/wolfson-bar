import { useEffect, useState } from 'react'
import { getMyShifts, cancelShiftSignup, getCalendarToken, resetCalendarToken, calendarFeedUrl } from '../../lib/auth'
import type { UserShift } from '../../types/UserShift'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function UserShifts() {
  const [shifts, setShifts] = useState<UserShift[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [calendarToken, setCalendarToken] = useState<string | null>(null)
  usePageTitle('My Shifts')

  useEffect(() => {
    loadShifts()
    getCalendarToken().then(setCalendarToken).catch((err) => console.error('Failed to load calendar link:', err))
  }, [])

  const handleResetCalendar = async () => {
    if (!confirm('Reset your calendar link? Calendars already subscribed will stop updating until you subscribe again.')) {
      return
    }
    try {
      setCalendarToken(await resetCalendarToken())
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset calendar link')
    }
  }

  const loadShifts = async () => {
    try {
      const userShifts = await getMyShifts()
      setShifts(userShifts)
    } catch (err) {
      console.error('Failed to load shifts:', err)
    } finally {
      setLoading(false)
    }
  }

  // A night split into separately-staffed events can hold several of the member's shifts.
  const shiftKey = (shift: UserShift) => `${shift.date}/${shift.slot}`

  const handleCancelShift = async (shift: UserShift) => {
    if (!confirm('Are you sure you want to cancel this shift?')) {
      return
    }

    setCancelling(shiftKey(shift))
    try {
      await cancelShiftSignup(shift.date, shift.slot)
      loadShifts() // Refresh list
    } catch (err) {
      console.error('Failed to cancel shift:', err)
      alert(err instanceof Error ? err.message : 'Failed to cancel shift. Please try again.')
    } finally {
      setCancelling(null)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-GB', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, marginBottom: '5px' }}>My Shifts</h2>
          <p style={{ color: '#666', margin: 0 }}>
            Your upcoming bar shifts
          </p>
        </div>
        {calendarToken && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        <a
          href={calendarFeedUrl(calendarToken)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#8B0000',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 500,
            whiteSpace: 'nowrap'
          }}
        >
          📅 Subscribe
        </a>
        <button
          onClick={handleResetCalendar}
          style={{ background: 'none', border: 'none', color: '#666', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          title="Use if you shared your calendar link by mistake"
        >
          Reset link
        </button>
        </div>
        )}
      </div>

      {shifts.length === 0 ? (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#666'
        }}>
          No upcoming shifts. Visit the <a href="/events" style={{ color: '#8B0000' }}>Calendar</a> to sign up for shifts.
        </div>
      ) : (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Date</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#333' }}>Event</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#333' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const key = shiftKey(shift)
                return (
                <tr key={key} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '14px' }}>
                    {formatDate(shift.date)}
                    {shift.open_time && shift.close_time && (
                      <div style={{ color: '#666', fontSize: '12px' }}>
                        {shift.open_time} – {shift.close_time}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '14px' }}>
                    {shift.event_title || <span style={{ color: '#999', fontStyle: 'italic' }}>Regular opening</span>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleCancelShift(shift)}
                      disabled={cancelling === key}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: cancelling === key ? '#ccc' : '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: cancelling === key ? 'not-allowed' : 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      {cancelling === key ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

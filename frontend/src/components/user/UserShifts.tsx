import { useEffect, useState } from 'react'
import { getMyShifts, UserShift, cancelShiftSignup } from '../../lib/auth'

export default function UserShifts() {
  const [shifts, setShifts] = useState<UserShift[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    loadShifts()
  }, [])

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

  const handleCancelShift = async (date: string) => {
    if (!confirm('Are you sure you want to cancel this shift?')) {
      return
    }

    setCancelling(date)
    try {
      await cancelShiftSignup(date)
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

  const getCalendarUrl = () => {
    const userId = localStorage.getItem('user_id')
    return `webcal://${window.location.host}/api/users/${userId}/calendar.ics`
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
        <a
          href={getCalendarUrl()}
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
              {shifts.map((shift) => (
                <tr key={shift.date} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '14px' }}>
                    {formatDate(shift.date)}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '14px' }}>
                    {shift.event_title || <span style={{ color: '#999', fontStyle: 'italic' }}>Regular opening</span>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleCancelShift(shift.date)}
                      disabled={cancelling === shift.date}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: cancelling === shift.date ? '#ccc' : '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: cancelling === shift.date ? 'not-allowed' : 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      {cancelling === shift.date ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

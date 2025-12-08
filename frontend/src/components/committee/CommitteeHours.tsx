import { useEffect, useState } from 'react'
import { getBarHours, updateBarHours, BarHours } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function CommitteeHours() {
  const [barHours, setBarHours] = useState<BarHours[]>([])
  const [editingDay, setEditingDay] = useState<number | null>(null)
  const [editOpenTime, setEditOpenTime] = useState('')
  const [editCloseTime, setEditCloseTime] = useState('')
  const [loading, setLoading] = useState(true)
  usePageTitle('Bar Hours')

  useEffect(() => {
    loadBarHours()
  }, [])

  const loadBarHours = async () => {
    try {
      const hours = await getBarHours()
      setBarHours(hours)
    } catch (err) {
      console.error('Failed to load bar hours:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEditBarHours = (day: BarHours) => {
    setEditingDay(day.day_of_week)
    setEditOpenTime(day.open_time)
    setEditCloseTime(day.close_time)
  }

  const handleSaveBarHours = async () => {
    if (editingDay === null) return

    try {
      await updateBarHours(editingDay, editOpenTime, editCloseTime)
      setEditingDay(null)
      setEditOpenTime('')
      setEditCloseTime('')
      loadBarHours()
    } catch (err) {
      console.error('Failed to update bar hours:', err)
      alert('Failed to update bar hours. Please try again.')
    }
  }

  const handleCancelEdit = () => {
    setEditingDay(null)
    setEditOpenTime('')
    setEditCloseTime('')
  }

  const getDayName = (dayOfWeek: number): string => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return days[dayOfWeek]
  }

  return (
    <div>
      <h1>Bar Opening Hours</h1>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Configure the default opening and closing times for each day of the week. These times are used for calendar events unless custom times are specified.
      </p>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          backgroundColor: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>Day</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Open Time</th>
              <th style={{ padding: '12px', textAlign: 'left' }}>Close Time</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {barHours.map((day) => (
              <tr key={day.day_of_week} style={{ borderBottom: '1px solid #dee2e6' }}>
                <td style={{ padding: '12px', fontWeight: 500 }}>{getDayName(day.day_of_week)}</td>
                <td style={{ padding: '12px' }}>
                  {editingDay === day.day_of_week ? (
                    <input
                      type="time"
                      value={editOpenTime}
                      onChange={(e) => setEditOpenTime(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px'
                      }}
                    />
                  ) : (
                    day.open_time
                  )}
                </td>
                <td style={{ padding: '12px' }}>
                  {editingDay === day.day_of_week ? (
                    <input
                      type="time"
                      value={editCloseTime}
                      onChange={(e) => setEditCloseTime(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px'
                      }}
                    />
                  ) : (
                    day.close_time
                  )}
                </td>
                <td style={{ padding: '12px', textAlign: 'right' }}>
                  {editingDay === day.day_of_week ? (
                    <>
                      <button
                        onClick={handleSaveBarHours}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          marginRight: '8px'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleEditBarHours(day)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{
        marginTop: '30px',
        padding: '16px',
        backgroundColor: '#e7f3ff',
        borderRadius: '4px',
        border: '1px solid #bee5eb'
      }}>
        <strong>Note:</strong> Times that cross midnight (e.g., closing at 02:00) are automatically handled.
        The close time is assumed to be the next day if it's earlier than the open time.
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import EventScheduler from './committee/EventScheduler'
import { getEvents } from '../lib/auth'
import type { Event } from '../types/Event'

const API_BASE = window.location.origin

interface EventManagementProps {
  onEventsChange?: () => void
}

export default function EventManagement({ onEventsChange }: EventManagementProps) {
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [showPastEvents, setShowPastEvents] = useState(false)

  // Get start of current month as default filter
  const getMonthStart = () => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  }

  // Filter events based on toggle
  const events = showPastEvents
    ? allEvents
    : allEvents.filter((e) => e.event_date >= getMonthStart())

  useEffect(() => {
    loadEvents()
  }, [])

  const loadEvents = async () => {
    setLoading(true)
    try {
      const fetchedEvents = await getEvents()
      setAllEvents(fetchedEvents)
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSaved = async () => {
    await loadEvents()
    onEventsChange?.()
  }

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) {
      return
    }
    const token = localStorage.getItem('auth_token')
    if (!token) {
      alert('Not authenticated')
      return
    }
    try {
      await fetch(`${API_BASE}/api/admin/events/${eventId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      await loadEvents()
      onEventsChange?.()
    } catch (err) {
      console.error('Failed to delete event:', err)
      alert('Failed to delete event. Please try again.')
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Event Management</h2>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : (
        <EventScheduler
          existingEvents={events}
          editingEvent={editingEvent}
          onCancelEdit={() => setEditingEvent(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Past-events toggle */}
      <div
        style={{
          marginTop: '30px',
          marginBottom: '15px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showPastEvents}
            onChange={(e) => setShowPastEvents(e.target.checked)}
            style={{ marginRight: '8px', width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <span>Show past events</span>
        </label>
        {!showPastEvents && (
          <span style={{ color: '#666', fontSize: '14px' }}>
            (showing from {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} onwards)
          </span>
        )}
      </div>

      {/* Events List */}
      <div>
        <h3>Scheduled Events</h3>
        {events.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            No events scheduled yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {events.map((event) => (
              <div
                key={event.id}
                style={{
                  backgroundColor: 'white',
                  padding: '15px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{event.title}</div>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    {new Date(event.event_date).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </div>
                  {event.description && (
                    <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
                      {event.description}
                    </div>
                  )}
                  {(event.shift_max_volunteers !== null || event.shift_requires_contract) && (
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#856404',
                        marginTop: '5px',
                        display: 'flex',
                        gap: '10px',
                      }}
                    >
                      {event.shift_max_volunteers !== null && (
                        <span>👥 {event.shift_max_volunteers} volunteers</span>
                      )}
                      {event.shift_requires_contract && <span>📄 Contract required</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => handleEditEvent(event)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteEvent(event.id)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

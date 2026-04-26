import { useState, useEffect } from 'react'
import EventsCalendar from './EventsCalendar'
import { getEvents } from '../lib/auth'
import type { Event } from '../types/Event'

const API_BASE = window.location.origin

interface EventManagementProps {
  onEventsChange?: () => void
}

export default function EventManagement({ onEventsChange }: EventManagementProps) {
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedDates, setSelectedDates] = useState<Date[]>([])
  const [maxVolunteers, setMaxVolunteers] = useState<number | ''>('')
  const [requiresContract, setRequiresContract] = useState(false)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
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
    : allEvents.filter(e => e.event_date >= getMonthStart())

  useEffect(() => {
    loadEvents()
  }, [])

  const loadEvents = async () => {
    setLoading(true)
    try {
      // Load all events for management
      const fetchedEvents = await getEvents()
      setAllEvents(fetchedEvents)
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDateToLocal = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const handleSelectSlot = (date: Date) => {

    // Toggle date selection
    const dateString = formatDateToLocal(date)
    const existingIndex = selectedDates.findIndex(
      d => formatDateToLocal(d) === dateString
    )

    if (existingIndex >= 0) {
      // Deselect
      setSelectedDates(selectedDates.filter((_, i) => i !== existingIndex))
    } else {
      // Select
      setSelectedDates([...selectedDates, date])
    }
  }

  const handleCreateEvents = async () => {
    if (!title.trim()) {
      alert('Please enter an event title')
      return
    }

    if (selectedDates.length === 0) {
      alert('Please select at least one date')
      return
    }

    const token = localStorage.getItem('auth_token')
    if (!token) {
      alert('Not authenticated')
      return
    }

    try {
      // Create one event for each selected date
      for (const date of selectedDates) {
        const eventDate = formatDateToLocal(date)

        await fetch(`${API_BASE}/api/admin/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            event_date: eventDate,
            start_time: startTime || null,
            end_time: endTime || null,
            shift_max_volunteers: maxVolunteers === '' ? null : maxVolunteers,
            shift_requires_contract: requiresContract ? true : null,
          }),
        })
      }

      // Reset form
      setTitle('')
      setDescription('')
      setSelectedDates([])
      setStartTime('')
      setEndTime('')
      setMaxVolunteers('')
      setRequiresContract(false)

      // Reload events
      await loadEvents()

      if (onEventsChange) {
        onEventsChange()
      }

      alert(`Successfully created ${selectedDates.length} event(s)!`)
    } catch (err) {
      console.error('Failed to create events:', err)
      alert('Failed to create events. Please try again.')
    }
  }

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event)
    setTitle(event.title)
    setDescription(event.description || '')
    setStartTime(event.start_time || '')
    setEndTime(event.end_time || '')
    setMaxVolunteers(event.shift_max_volunteers || '')
    setRequiresContract(event.shift_requires_contract || false)
    // Scroll to top to show the form
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancelEdit = () => {
    setEditingEvent(null)
    setTitle('')
    setDescription('')
    setSelectedDates([])
    setStartTime('')
    setEndTime('')
    setMaxVolunteers('')
    setRequiresContract(false)
  }

  const handleUpdateEvent = async () => {
    if (!editingEvent) return

    if (!title.trim()) {
      alert('Please enter an event title')
      return
    }

    const token = localStorage.getItem('auth_token')
    if (!token) {
      alert('Not authenticated')
      return
    }

    try {
      await fetch(`${API_BASE}/api/admin/events/${editingEvent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          start_time: startTime || null,
          end_time: endTime || null,
          shift_max_volunteers: maxVolunteers === '' ? null : maxVolunteers,
          shift_requires_contract: requiresContract ? true : null,
        }),
      })

      // Reset form
      handleCancelEdit()

      // Reload events
      await loadEvents()

      if (onEventsChange) {
        onEventsChange()
      }

      alert('Event updated successfully!')
    } catch (err) {
      console.error('Failed to update event:', err)
      alert('Failed to update event. Please try again.')
    }
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
          'Authorization': `Bearer ${token}`,
        },
      })

      await loadEvents()

      if (onEventsChange) {
        onEventsChange()
      }
    } catch (err) {
      console.error('Failed to delete event:', err)
      alert('Failed to delete event. Please try again.')
    }
  }

  // Merge actual events with selected dates for preview
  const previewEvents: Event[] = [
    ...events,
    ...selectedDates.map((date, i) => ({
      id: `preview-${i}`,
      title: title || '(New Event)',
      description: description || null,
      event_date: formatDateToLocal(date),
      start_time: startTime || null,
      end_time: endTime || null,
      shift_max_volunteers: null,
      shift_requires_contract: null,
    }))
  ]

  return (
    <div style={{ padding: '20px' }}>
      <h2>Event Management</h2>

      {/* Create/Edit Event Form */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #ddd'
      }}>
        <h3 style={{ marginTop: 0 }}>
          {editingEvent ? `Edit Event: ${editingEvent.title}` : 'Create Event(s)'}
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Pub Quiz"
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details about the event"
            rows={3}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div style={{ marginBottom: '15px', display: 'flex', gap: '15px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
              End Time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={{
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>
            Max Volunteers
          </label>
          <input
            type="number"
            value={maxVolunteers}
            onChange={(e) => setMaxVolunteers(e.target.value === '' ? '' : parseInt(e.target.value))}
            placeholder="Default: 2"
            min="1"
            style={{
              width: '200px',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
          <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>
            Leave empty to use default (2 volunteers)
          </div>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requiresContract}
              onChange={(e) => setRequiresContract(e.target.checked)}
              style={{
                marginRight: '8px',
                width: '18px',
                height: '18px',
                cursor: 'pointer'
              }}
            />
            <span style={{ fontWeight: 500 }}>Requires Contract</span>
          </label>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '3px', marginLeft: '26px' }}>
            Only volunteers with valid contracts can sign up for this shift
          </div>
        </div>

        {!editingEvent && (
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '10px' }}>
            Click dates on the calendar below to select when this event occurs.
            {selectedDates.length > 0 && ` (${selectedDates.length} date${selectedDates.length > 1 ? 's' : ''} selected)`}
          </p>
        )}

        {editingEvent ? (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleUpdateEvent}
              disabled={!title.trim()}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: title.trim() ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              Update Event
            </button>
            <button
              onClick={handleCancelEdit}
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleCreateEvents}
            disabled={!title.trim() || selectedDates.length === 0}
            style={{
              padding: '10px 20px',
              backgroundColor: selectedDates.length > 0 ? '#28a745' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedDates.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              fontWeight: 500
            }}
          >
            Create {selectedDates.length} Event{selectedDates.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Calendar */}
      <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
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
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>Loading calendar...</div>
      ) : (
        <EventsCalendar
          events={previewEvents}
          onDateClick={handleSelectSlot}
          defaultDate={new Date()}
        />
      )}

      {/* Events List */}
      <div style={{ marginTop: '30px' }}>
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
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{event.title}</div>
                  <div style={{ fontSize: '14px', color: '#666' }}>
                    {new Date(event.event_date).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </div>
                  {event.description && (
                    <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
                      {event.description}
                    </div>
                  )}
                  {(event.shift_max_volunteers !== null || event.shift_requires_contract) && (
                    <div style={{ fontSize: '13px', color: '#856404', marginTop: '5px', display: 'flex', gap: '10px' }}>
                      {event.shift_max_volunteers !== null && (
                        <span>👥 {event.shift_max_volunteers} volunteers</span>
                      )}
                      {event.shift_requires_contract && (
                        <span>📄 Contract required</span>
                      )}
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
                      fontSize: '14px'
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
                      fontSize: '14px'
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

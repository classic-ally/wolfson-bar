import { useEffect, useState } from 'react'
import ShiftSlotCalendar from './ShiftSlotCalendar'
import type { Event } from '@/types/Event'

const API_BASE = window.location.origin

interface EventSchedulerProps {
  /** Existing events to overlay on the calendar so the picker shows what's already booked. */
  existingEvents: Event[]
  /** When set, the form is in edit mode for this event. */
  editingEvent: Event | null
  onCancelEdit: () => void
  /** Fired after a successful create/update so the parent can refetch. */
  onSaved: () => void
}

function formatDateToLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function EventScheduler({
  existingEvents,
  editingEvent,
  onCancelEdit,
  onSaved,
}: EventSchedulerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [maxVolunteers, setMaxVolunteers] = useState<number | ''>('')
  const [requiresContract, setRequiresContract] = useState(false)
  const [selectedDates, setSelectedDates] = useState<Date[]>([])

  // Sync form fields when the parent flips us into edit mode.
  useEffect(() => {
    if (editingEvent) {
      setTitle(editingEvent.title)
      setDescription(editingEvent.description || '')
      setStartTime(editingEvent.start_time || '')
      setEndTime(editingEvent.end_time || '')
      setMaxVolunteers(editingEvent.shift_max_volunteers ?? '')
      setRequiresContract(editingEvent.shift_requires_contract ?? false)
      setSelectedDates([])
    }
  }, [editingEvent])

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setStartTime('')
    setEndTime('')
    setMaxVolunteers('')
    setRequiresContract(false)
    setSelectedDates([])
  }

  const handleSelectSlot = (date: Date) => {
    const dateString = formatDateToLocal(date)
    const existingIndex = selectedDates.findIndex(
      (d) => formatDateToLocal(d) === dateString,
    )
    if (existingIndex >= 0) {
      setSelectedDates(selectedDates.filter((_, i) => i !== existingIndex))
    } else {
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
      for (const date of selectedDates) {
        await fetch(`${API_BASE}/api/admin/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || null,
            event_date: formatDateToLocal(date),
            start_time: startTime || null,
            end_time: endTime || null,
            shift_max_volunteers: maxVolunteers === '' ? null : maxVolunteers,
            shift_requires_contract: requiresContract ? true : null,
          }),
        })
      }
      const created = selectedDates.length
      resetForm()
      onSaved()
      alert(`Successfully created ${created} event(s)!`)
    } catch (err) {
      console.error('Failed to create events:', err)
      alert('Failed to create events. Please try again.')
    }
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
          Authorization: `Bearer ${token}`,
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
      resetForm()
      onCancelEdit()
      onSaved()
      alert('Event updated successfully!')
    } catch (err) {
      console.error('Failed to update event:', err)
      alert('Failed to update event. Please try again.')
    }
  }

  const handleCancel = () => {
    resetForm()
    onCancelEdit()
  }

  // Existing + currently-selected dates, merged so the calendar visually
  // previews what we're about to create.
  const previewEvents: Event[] = [
    ...existingEvents,
    ...selectedDates.map((date, i) => ({
      id: `preview-${i}`,
      title: title || '(New Event)',
      description: description || null,
      event_date: formatDateToLocal(date),
      start_time: startTime || null,
      end_time: endTime || null,
      shift_max_volunteers: null,
      shift_requires_contract: null,
    })),
  ]

  const fromDate = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    d.setDate(1)
    return d
  })()
  const toDate = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 6)
    return d
  })()

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="lg:w-[380px] lg:shrink-0">
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid #ddd',
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
                fontSize: '14px',
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
                fontFamily: 'inherit',
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
                  fontSize: '14px',
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
                  fontSize: '14px',
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
              onChange={(e) =>
                setMaxVolunteers(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              placeholder="Default: 2"
              min="1"
              style={{
                width: '200px',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
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
                style={{ marginRight: '8px', width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontWeight: 500 }}>Requires Contract</span>
            </label>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '3px', marginLeft: '26px' }}>
              Only volunteers with valid contracts can sign up for this shift
            </div>
          </div>

          {!editingEvent && (
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '10px' }}>
              Click dates on the calendar to select when this event occurs.
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
                  fontWeight: 500,
                }}
              >
                Update Event
              </button>
              <button
                onClick={handleCancel}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
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
                fontWeight: 500,
              }}
            >
              Create {selectedDates.length} Event{selectedDates.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <ShiftSlotCalendar
          shifts={[]}
          events={previewEvents}
          viewerContext={{ kind: 'manager' }}
          fromDate={fromDate}
          toDate={toDate}
          onSelect={handleSelectSlot}
        />
      </div>
    </div>
  )
}

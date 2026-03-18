import React, { useState } from 'react'
import { Calendar, dateFnsLocalizer, ToolbarProps } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enGB } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Event, ShiftInfo, UserStatus, TermWeek, InductionDate } from '../lib/auth'

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  allDay?: boolean
  resource?: Event
}

// Custom toolbar with Subscribe button
const CustomToolbar = (toolbar: ToolbarProps<CalendarEvent, object>) => {
  return (
    <div className="rbc-toolbar">
      <span className="rbc-btn-group">
        <button type="button" onClick={() => toolbar.onNavigate('TODAY')}>
          Today
        </button>
        <button type="button" onClick={() => toolbar.onNavigate('PREV')}>
          Back
        </button>
        <button type="button" onClick={() => toolbar.onNavigate('NEXT')}>
          Next
        </button>
      </span>
      <span className="rbc-toolbar-label">{toolbar.label}</span>
      <span className="rbc-btn-group">
        <button
          type="button"
          className={toolbar.view === 'month' ? 'rbc-active' : ''}
          onClick={() => toolbar.onView('month')}
        >
          Month
        </button>
        <button
          type="button"
          className={toolbar.view === 'agenda' ? 'rbc-active' : ''}
          onClick={() => toolbar.onView('agenda')}
          style={{
            borderTopRightRadius: '4px',
            borderBottomRightRadius: '4px',
          }}
        >
          Agenda
        </button>
        <a
          href={`webcal://${window.location.host}/api/events/calendar.ics`}
          style={{
            padding: '6.5px 10px',
            backgroundColor: '#8B0000',
            color: 'white',
            textDecoration: 'none',
            border: '1px solid #8B0000',
            borderRadius: '4px',
            fontSize: '14px',
            marginLeft: '10px',
            display: 'inline-block',
            cursor: 'pointer',
            lineHeight: 'normal',
            verticalAlign: 'middle',
            fontWeight: 400,
          }}
        >
          📅 Subscribe
        </a>
      </span>
    </div>
  )
}

const locales = {
  'en-GB': enGB,
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
})

interface EventsCalendarProps {
  events: Event[]
  shifts?: ShiftInfo[] // Optional shift info for authenticated users
  userStatus?: UserStatus | null // User status for induction checking
  termWeeks?: TermWeek[]
  inductionDates?: InductionDate[] // Optional induction dates for pre-induction users
  onDateClick?: (date: Date) => void
  onSelectEvent?: (event: CalendarEvent) => void
  defaultDate?: Date
  minDate?: Date
  maxDate?: Date
  defaultView?: 'month' | 'agenda'
  agendaLength?: number // Number of days to show in agenda view
}

// Abbreviate term names: "0th Week, Hilary Term" -> "HT0"
// Only show weeks 0-8 (Full Term); vacation weeks are filtered out
function abbreviateTermWeek(summary: string): string {
  const match = summary.match(/(-?\d+)\w*\s+Week,?\s+(Michaelmas|Hilary|Trinity)\s+Term/i)
  if (!match) return ''
  const week = parseInt(match[1], 10)
  if (week < 0 || week > 8) return ''
  const term = match[2][0] + 'T' // MT, HT, TT
  return `${term}${week}`
}

export default function EventsCalendar({
  events,
  shifts,
  userStatus,
  termWeeks,
  inductionDates,
  onDateClick,
  onSelectEvent,
  defaultDate = new Date(),
  minDate,
  maxDate,
  defaultView = 'month',
  agendaLength = 90, // Default to 90 days
}: EventsCalendarProps) {
  // Use agenda view by default on mobile (< 500px)
  const getInitialView = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 500) {
      return 'agenda'
    }
    return defaultView
  }

  const [currentDate, setCurrentDate] = useState(defaultDate)
  const [view, setView] = useState<'month' | 'agenda'>(getInitialView())

  // Build date -> term week abbreviation lookup
  const termWeekByDate = new Map<string, string>()
  if (termWeeks) {
    for (const tw of termWeeks) {
      const abbr = abbreviateTermWeek(tw.summary)
      if (!abbr) continue
      const start = new Date(tw.start_date + 'T00:00:00')
      const end = new Date(tw.end_date + 'T00:00:00')
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        termWeekByDate.set(format(d, 'yyyy-MM-dd'), abbr)
      }
    }
  }

  // Build date -> induction availability lookup
  const inductionByDate = new Map<string, InductionDate>()
  if (inductionDates) {
    for (const id of inductionDates) {
      inductionByDate.set(id.date, id)
    }
  }

  // Create a map of date -> shift info for quick lookup
  const shiftsByDate = new Map<string, ShiftInfo>()
  if (shifts) {
    shifts.forEach(shift => {
      shiftsByDate.set(shift.date, shift)
    })
  }

  // Helper to get background color for a date based on shift status
  const getDateBackgroundColor = (date: Date): { backgroundColor?: string; border?: string; fontWeight?: string } => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dateToCheck = new Date(date)
    dateToCheck.setHours(0, 0, 0, 0)

    const isToday = dateToCheck.getTime() === today.getTime()
    const isPast = dateToCheck < today

    // Don't highlight past dates (except today)
    if (isPast && !isToday) {
      return {}
    }

    const dateStr = format(date, 'yyyy-MM-dd')

    // For pre-induction users, show induction availability as light blue
    if (inductionDates && inductionDates.length > 0 && userStatus && !userStatus.induction_completed) {
      const inductionDate = inductionByDate.get(dateStr)
      if (inductionDate) {
        const style: { backgroundColor?: string; border?: string; fontWeight?: string } = {
          backgroundColor: '#e7f3ff',
        }
        if (isToday) {
          style.border = '3px solid #002147'
          style.fontWeight = 'bold'
        }
        return style
      }
      if (isToday) {
        return {
          border: '3px solid #002147',
          fontWeight: 'bold',
        }
      }
      return {}
    }

    if (!shifts) {
      // If today but no shift data, just add border
      if (isToday) {
        return {
          border: '3px solid #002147',
          fontWeight: 'bold',
        }
      }
      return {}
    }

    const shift = shiftsByDate.get(dateStr)

    if (!shift) {
      // If today but no shift data, just add border
      if (isToday) {
        return {
          border: '3px solid #002147',
          fontWeight: 'bold',
        }
      }
      return {}
    }

    const isInducted = userStatus?.induction_completed ?? true
    const hasCommittee = shift.signups.some(s => s.is_committee)

    let backgroundColor: string | undefined

    // For non-inducted users, show grey if no committee member present
    if (!isInducted && !hasCommittee) {
      backgroundColor = '#e9ecef' // Light grey - not available for induction
    }
    // No fill (filled): signups_count >= max_volunteers
    else if (shift.signups_count >= shift.max_volunteers) {
      backgroundColor = undefined // No fill
    }
    // Yellow fill (partial): 0 < signups_count < max_volunteers
    else if (shift.signups_count > 0) {
      backgroundColor = '#fff3cd' // Light yellow
    }
    // Red fill (empty): signups_count === 0
    else {
      backgroundColor = '#f8d7da' // Light red
    }

    // Add prominent border for today
    if (isToday) {
      return {
        backgroundColor,
        border: '3px solid #002147',
        fontWeight: 'bold',
      }
    }

    return backgroundColor ? { backgroundColor } : {}
  }

  // Convert our Event[] to react-big-calendar format
  const calendarEvents: CalendarEvent[] = events.map(event => {
    const hasTime = !!event.start_time
    const displayTitle = hasTime ? `${event.start_time} ${event.title}` : event.title

    if (hasTime) {
      const [sh, sm] = event.start_time!.split(':').map(Number)
      const start = new Date(event.event_date + 'T00:00:00')
      start.setHours(sh, sm, 0, 0)
      let end: Date
      if (event.end_time) {
        const [eh, em] = event.end_time.split(':').map(Number)
        end = new Date(event.event_date + 'T00:00:00')
        end.setHours(eh, em, 0, 0)
      } else {
        end = new Date(start.getTime() + 60 * 60 * 1000) // default 1hr
      }
      return {
        id: event.id,
        title: displayTitle,
        start,
        end,
        allDay: false,
        resource: event,
      }
    }

    const date = new Date(event.event_date + 'T00:00:00')
    return {
      id: event.id,
      title: displayTitle,
      start: date,
      end: date,
      allDay: true,
      resource: event,
    }
  })

  return (
    <div>
      <div style={{ height: '600px' }}>
        <Calendar
          localizer={localizer}
          events={calendarEvents}
          startAccessor="start"
          endAccessor="end"
          allDayAccessor="allDay"
          date={currentDate}
          onNavigate={(date) => setCurrentDate(date)}
          view={view}
          onView={(newView) => setView(newView as 'month' | 'agenda')}
          views={['month', 'agenda']}
          onSelectEvent={onSelectEvent}
          min={minDate}
          max={maxDate}
          length={agendaLength}
          components={{
            toolbar: CustomToolbar,
            dateCellWrapper: onDateClick
              ? ({ children, value }: { children: React.ReactNode; value: Date }) => (
                  <div style={{ flex: 1, display: 'flex', cursor: 'pointer' }} onClick={() => onDateClick(value)}>
                    {children}
                  </div>
                )
              : undefined,
            month: {
              dateHeader: ({ date, label }: { date: Date; label: string }) => {
                const dateStr = format(date, 'yyyy-MM-dd')
                const termLabel = termWeekByDate.get(dateStr)
                const inductionDate = inductionByDate.get(dateStr)
                const shift = shiftsByDate.get(dateStr)
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                const cellDate = new Date(date)
                cellDate.setHours(0, 0, 0, 0)
                // Show "I" badge for: pre-induction users (via inductionDates prop), or any committee member when induction is available on that date
                const isOwnInduction = shift?.current_user_induction_available
                const showInduction = cellDate >= today && (
                  (inductionDate && inductionDate.slots_remaining > 0) ||
                  (shift && shift.has_induction_availability)
                )
                return (
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px', cursor: onDateClick ? 'pointer' : undefined }}
                    onClick={onDateClick ? () => onDateClick(date) : undefined}
                  >
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {termLabel && (
                        <span style={{ fontSize: '9px', color: '#002147', opacity: 0.6, fontWeight: 500 }}>
                          {termLabel}
                        </span>
                      )}
                      {showInduction && (
                        <span style={{
                          fontSize: '9px',
                          color: isOwnInduction ? 'white' : '#0d6efd',
                          backgroundColor: isOwnInduction ? '#0d6efd' : 'transparent',
                          border: isOwnInduction ? 'none' : '1px solid #0d6efd',
                          borderRadius: '2px',
                          padding: '0 3px',
                          fontWeight: 600,
                          lineHeight: '14px',
                        }}
                          title={
                            isOwnInduction
                              ? `You're running an induction${shift && shift.induction_signups_count > 0 ? ` (${shift.induction_signups_count} signed up)` : ''}`
                              : inductionDate ? `Induction available (${inductionDate.slots_remaining}/4 slots)` : 'Induction scheduled'
                          }
                        >
                          I
                        </span>
                      )}
                    </div>
                    <span style={{ marginLeft: 'auto' }}>{label}</span>
                  </div>
                )
              },
            },
          }}
          style={{ height: '100%' }}
          formats={{
            agendaDateFormat: 'dd MMM yyyy',
            agendaTimeFormat: (date: Date, _culture: string | undefined, localizer: { format: (d: Date, f: string, c?: string) => string } | undefined) =>
              localizer ? localizer.format(date, 'HH:mm') : '',
            agendaTimeRangeFormat: ({ start, end }: { start: Date; end: Date }, _culture: string | undefined, localizer: { format: (d: Date, f: string, c?: string) => string } | undefined) => {
              if (!localizer) return ''
              // All-day events: both start and end at midnight
              if (start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 0 && end.getMinutes() === 0) return ''
              return `${localizer.format(start, 'HH:mm')} – ${localizer.format(end, 'HH:mm')}`
            },
          }}
          eventPropGetter={(_event) => {
            if (view === 'agenda') {
              return {
                style: {
                  backgroundColor: '#f5f5f5',
                  borderRadius: '4px',
                  color: '#333',
                  border: '1px solid #e0e0e0',
                  display: 'block',
                  fontSize: '14px',
                  padding: '8px 12px',
                },
              }
            }
            // Month view styling
            return {
              style: {
                backgroundColor: '#8B0000',
                borderRadius: '4px',
                opacity: 0.9,
                color: 'white',
                border: 'none',
                display: 'block',
                fontSize: '11px',
                padding: '2px 4px',
                width: '100%',
                whiteSpace: 'normal',
                overflow: 'visible',
                textOverflow: 'clip',
                lineHeight: '1.2',
                cursor: 'pointer',
              },
            }
          }}
          dayPropGetter={(date) => {
            const styles = getDateBackgroundColor(date)
            return {
              style: styles,
            }
          }}
        />
      </div>
    </div>
  )
}

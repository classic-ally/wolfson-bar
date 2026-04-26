import { useMemo } from 'react'
import { format } from 'date-fns'
import { Calendar } from '@/components/ui/calendar'
import { cn } from '@/lib/utils'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { Event } from '@/types/Event'
import type { InductionDate } from '@/types/InductionDate'
import type { UserStatus } from '@/types/UserStatus'
import type { TermWeek } from '@/lib/auth'

/** Who is looking at the calendar. Drives state-dependent visual rules
 *  (e.g. grey out shifts a pre-induction user can't actually sign up for).
 *
 *  - `self`: browsing one's own opportunities. Pre-induction users see a grey
 *    fill on dates with no committee member on shift, since they can't book
 *    without supervision.
 *  - `manager`: the viewer is allocating someone else (rota manager). The
 *    grey rule is skipped — what matters is current fill state, not whether
 *    the viewer specifically can book. */
export type ViewerContext =
  | { kind: 'self'; userStatus: UserStatus | null }
  | { kind: 'manager' }

export interface ShiftSlotCalendarProps {
  /** Shift state per date — drives fill colour. */
  shifts: ShiftInfo[]
  /** Events to render under each cell so the assigner can see what's on. */
  events: Event[]
  /** Oxford term weeks (e.g. "0th Week, Hilary Term"). Renders MT0/HT3/TT1 chips. */
  termWeeks?: TermWeek[]
  /** Induction availability per date. Drives the "I" badge. */
  inductionDates?: InductionDate[]
  /** Dates the candidate user is already booked on — show distinct highlight. */
  userExistingShifts?: string[]
  /** Who is viewing the calendar. Defaults to manager (no user-specific rules). */
  viewerContext?: ViewerContext
  /** Selectable date window. Outside dates are disabled. */
  fromDate: Date
  toDate: Date
  /** Currently selected date (controlled). */
  selected?: Date
  /** Fired when an enabled date is clicked. */
  onSelect: (date: Date) => void
}

/** "0th Week, Hilary Term" → "HT0". Vacation weeks (outside 0–8) drop. */
function abbreviateTermWeek(summary: string): string {
  const match = summary.match(/(-?\d+)\w*\s+Week,?\s+(Michaelmas|Hilary|Trinity)\s+Term/i)
  if (!match) return ''
  const week = parseInt(match[1], 10)
  if (week < 0 || week > 8) return ''
  return `${match[2][0]}T${week}`
}

type FillState = 'empty' | 'partial' | 'full' | 'blocked' | 'unknown'

function fillStateFor(
  shift: ShiftInfo | undefined,
  viewer: ViewerContext,
): FillState {
  if (!shift) return 'unknown'
  // Pre-induction self-view: dates with no committee on shift are not bookable.
  if (
    viewer.kind === 'self' &&
    viewer.userStatus &&
    !viewer.userStatus.induction_completed &&
    !shift.signups.some((s) => s.is_committee)
  ) {
    return 'blocked'
  }
  if (shift.signups_count >= shift.max_volunteers) return 'full'
  if (shift.signups_count > 0) return 'partial'
  return 'empty'
}

const fillStyles: Record<FillState, string> = {
  empty: 'bg-red-100 hover:bg-red-200 text-red-900',
  partial: 'bg-amber-100 hover:bg-amber-200 text-amber-900',
  full: 'bg-slate-200 text-slate-800 line-through',
  blocked: 'bg-slate-100 text-slate-700',
  unknown: 'text-foreground',
}

/** Calendar with enlarged cells suitable for displaying shift fill state and
 *  events. Used by the rota allocation flow to assign a user to a date. */
export default function ShiftSlotCalendar({
  shifts,
  events,
  termWeeks,
  inductionDates,
  userExistingShifts = [],
  viewerContext = { kind: 'manager' },
  fromDate,
  toDate,
  selected,
  onSelect,
}: ShiftSlotCalendarProps) {
  const shiftByDate = useMemo(() => {
    const m = new Map<string, ShiftInfo>()
    for (const s of shifts) m.set(s.date, s)
    return m
  }, [shifts])

  const eventsByDate = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of events) {
      const list = m.get(e.event_date) ?? []
      list.push(e)
      m.set(e.event_date, list)
    }
    return m
  }, [events])

  const termWeekByDate = useMemo(() => {
    const m = new Map<string, string>()
    if (!termWeeks) return m
    for (const tw of termWeeks) {
      const abbr = abbreviateTermWeek(tw.summary)
      if (!abbr) continue
      const start = new Date(tw.start_date + 'T00:00:00')
      const end = new Date(tw.end_date + 'T00:00:00')
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        m.set(format(d, 'yyyy-MM-dd'), abbr)
      }
    }
    return m
  }, [termWeeks])

  const inductionByDate = useMemo(() => {
    const m = new Map<string, InductionDate>()
    if (!inductionDates) return m
    for (const id of inductionDates) m.set(id.date, id)
    return m
  }, [inductionDates])

  const userShiftDates = useMemo(
    () => new Set(userExistingShifts),
    [userExistingShifts],
  )

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  return (
    <Calendar
      mode="single"
      selected={selected}
      onSelect={(d) => d && onSelect(d)}
      startMonth={fromDate}
      endMonth={toDate}
      defaultMonth={selected ?? fromDate}
      disabled={[{ before: fromDate }, { after: toDate }]}
      showOutsideDays={false}
      className="rounded-lg border [--cell-size:--spacing(11)] sm:[--cell-size:--spacing(18)] md:[--cell-size:--spacing(22)] p-2 sm:p-3"
      classNames={{
        day: 'group/day relative h-(--cell-size) w-(--cell-size) min-w-0 rounded-md p-0 text-center align-top',
        week: 'mt-1 flex w-full justify-between gap-1',
        weekday:
          'w-(--cell-size) shrink-0 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none',
        weekdays: 'flex justify-between gap-1',
      }}
      components={{
        DayButton: ({ day, modifiers, ...props }) => {
          const dateStr = format(day.date, 'yyyy-MM-dd')
          const shift = shiftByDate.get(dateStr)
          const state = fillStateFor(shift, viewerContext)
          const dayEvents = eventsByDate.get(dateStr) ?? []
          const termLabel = termWeekByDate.get(dateStr)
          const inductionDate = inductionByDate.get(dateStr)
          const userAlreadyOn = userShiftDates.has(dateStr)
          const isFull = state === 'full'
          const isBlocked = state === 'blocked'
          const disabled = modifiers.disabled || isFull || isBlocked

          const cellDate = new Date(day.date)
          cellDate.setHours(0, 0, 0, 0)
          // Filled blue: current user is the committee member running induction.
          const isOwnInduction = !!shift?.current_user_induction_available
          // Outlined blue: induction available on this date (slots remaining).
          const showInduction =
            cellDate >= today &&
            ((inductionDate && inductionDate.slots_remaining > 0) ||
              !!shift?.has_induction_availability)
          const inductionTitle = isOwnInduction
            ? `You're running an induction${
                shift && shift.induction_signups_count > 0
                  ? ` (${shift.induction_signups_count} signed up)`
                  : ''
              }`
            : inductionDate
              ? `Induction available (${inductionDate.slots_remaining}/4 slots)`
              : 'Induction scheduled'

          return (
            <button
              type="button"
              data-day={dateStr}
              data-selected={modifiers.selected || undefined}
              disabled={disabled}
              onClick={() => !disabled && onSelect(day.date)}
              {...props}
              className={cn(
                'group relative flex h-full w-full min-w-0 flex-col items-stretch justify-start gap-0.5 overflow-hidden rounded-md border border-transparent p-0.5 sm:p-1 text-left text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                'disabled:cursor-not-allowed',
                fillStyles[state],
                modifiers.selected && 'ring-2 ring-primary ring-inset',
                userAlreadyOn && 'border-blue-500',
                modifiers.today && 'font-bold',
              )}
            >
              <div className="flex items-baseline justify-between gap-0.5">
                <span className="text-xs sm:text-sm font-semibold leading-none">
                  {format(day.date, 'd')}
                </span>
                <div className="flex items-center gap-0.5">
                  {showInduction && (
                    <span
                      className={cn(
                        'rounded px-1 text-[9px] font-bold leading-[14px]',
                        isOwnInduction
                          ? 'bg-blue-600 text-white'
                          : 'border border-blue-600 text-blue-700',
                      )}
                      title={inductionTitle}
                      aria-label={inductionTitle}
                    >
                      I
                    </span>
                  )}
                  {termLabel && (
                    <span className="hidden sm:inline text-[9px] font-semibold uppercase tracking-tight opacity-90">
                      {termLabel}
                    </span>
                  )}
                </div>
              </div>
              {shift && (
                <span className="text-[9px] sm:text-[10px] leading-tight font-medium">
                  {shift.signups_count}/{shift.max_volunteers}
                </span>
              )}
              {dayEvents.slice(0, 1).map((e) => (
                <span
                  key={e.id}
                  className="mt-auto hidden md:block w-full truncate rounded bg-blue-200/70 px-1 py-0.5 text-[10px] font-medium text-blue-900"
                  title={e.title}
                >
                  {e.title}
                </span>
              ))}
              {dayEvents.length > 0 && (
                <span
                  className="md:hidden absolute bottom-0.5 left-0.5 size-1.5 rounded-full bg-blue-500"
                  title={dayEvents.map((e) => e.title).join(', ')}
                  aria-label={`Events: ${dayEvents.map((e) => e.title).join(', ')}`}
                />
              )}
              {userAlreadyOn && (
                <span className="absolute right-0.5 top-0.5 size-1.5 sm:size-2 rounded-full bg-blue-500" />
              )}
            </button>
          )
        },
      }}
    />
  )
}

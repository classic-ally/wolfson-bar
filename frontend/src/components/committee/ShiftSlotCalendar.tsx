import { useMemo, useRef } from 'react'
import { format } from 'date-fns'
import { Calendar } from '@/components/ui/calendar'
import { useElementSize } from '@/hooks/useElementSize'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { Event } from '@/types/Event'
import type { InductionDate } from '@/types/InductionDate'
import type { UserStatus } from '@/types/UserStatus'
import type { TermWeek } from '@/lib/auth'
import ShiftCalendarDay from './ShiftCalendarDay'

/** Container width at which we render two months side by side. */
const DUAL_MONTH_THRESHOLD_PX = 1100

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
  | { kind: 'public' }

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

  // Open to today's month when today is in window. Falls back to fromDate
  // for ranges entirely in the past or future (e.g. the rota allocator window).
  const defaultMonth = useMemo(() => {
    if (selected) return selected
    if (today >= fromDate && today <= toDate) return today
    return fromDate
  }, [selected, today, fromDate, toDate])

  // Container-aware sizing. The hook reads the wrapper's actual rendered
  // width via ResizeObserver — viewport queries don't help when SSC is
  // nested in a narrower column (e.g. the EventScheduler sidebar layout).
  const containerRef = useRef<HTMLDivElement>(null)
  const { width: containerWidth } = useElementSize(containerRef)
  // Before the first observe pass, width is 0 — pick single-month so we
  // don't briefly flash a dual-month layout that may overflow.
  const numberOfMonths = containerWidth >= DUAL_MONTH_THRESHOLD_PX ? 2 : 1

  return (
    <div ref={containerRef} className="@container w-full">
    <Calendar
      mode="single"
      numberOfMonths={numberOfMonths}
      selected={selected}
      onSelect={(d) => d && onSelect(d)}
      startMonth={fromDate}
      endMonth={toDate}
      defaultMonth={defaultMonth}
      disabled={[{ before: fromDate }, { after: toDate }]}
      showOutsideDays={false}
      // Container-query-driven cell-size (uses cqw, container-relative).
      // Arbitrary `@[1100px]:` matches the JS dual-month threshold exactly,
      // sidestepping uncertainty about which named container scale Tailwind
      // ships. Past the threshold, tighter clamp dividing by 14 columns.
      className='[--cell-size:clamp(2.25rem,calc((100cqw-3rem)/7),5.5rem)] @[1100px]:[--cell-size:clamp(2.5rem,calc((100cqw-5rem)/14),5.5rem)] p-2 sm:p-3'
      classNames={{
        root: 'w-full',
        // Dual-month divider: centred ::before on the wrapper. Toggled via
        // the same container-query threshold as numberOfMonths so the CSS
        // and JS layouts stay in agreement.
        months: 'relative flex flex-col gap-4 @[1100px]:flex-row @[1100px]:gap-10 @[1100px]:before:absolute @[1100px]:before:left-1/2 @[1100px]:before:top-0 @[1100px]:before:bottom-0 @[1100px]:before:w-px @[1100px]:before:-translate-x-1/2 @[1100px]:before:bg-border @[1100px]:before:content-[""]',
        month: 'flex w-full flex-col gap-4',
        // Cells flex to fill their week (1/7 each) — height stays anchored
        // to --cell-size but width grows with the container.
        day: 'group/day relative h-(--cell-size) min-w-0 flex-1 basis-0 rounded-md p-0 text-center align-top',
        week: 'mt-1 flex w-full gap-1',
        weekday:
          'min-w-0 flex-1 basis-0 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none',
        weekdays: 'flex gap-1',
      }}
      components={{
        DayButton: ({ day, modifiers, ...buttonProps }) => {
          const dateStr = format(day.date, 'yyyy-MM-dd')
          return (
            <ShiftCalendarDay
              day={day}
              modifiers={modifiers}
              buttonProps={buttonProps}
              shift={shiftByDate.get(dateStr)}
              events={eventsByDate.get(dateStr) ?? []}
              termLabel={termWeekByDate.get(dateStr)}
              inductionDate={inductionByDate.get(dateStr)}
              userAlreadyOn={userShiftDates.has(dateStr)}
              viewerContext={viewerContext}
              today={today}
              onSelect={onSelect}
            />
          )
        },
      }}
    />
    </div>
  )
}

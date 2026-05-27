import { format } from 'date-fns'
import type { ComponentProps } from 'react'
import type { DayButton as DayPickerDayButton } from 'react-day-picker'
import { cn } from '@/lib/utils'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { Event } from '@/types/Event'
import type { InductionDate } from '@/types/InductionDate'
import type { ViewerContext } from './ShiftSlotCalendar'

export type FillState = 'empty' | 'partial' | 'full' | 'blocked' | 'unknown'

export function fillStateFor(
  shift: ShiftInfo | undefined,
  viewer: ViewerContext,
  isPast: boolean,
): FillState {
  if (viewer.kind === 'public') return 'unknown'
  if (!shift) return 'unknown'
  // Past shifts have no actionable fill state — "0 signups" on a past date
  // isn't a recruitment problem, just history.
  if (isPast) return 'unknown'
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

type DayPickerDayButtonProps = ComponentProps<typeof DayPickerDayButton>

export interface ShiftCalendarDayProps {
  /** react-day-picker DayButton args. */
  day: DayPickerDayButtonProps['day']
  modifiers: DayPickerDayButtonProps['modifiers']
  buttonProps: Omit<DayPickerDayButtonProps, 'day' | 'modifiers'>
  /** Resolved per-date data (looked up by the parent calendar). */
  shift: ShiftInfo | undefined
  events: Event[]
  termLabel: string | undefined
  inductionDate: InductionDate | undefined
  userAlreadyOn: boolean
  viewerContext: ViewerContext
  today: Date
  onSelect: (date: Date) => void
}

function EventChipStack({
  events,
  maxVisible,
  className,
}: {
  events: Event[]
  maxVisible: number
  className?: string
}) {
  // If there's room for everything, show every chip; otherwise show
  // (maxVisible - 1) chips plus a "+N more" overflow chip.
  const visibleCount = events.length <= maxVisible ? events.length : maxVisible - 1
  const overflow = events.length - visibleCount
  return (
    <div
      className={cn(
        'mt-auto hidden w-full min-w-0 flex-col gap-0.5',
        className,
      )}
    >
      {events.slice(0, visibleCount).map((e) => (
        <span
          key={e.id}
          className="w-full truncate rounded bg-blue-200/70 px-1 py-0.5 text-[10px] font-medium text-blue-900"
          title={e.title}
        >
          {e.title}
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="w-full truncate rounded bg-blue-200/70 px-1 py-0.5 text-[10px] font-medium italic text-blue-900"
          title={events.slice(visibleCount).map((e) => e.title).join(', ')}
        >
          +{overflow} more
        </span>
      )}
    </div>
  )
}

export default function ShiftCalendarDay({
  day,
  modifiers,
  buttonProps,
  shift,
  events,
  termLabel,
  inductionDate,
  userAlreadyOn,
  viewerContext,
  today,
  onSelect,
}: ShiftCalendarDayProps) {
  const dateStr = format(day.date, 'yyyy-MM-dd')
  const cellDate = new Date(day.date)
  cellDate.setHours(0, 0, 0, 0)
  const isPast = cellDate < today
  const state = fillStateFor(shift, viewerContext, isPast)
  const isFull = state === 'full'
  const isBlocked = state === 'blocked'
  const disabled = modifiers.disabled || isFull || isBlocked
  const isPublic = viewerContext.kind === 'public'

  const isOwnInduction = !!shift?.current_user_induction_available
  const showInduction =
    !isPublic &&
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
      {...buttonProps}
      className={cn(
        'group relative flex h-full w-full min-w-0 flex-col items-stretch justify-start gap-0.5 overflow-hidden rounded-md border border-transparent p-0.5 sm:p-1 text-left text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed',
        fillStyles[state],
        // Order matters: today's ring is declared first so selected's
        // ring-2 overrides it when both apply (selected wins the styling).
        // Shift-status fills (red/amber) cover shadcn's grey `today` slot
        // background, so this ring is what actually surfaces "today" on
        // coloured cells.
        modifiers.today && 'font-bold ring-1 ring-inset ring-slate-400',
        modifiers.selected && 'ring-2 ring-primary ring-inset',
        userAlreadyOn && 'border-blue-500',
      )}
    >
      <div className="flex items-baseline justify-between gap-0.5">
        <span className="text-xs sm:text-sm font-semibold leading-none">
          {format(day.date, 'd')}
        </span>
        <div className="flex items-center gap-0.5">
          {!isPublic && shift?.requires_contract && (
            <span
              className="rounded bg-amber-500 px-1 text-[9px] font-bold leading-[14px] text-white"
              title="Paid event — contract required"
              aria-label="Paid event"
            >
              £
            </span>
          )}
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
      {!isPublic && shift && (
        <span className="text-[9px] sm:text-[10px] leading-tight font-medium">
          {shift.signups_count}/{shift.max_volunteers}
        </span>
      )}
      {/* Stacked event chips. Capacity rises with cell size: 2 chips at md,
          3 at lg. Overflow collapses to the first chip(s) + "+N more" so the
          count never disappears. Two parallel stacks (md-only / lg+) is the
          cleanest way to express the per-breakpoint cap without runtime
          viewport detection. */}
      {events.length > 0 && (
        <>
          <EventChipStack events={events} maxVisible={2} className="md:flex lg:hidden" />
          <EventChipStack events={events} maxVisible={3} className="lg:flex" />
        </>
      )}
      {/* Mobile: a row of dots (up to 3) + numeric overflow. */}
      {events.length > 0 && (
        <div
          className="md:hidden absolute bottom-0.5 left-0.5 flex items-center gap-0.5"
          title={events.map((e) => e.title).join(', ')}
        >
          {events.slice(0, 3).map((e) => (
            <span key={e.id} className="size-1.5 rounded-full bg-blue-500" aria-hidden />
          ))}
          {events.length > 3 && (
            <span className="text-[9px] font-semibold leading-none text-blue-700">
              +{events.length - 3}
            </span>
          )}
          <span className="sr-only">
            Events: {events.map((e) => e.title).join(', ')}
          </span>
        </div>
      )}
      {userAlreadyOn && (
        <span className="absolute right-0.5 top-0.5 size-1.5 sm:size-2 rounded-full bg-blue-500" />
      )}
    </button>
  )
}

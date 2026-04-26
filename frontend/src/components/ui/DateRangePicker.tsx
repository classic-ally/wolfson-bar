import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type { DateRange }

export interface DateRangePickerProps {
  /** Controlled value. */
  value?: DateRange
  /** Uncontrolled initial value. */
  defaultValue?: DateRange
  onValueChange?: (range: DateRange | undefined) => void
  /** Lower bound (inclusive). */
  minDate?: Date
  /** Upper bound (inclusive). */
  maxDate?: Date
  /** Trigger label when no range selected. */
  placeholder?: string
  /** Months shown side-by-side in the popover. Default 2. On `<sm` viewports
   *  the calendar internally falls back to 1 via Tailwind responsive classes. */
  numberOfMonths?: number
  disabled?: boolean
  className?: string
  /** Render the trigger button at full width. */
  fullWidth?: boolean
}

function formatRange(range: DateRange | undefined): string | null {
  if (!range?.from) return null
  if (!range.to) return format(range.from, 'd MMM yyyy')
  if (
    range.from.getFullYear() === range.to.getFullYear() &&
    range.from.getMonth() === range.to.getMonth()
  ) {
    return `${format(range.from, 'd')} – ${format(range.to, 'd MMM yyyy')}`
  }
  if (range.from.getFullYear() === range.to.getFullYear()) {
    return `${format(range.from, 'd MMM')} – ${format(range.to, 'd MMM yyyy')}`
  }
  return `${format(range.from, 'd MMM yyyy')} – ${format(range.to, 'd MMM yyyy')}`
}

export function DateRangePicker({
  value,
  defaultValue,
  onValueChange,
  minDate,
  maxDate,
  placeholder = 'Pick a date range',
  numberOfMonths = 2,
  disabled = false,
  className,
  fullWidth = false,
}: DateRangePickerProps) {
  const isControlled = value !== undefined
  const [internal, setInternal] = useState<DateRange | undefined>(defaultValue)
  const range = isControlled ? value : internal

  const setRange = (next: DateRange | undefined) => {
    if (!isControlled) setInternal(next)
    onValueChange?.(next)
  }

  const label = formatRange(range)

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          className={cn(
            'justify-start gap-2 font-normal',
            !label && 'text-muted-foreground',
            fullWidth && 'w-full',
            className,
          )}
          disabled={disabled}
        >
          <CalendarIcon className="size-4 opacity-70" />
          {label ?? placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        // Override default popover gap/padding — Calendar manages its own.
      >
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          numberOfMonths={numberOfMonths}
          showOutsideDays={false}
          startMonth={minDate}
          endMonth={maxDate}
          disabled={
            minDate || maxDate
              ? [
                  ...(minDate ? [{ before: minDate }] : []),
                  ...(maxDate ? [{ after: maxDate }] : []),
                ]
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}

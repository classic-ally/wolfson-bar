import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  assignUserToShift,
  getEvents,
  getShifts,
  getTermWeeks,
} from '@/lib/auth'
import type { Event } from '@/types/Event'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { TermWeek } from '@/lib/auth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import ShiftSlotCalendar from './ShiftSlotCalendar'

export interface AssignShiftModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Member being assigned. */
  userId: string
  userDisplayName: string | null
  /** Selectable date window (rota manager's chosen range). */
  fromDate: Date
  toDate: Date
  /** Fired after a successful assignment so the parent can refetch. */
  onAssigned: () => void
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AssignShiftModal({
  open,
  onOpenChange,
  userId,
  userDisplayName,
  fromDate,
  toDate,
  onAssigned,
}: AssignShiftModalProps) {
  const [shifts, setShifts] = useState<ShiftInfo[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [termWeeks, setTermWeeks] = useState<TermWeek[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    const start = toDateString(fromDate)
    const end = toDateString(toDate)
    Promise.all([getShifts(start, end), getEvents(start, end), getTermWeeks()])
      .then(([s, e, t]) => {
        setShifts(s)
        setEvents(e)
        setTermWeeks(t)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load shift data')
      })
      .finally(() => setLoading(false))
  }, [open, fromDate, toDate])

  const handleSelect = async (date: Date) => {
    if (submitting) return
    const dateStr = toDateString(date)
    setSubmitting(true)
    setError(null)
    try {
      await assignUserToShift(dateStr, userId)
      onAssigned()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Assign shift to {userDisplayName ?? 'member'}
          </DialogTitle>
          <DialogDescription>
            {format(fromDate, 'd MMM yyyy')} – {format(toDate, 'd MMM yyyy')}.
            Click a date to assign. Full days are blocked; events are surfaced under each cell.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Loading shifts…</div>
        ) : (
          <div className="flex justify-center">
            <ShiftSlotCalendar
              shifts={shifts}
              events={events}
              termWeeks={termWeeks}
              fromDate={fromDate}
              toDate={toDate}
              onSelect={handleSelect}
            />
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

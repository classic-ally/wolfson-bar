import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  getUnallocatedMembers,
  type UnallocatedMember,
} from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'
import { usePageTitle } from '@/hooks/usePageTitle'
import AssignShiftModal from './AssignShiftModal'

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultRange(): DateRange {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 28)
  return { from, to }
}

export default function CommitteeRotaManager() {
  usePageTitle('Rota Manager')
  const [range, setRange] = useState<DateRange | undefined>(defaultRange)
  const [members, setMembers] = useState<UnallocatedMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<UnallocatedMember | null>(null)

  const reload = () => {
    if (!range?.from || !range?.to) return
    setLoading(true)
    setError(null)
    getUnallocatedMembers(toDateString(range.from), toDateString(range.to))
      .then(setMembers)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load')
        setMembers([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(reload, [range?.from?.getTime(), range?.to?.getTime()])

  const columns: ColumnDef<UnallocatedMember>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (m) => m.display_name ?? <span className="text-muted-foreground">Unknown</span>,
      sortable: true,
      sortKey: (m) => m.display_name ?? '',
    },
    {
      key: 'contract',
      header: 'Contract',
      cell: (m) =>
        m.has_contract ? (
          <Badge variant="default">Yes</Badge>
        ) : (
          <Badge variant="outline">No</Badge>
        ),
      sortable: true,
      sortKey: (m) => (m.has_contract ? 1 : 0),
    },
    {
      key: 'lastShift',
      header: 'Last shift',
      cell: (m) =>
        m.last_shift_date ? (
          format(new Date(m.last_shift_date + 'T00:00:00'), 'd MMM yyyy')
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
      sortable: true,
      sortKey: (m) => m.last_shift_date,
    },
  ]

  const rangeReady = !!range?.from && !!range?.to

  return (
    <main>
      <h1 className="text-2xl font-semibold mb-2">Rota Manager</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Pick a date range to see active rota members who haven't booked any shifts
        within it. Assign each one to a date to fill out the rota.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <DateRangePicker value={range} onValueChange={setRange} />
        {rangeReady && (
          <span className="text-sm text-muted-foreground">
            {members.length} unallocated member{members.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={members}
        rowKey={(m) => m.user_id}
        isLoading={loading}
        emptyMessage={
          !rangeReady
            ? 'Pick a date range to begin.'
            : 'Everyone is already booked in this window.'
        }
        defaultSort={{ columnKey: 'lastShift', direction: 'asc' }}
        rowActions={(m) => (
          <Button
            size="sm"
            onClick={() => setAssigning(m)}
            disabled={!rangeReady}
          >
            Assign
          </Button>
        )}
      />

      {assigning && range?.from && range.to && (
        <AssignShiftModal
          open={!!assigning}
          onOpenChange={(open) => {
            if (!open) setAssigning(null)
          }}
          userId={assigning.user_id}
          userDisplayName={assigning.display_name}
          fromDate={range.from}
          toDate={range.to}
          onAssigned={() => {
            setAssigning(null)
            reload()
          }}
        />
      )}
    </main>
  )
}

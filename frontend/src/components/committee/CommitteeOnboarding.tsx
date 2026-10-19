import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type ColumnDef } from '@/components/ui/DataTable'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getOnboarding, sendOnboardingReminder } from '../../lib/auth'
import { parseTimestamp, timeAgo } from '../../lib/onboarding'
import type { OnboardingRow } from '../../types/OnboardingRow'

const EMAIL_LABELS: Record<string, string> = {
  post_induction: 'After induction',
  ready_to_book: 'Ready to book',
  welcome_to_rota: 'Welcome to the rota',
  stuck_reminder: 'Stuck reminder',
}

function emailLabel(key: string): string {
  return key.startsWith('coc_resign') ? 'Re-sign CoC' : (EMAIL_LABELS[key] ?? key)
}

function isFinished(r: OnboardingRow): boolean {
  return r.coc_signed && r.inducted && r.certificate_approved && r.supervised
}

/** A ticked step with how long ago it happened, or an empty box. */
function Step({ done, at, pending }: { done: boolean; at: string | null; pending?: string }) {
  const date = parseTimestamp(at)
  if (done) {
    return (
      <span title={date ? date.toLocaleString() : 'Completed before dates were recorded'}>
        ✅ <span className="text-muted-foreground">{date ? timeAgo(date) : 'date unknown'}</span>
      </span>
    )
  }
  return <span className="text-muted-foreground">{pending ?? '☐'}</span>
}

const sortTime = (done: boolean, at: string | null) => (done ? (parseTimestamp(at)?.getTime() ?? 0) : null)

export default function CommitteeOnboarding() {
  const [rows, setRows] = useState<OnboardingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showFinished, setShowFinished] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  usePageTitle('Onboarding')

  const load = async () => {
    try {
      setRows(await getOnboarding())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load onboarding progress')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const visible = useMemo(() => rows.filter((r) => showFinished || !isFinished(r)), [rows, showFinished])

  const sendReminder = async (row: OnboardingRow) => {
    const name = row.display_name || 'this member'
    if (!confirm(`Send ${name} a reminder of the onboarding steps they have left?`)) return
    setSending(row.user_id)
    setError(null)
    setNotice(null)
    try {
      await sendOnboardingReminder(row.user_id)
      setNotice(`Reminder sent to ${name}.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send reminder')
    } finally {
      setSending(null)
    }
  }

  const columns: ColumnDef<OnboardingRow>[] = [
    {
      key: 'member',
      header: 'Member',
      sortable: true,
      sortKey: (r) => (r.display_name ?? '').toLowerCase(),
      cell: (r) => (
        <div>
          <div className="font-medium">{r.display_name || 'Unknown'}</div>
          <div className="text-xs text-muted-foreground">
            Joined {timeAgo(parseTimestamp(r.created_at))}
          </div>
        </div>
      ),
    },
    {
      key: 'coc',
      header: 'Code of Conduct',
      sortable: true,
      sortKey: (r) => sortTime(r.coc_signed, r.coc_signed_at),
      cell: (r) => <Step done={r.coc_signed} at={r.coc_signed_at} pending={r.coc_resign ? '↻ needs re-sign' : undefined} />,
    },
    {
      key: 'induction',
      header: 'Induction',
      sortable: true,
      sortKey: (r) => sortTime(r.inducted, r.inducted_at),
      cell: (r) => <Step done={r.inducted} at={r.inducted_at} />,
    },
    {
      key: 'food',
      header: 'Food safety',
      sortable: true,
      sortKey: (r) => sortTime(r.certificate_approved, r.certificate_approved_at),
      cell: (r) => (
        <Step
          done={r.certificate_approved}
          at={r.certificate_approved_at}
          pending={
            r.certificate_uploaded
              ? `⏳ uploaded ${timeAgo(parseTimestamp(r.certificate_uploaded_at))}, awaiting approval`
              : undefined
          }
        />
      ),
    },
    {
      key: 'supervised',
      header: 'Supervised shift',
      sortable: true,
      sortKey: (r) => sortTime(r.supervised, r.supervised_at),
      cell: (r) => <Step done={r.supervised} at={r.supervised_at} />,
    },
    {
      key: 'email',
      header: 'Last email',
      sortable: true,
      sortKey: (r) => parseTimestamp(r.last_email_at)?.getTime(),
      cell: (r) => {
        const at = parseTimestamp(r.last_email_at)
        return (
          <div className="text-sm">
            {r.last_email_key && at ? (
              <span title={at.toLocaleString()}>
                {emailLabel(r.last_email_key)}, {timeAgo(at)}
              </span>
            ) : (
              <span className="text-muted-foreground">None yet</span>
            )}
            {!r.has_email ? (
              <div className="text-xs text-muted-foreground">No email address</div>
            ) : (
              !r.email_membership && <div className="text-xs text-muted-foreground">Membership emails off</div>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1">Onboarding</h2>
        <p className="text-sm text-muted-foreground">
          Where each member is in onboarding. Members get automatic emails as they go; use Send reminder to nudge
          someone who's stuck. Click a column header to sort.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} />
        Show members who have finished onboarding
      </label>

      {notice && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        data={visible}
        rowKey={(r) => r.user_id}
        isLoading={loading}
        emptyMessage="Everyone has finished onboarding."
        defaultSort={{ columnKey: 'member', direction: 'asc' }}
        rowActions={(r) => {
          if (isFinished(r)) return null
          const reason = !r.has_email
            ? 'They have no email address'
            : !r.email_membership
              ? "They've turned off Membership emails"
              : undefined
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={!!reason || sending === r.user_id}
              title={
                reason ??
                (r.last_reminder_at
                  ? `Last reminded ${timeAgo(parseTimestamp(r.last_reminder_at))}`
                  : 'Email them the steps they have left')
              }
              onClick={() => sendReminder(r)}
            >
              {sending === r.user_id ? 'Sending…' : 'Send reminder'}
            </Button>
          )
        }}
      />
    </div>
  )
}

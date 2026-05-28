import { useState } from 'react'
import { downloadExport, type ExportReportKey } from '@/lib/auth'
import Page from '@/components/Page'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageTitle } from '@/hooks/usePageTitle'

export interface ExportCardProps {
  title: string
  /** One-line summary shown on the card and in the dialog description. */
  description: string
  /** Column names emitted in the CSV header row. */
  columns: string[]
  /** Suggested filename pattern shown in the dialog (server picks the real one). */
  filenameHint: string
  /** Triggers the download. Injectable so stories can stub the network call. */
  onDownload: () => Promise<void>
}

export function ExportCard({
  title,
  description,
  columns,
  filenameHint,
  onDownload,
}: ExportCardProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    if (loading) return
    setOpen(next)
    if (!next) setError(null)
  }

  const handleDownload = async () => {
    setLoading(true)
    setError(null)
    try {
      await onDownload()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-full flex-col items-start gap-2 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        <span className="mt-auto pt-2 text-sm text-primary group-hover:underline">
          Download CSV →
        </span>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm">
            <div>
              <p className="mb-1 font-medium text-foreground">Columns</p>
              <ul className="grid gap-1">
                {columns.map((c) => (
                  <li key={c}>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                      {c}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-muted-foreground">
              Filename:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {filenameHint}
              </code>
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button onClick={handleDownload} disabled={loading}>
              {loading ? 'Downloading…' : 'Download CSV'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ReportDef {
  reportKey: ExportReportKey
  title: string
  description: string
  columns: string[]
  filenameHint: string
}

const REPORTS: ReportDef[] = [
  {
    reportKey: 'members',
    title: 'Members',
    description:
      'Every active rota member with their email and contract status. Use for mailing lists, recruiting contract holders, or chasing onboarding gaps.',
    columns: ['display_name', 'email', 'has_contract', 'contract_expiry_date'],
    filenameHint: 'members-YYYY-MM-DD.csv',
  },
  {
    reportKey: 'shift-history',
    title: 'Shift history',
    description:
      'Every shift signup across all time, joined to the member and event. Use for "who worked X" lookups, per-member totals, and event staffing audits. An empty event_title means a regular bar night.',
    columns: ['shift_date', 'event_title', 'display_name', 'email'],
    filenameHint: 'shift-history-YYYY-MM-DD.csv',
  },
]

export default function CommitteeExport() {
  usePageTitle('Export Data')

  return (
    <Page size="wide" title="Export Data">
      <p className="mb-6 text-sm text-muted-foreground">
        Download committee data as CSV files. Open them in a spreadsheet to
        filter, sort, or build mailing lists — no in-app filtering needed.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <ExportCard
            key={r.reportKey}
            title={r.title}
            description={r.description}
            columns={r.columns}
            filenameHint={r.filenameHint}
            onDownload={() => downloadExport(r.reportKey)}
          />
        ))}
      </div>
    </Page>
  )
}

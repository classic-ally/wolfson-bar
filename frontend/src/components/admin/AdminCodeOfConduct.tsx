import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getAllUsers, getCocVersions, getCurrentCoc, publishCoc } from '../../lib/auth'
import type { CocVersion } from '../../types/CocVersion'
import type { CocVersionSummary } from '../../types/CocVersionSummary'
import { usePageTitle } from '../../hooks/usePageTitle'

const card = 'rounded-lg bg-white p-5 shadow-sm'

export default function AdminCodeOfConduct() {
  const [current, setCurrent] = useState<CocVersion | null>(null)
  const [history, setHistory] = useState<CocVersionSummary[]>([])
  const [draft, setDraft] = useState('')
  const [signedCount, setSignedCount] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  usePageTitle('Code of Conduct')

  const load = async () => {
    try {
      const [coc, versions] = await Promise.all([getCurrentCoc(), getCocVersions()])
      setCurrent(coc)
      setDraft(coc.body)
      setHistory(versions)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Code of Conduct')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const unchanged = current !== null && draft.trim() === current.body.trim()

  const openConfirm = async () => {
    setError(null)
    setSignedCount(null)
    setConfirming(true)
    try {
      const users = await getAllUsers()
      setSignedCount(users.filter((u) => u.code_of_conduct_signed).length)
    } catch {
      // The count is informational; publishing still works without it.
    }
  }

  const handlePublish = async () => {
    setPublishing(true)
    setError(null)
    try {
      const res = await publishCoc(draft)
      setConfirming(false)
      setNotice(`Published version ${res.version}. ${res.users_reset} members need to re-sign.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish Code of Conduct')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-2">Code of Conduct</h1>
        <p className="text-muted-foreground">
          Publishing a new version asks every member, including committee and admins, to re-sign it.
          Until they do, they can still log in and use committee tools, but can't book or check in to
          shifts.
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      {error && !confirming && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mt-0 mb-2 text-lg font-semibold">
            Edit {current ? `(current: version ${current.version})` : ''}
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">Markdown is supported.</p>
          <Textarea
            aria-label="Code of Conduct markdown"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setNotice(null)
            }}
            rows={24}
            className="font-mono text-sm"
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={openConfirm} disabled={!current || unchanged || !draft.trim()}>
              Publish new version
            </Button>
            <Button
              variant="outline"
              onClick={() => current && setDraft(current.body)}
              disabled={!current || unchanged}
            >
              Discard changes
            </Button>
          </div>
        </section>

        <section className={card}>
          <h2 className="mt-0 mb-2 text-lg font-semibold">Preview</h2>
          <div
            tabIndex={0}
            role="region"
            aria-label="Code of Conduct preview"
            className="coc-markdown max-h-[36rem] overflow-y-auto rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed"
          >
            <ReactMarkdown>{draft}</ReactMarkdown>
          </div>
        </section>
      </div>

      <section className={card}>
        <h2 className="mt-0 mb-2 text-lg font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {history.map((v) => (
            <li key={v.version}>
              <strong>Version {v.version}</strong> · published {v.published_at} UTC
              {v.published_by_name ? ` by ${v.published_by_name}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={confirming} onOpenChange={(open) => !publishing && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish a new Code of Conduct?</DialogTitle>
            <DialogDescription>
              {signedCount === null
                ? 'Every member who has signed will need to re-sign.'
                : `All ${signedCount} members who have signed will need to re-sign.`}{' '}
              Anyone already booked on a shift can't check in until they do.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={publishing}>
              Cancel
            </Button>
            <Button onClick={handlePublish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

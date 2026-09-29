import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { AuthError, acceptCodeOfConduct, getCurrentCoc } from '@/lib/auth'
import type { CocVersion } from '@/types/CocVersion'

interface CodeOfConductProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, modal hides the accept/decline flow and just lets the user re-read. */
  readOnly?: boolean
  /** Called once the server has recorded the signature. */
  onAccept?: () => void
  onDecline?: () => void
}

export default function CodeOfConduct({
  open,
  onOpenChange,
  readOnly = false,
  onAccept,
  onDecline,
}: CodeOfConductProps) {
  const [agreed, setAgreed] = useState(false)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)
  const [coc, setCoc] = useState<CocVersion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const loadCoc = () => {
    setCoc(null)
    return getCurrentCoc()
      .then(setCoc)
      .catch(() => setError('Could not load the Code of Conduct. Please try again later.'))
  }

  useEffect(() => {
    if (open) {
      setError(null)
      loadCoc()
    } else {
      setAgreed(false)
      setHasScrolledToBottom(false)
    }
  }, [open])

  const handleAccept = async () => {
    if (!coc) return
    setSubmitting(true)
    setError(null)
    try {
      await acceptCodeOfConduct(coc.version)
      onAccept?.()
    } catch (e) {
      if (e instanceof AuthError && e.status === 409) {
        // A new version was published while this one was open: make them read it.
        setAgreed(false)
        setHasScrolledToBottom(false)
        await loadCoc()
        setError('The Code of Conduct was just updated. Please read the new version.')
      } else {
        setError(e instanceof Error ? e.message : 'Failed to accept Code of Conduct')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 10) {
      setHasScrolledToBottom(true)
    }
  }

  // In the accept flow, block ESC / outside-click — the user must explicitly
  // accept or decline. In read-only mode, normal close behaviour is fine.
  const blockClose = (e: Event) => {
    if (!readOnly) e.preventDefault()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl flex max-h-[90vh] flex-col gap-4"
        showCloseButton={readOnly}
        onEscapeKeyDown={blockClose}
        onPointerDownOutside={blockClose}
        onInteractOutside={blockClose}
        aria-describedby={readOnly ? undefined : 'coc-description'}
      >
        <DialogHeader>
          <DialogTitle>Code of Conduct</DialogTitle>
          {!readOnly && (
            <DialogDescription id="coc-description">
              Please read the full Code of Conduct, then confirm your agreement to continue.
            </DialogDescription>
          )}
        </DialogHeader>

        <div
          onScroll={handleScroll}
          tabIndex={0}
          role="region"
          aria-label="Code of conduct text"
          className="coc-markdown flex-1 min-h-0 overflow-y-auto rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed"
        >
          {coc ? (
            <ReactMarkdown>{coc.body}</ReactMarkdown>
          ) : (
            !error && <p className="text-muted-foreground">Loading…</p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!readOnly && !hasScrolledToBottom && (
          <p className="text-center text-xs text-muted-foreground">
            ↓ Scroll to the bottom to continue ↓
          </p>
        )}

        {!readOnly && (
          <label
            className={cn(
              'flex items-center gap-3 text-sm',
              hasScrolledToBottom ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={!hasScrolledToBottom}
              className="h-4 w-4 accent-primary"
            />
            <span>
              I confirm that I have read, understood, and agree to abide by the above Code of Conduct.
            </span>
          </label>
        )}

        <DialogFooter>
          {readOnly ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onDecline}>
                Decline
              </Button>
              <Button onClick={handleAccept} disabled={!agreed || !coc || submitting}>
                Accept and Continue
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

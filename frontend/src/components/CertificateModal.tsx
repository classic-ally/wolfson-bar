import { useEffect, useState } from 'react'
import { getCertificateData, CertificateData } from '../lib/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface CertificateModalProps {
  userId: string
  displayName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApprove: () => void
  /** Override the data loader. Defaults to fetching via the API.
   *  Useful for stories and tests that need to render with fixture data. */
  loader?: (userId: string) => Promise<CertificateData>
}

export default function CertificateModal({
  userId,
  displayName,
  open,
  onOpenChange,
  onApprove,
  loader = getCertificateData,
}: CertificateModalProps) {
  const [certificate, setCertificate] = useState<CertificateData | null>(null)
  const [loadError, setLoadError] = useState(false)
  // Inline render failed (e.g. a PDF that reached an <img>, or a corrupt
  // file). We always offer the download link as a fallback.
  const [renderError, setRenderError] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    let createdUrl: string | null = null
    setCertificate(null)
    setLoadError(false)
    setRenderError(false)
    loader(userId)
      .then((data) => {
        if (!active) {
          // Modal closed before the fetch resolved — don't leak the blob.
          URL.revokeObjectURL(data.url)
          return
        }
        createdUrl = data.url
        setCertificate(data)
      })
      .catch((err) => {
        console.error('Failed to load certificate:', err)
        if (active) setLoadError(true)
      })
    return () => {
      active = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [userId, open, loader])

  const contentType = certificate?.contentType ?? ''
  const isPdf = contentType === 'application/pdf'
  const isImage = contentType.startsWith('image/')
  const canRenderInline = (isPdf || isImage) && !renderError

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isPdf && canRenderInline
            ? 'sm:max-w-5xl h-[90vh] flex flex-col'
            : 'sm:max-w-3xl max-h-[90vh] overflow-auto'
        }
      >
        <DialogHeader>
          <DialogTitle>Food Safety Certificate</DialogTitle>
          <DialogDescription>User: {displayName || 'Unknown'}</DialogDescription>
        </DialogHeader>

        <div
          className={
            isPdf && canRenderInline
              ? 'flex-1 min-h-0 flex items-stretch justify-center'
              : 'flex flex-col items-center justify-center gap-3 py-4'
          }
        >
          {loadError ? (
            <p className="p-10 text-center text-destructive">
              Could not load this certificate. It may have been removed.
            </p>
          ) : !certificate ? (
            <div className="p-10 text-muted-foreground">Loading…</div>
          ) : !canRenderInline ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                This certificate can’t be previewed here
                {contentType ? ` (${contentType})` : ''}. Open it to review.
              </p>
              <a
                href={certificate.url}
                target="_blank"
                rel="noreferrer"
                download
                aria-label="Open or download the certificate"
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Open / download certificate
              </a>
            </div>
          ) : isPdf ? (
            <iframe
              src={certificate.url}
              title="Food Safety Certificate"
              onError={() => setRenderError(true)}
              className="h-full w-full rounded-md border border-border"
            />
          ) : (
            <img
              src={certificate.url}
              alt="Food Safety Certificate"
              onError={() => setRenderError(true)}
              className="max-h-[60vh] max-w-full rounded-md border border-border"
            />
          )}
        </div>

        <DialogFooter>
          {certificate && (
            <a
              href={certificate.url}
              target="_blank"
              rel="noreferrer"
              download
              aria-label="Open the certificate in a new tab"
              className="mr-auto inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open in new tab
            </a>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onApprove}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

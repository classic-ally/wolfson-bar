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

  useEffect(() => {
    if (!open) return
    let revoked: string | null = null
    loader(userId)
      .then((data) => {
        setCertificate(data)
        revoked = data.url
      })
      .catch((err) => console.error('Failed to load certificate:', err))
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [userId, open, loader])

  const isPdf = certificate?.contentType === 'application/pdf'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isPdf
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
            isPdf
              ? 'flex-1 min-h-0 flex items-stretch justify-center'
              : 'flex items-center justify-center py-2'
          }
        >
          {!certificate ? (
            <div className="p-10 text-muted-foreground">Loading…</div>
          ) : isPdf ? (
            <iframe
              src={certificate.url}
              title="Food Safety Certificate"
              className="h-full w-full rounded-md border border-border"
            />
          ) : (
            <img
              src={certificate.url}
              alt="Food Safety Certificate"
              className="max-h-[60vh] max-w-full rounded-md border border-border"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onApprove}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

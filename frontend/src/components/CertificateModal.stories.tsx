import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import CertificateModal from './CertificateModal'
import { Button } from '@/components/ui/button'
import type { CertificateData } from '@/lib/auth'

// Minimal valid one-page PDF (Hello World). Encoded as base64 to keep the
// fixture inline. Real-world certificates would be far larger but this proves
// the iframe path renders correctly inside the dialog.
const MINIMAL_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA0MDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+Pj4vQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iago8PC9MZW5ndGggNDQ+PgpzdHJlYW0KQlQKL0YxIDE4IFRmCjUwIDEwMCBUZAooSGVsbG8gV29ybGQpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTYgMDAwMDAgbiAKMDAwMDAwMDExMSAwMDAwMCBuIAowMDAwMDAwMjQyIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMzM2CiUlRU9G'

const SVG_FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#f3f4f6"/>
  <rect x="40" y="40" width="520" height="320" fill="#fff" stroke="#9ca3af" stroke-width="2"/>
  <text x="300" y="120" font-family="Helvetica" font-size="28" text-anchor="middle" fill="#111827">Food Safety Certificate</text>
  <text x="300" y="180" font-family="Helvetica" font-size="18" text-anchor="middle" fill="#374151">Awarded to</text>
  <text x="300" y="220" font-family="Helvetica" font-size="24" font-weight="bold" text-anchor="middle" fill="#002147">Allison Bentley</text>
  <text x="300" y="280" font-family="Helvetica" font-size="14" text-anchor="middle" fill="#6b7280">Issued 2026-04-15 — Storybook fixture</text>
</svg>`

function pdfLoader(): Promise<CertificateData> {
  const bytes = atob(MINIMAL_PDF_BASE64)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  const blob = new Blob([buf], { type: 'application/pdf' })
  return Promise.resolve({
    url: URL.createObjectURL(blob),
    contentType: 'application/pdf',
  })
}

function imageLoader(): Promise<CertificateData> {
  const blob = new Blob([SVG_FIXTURE], { type: 'image/svg+xml' })
  return Promise.resolve({
    url: URL.createObjectURL(blob),
    contentType: 'image/svg+xml',
  })
}

const meta = {
  title: 'Committee/CertificateModal',
  component: CertificateModal,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CertificateModal>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper({
  loader,
  name,
  startOpen = false,
}: {
  loader: (userId: string) => Promise<CertificateData>
  name: string | null
  startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="p-8 space-y-2">
      <p className="text-sm text-muted-foreground">User: {name ?? 'Unknown'}</p>
      <Button onClick={() => setOpen(true)}>Open Certificate Viewer</Button>
      <CertificateModal
        userId="story-user-cert"
        displayName={name}
        open={open}
        onOpenChange={setOpen}
        onApprove={() => {
          alert('Approved!')
          setOpen(false)
        }}
        loader={loader}
      />
    </div>
  )
}

export const ImageCertificate: Story = {
  render: () => <Wrapper loader={imageLoader} name="Allison Bentley" startOpen />,
  args: {
    userId: 'story-user-cert',
    displayName: 'Allison Bentley',
    open: true,
    onOpenChange: () => {},
    onApprove: () => {},
  },
}

export const PdfCertificate: Story = {
  render: () => <Wrapper loader={pdfLoader} name="Allison Bentley" startOpen />,
  args: {
    userId: 'story-user-cert',
    displayName: 'Allison Bentley',
    open: true,
    onOpenChange: () => {},
    onApprove: () => {},
  },
}

export const LoadingState: Story = {
  render: () => (
    <Wrapper
      loader={() => new Promise(() => {})}
      name="Allison Bentley"
      startOpen
    />
  ),
  args: {
    userId: 'story-user-cert',
    displayName: 'Allison Bentley',
    open: true,
    onOpenChange: () => {},
    onApprove: () => {},
  },
}

export const UnknownUser: Story = {
  render: () => <Wrapper loader={imageLoader} name={null} startOpen />,
  args: {
    userId: 'story-user-cert',
    displayName: null,
    open: true,
    onOpenChange: () => {},
    onApprove: () => {},
  },
}

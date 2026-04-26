import { useState } from 'react'
import { loginWithPasskey, requestMagicLink } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface SignInModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after a successful passkey login. */
  onSignedIn: () => void
}

export default function SignInModal({ open, onOpenChange, onSignedIn }: SignInModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [magicLinkEmail, setMagicLinkEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkSending, setMagicLinkSending] = useState(false)

  const reset = () => {
    setMagicLinkEmail('')
    setMagicLinkSent(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handlePasskey = async () => {
    setIsLoading(true)
    try {
      await loginWithPasskey()
      onSignedIn()
      onOpenChange(false)
      reset()
      alert('Login successful! 🎉')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      alert(`Passkey login failed: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!magicLinkEmail.trim()) return
    setMagicLinkSending(true)
    try {
      await requestMagicLink(magicLinkEmail.trim())
      setMagicLinkSent(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send sign-in link'
      alert(message)
    } finally {
      setMagicLinkSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign In</DialogTitle>
          {!magicLinkSent && (
            <DialogDescription>
              Use your passkey, or get a sign-in link by email.
            </DialogDescription>
          )}
        </DialogHeader>

        {magicLinkSent ? (
          <div className="space-y-3 text-sm">
            <p>
              If an account exists with{' '}
              <strong className="text-foreground">{magicLinkEmail}</strong>, we've sent
              a sign-in link. Check your inbox.
            </p>
            <p className="text-muted-foreground">The link expires in 15 minutes.</p>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Try again
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Button onClick={handlePasskey} disabled={isLoading} className="w-full">
              {isLoading ? 'Authenticating…' : 'Sign in with Passkey'}
            </Button>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleMagicLink} className="space-y-2">
              <input
                type="email"
                value={magicLinkEmail}
                onChange={(e) => setMagicLinkEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={magicLinkSending}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={magicLinkSending || !magicLinkEmail.trim()}
                className="w-full"
              >
                {magicLinkSending ? 'Sending…' : 'Send sign-in link'}
              </Button>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

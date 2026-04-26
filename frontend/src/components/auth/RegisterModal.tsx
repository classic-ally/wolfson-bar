import { useState } from 'react'
import { registerWithPasskey, registerWithEmail } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface RegisterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after a successful passkey registration (logs the user in). */
  onRegistered: () => void
}

export default function RegisterModal({
  open,
  onOpenChange,
  onRegistered,
}: RegisterModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [passkeyFailed, setPasskeyFailed] = useState(false)

  const reset = () => {
    setName('')
    setEmail('')
    setEmailSent(false)
    setPasskeyFailed(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handlePasskeySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setIsLoading(true)
    try {
      await registerWithPasskey(name.trim(), email.trim() || undefined)
      onRegistered()
      onOpenChange(false)
      reset()
      alert('Registration successful! 🎉 You can now claim shifts.')
    } catch (err) {
      if (email.trim()) {
        setPasskeyFailed(true)
      } else {
        const message = err instanceof Error ? err.message : 'Registration failed'
        alert(`Registration failed: ${message}\n\nEnter an email address to register without a passkey.`)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleEmailFallback = async () => {
    if (!name.trim() || !email.trim()) return
    setIsLoading(true)
    try {
      await registerWithEmail(name.trim(), email.trim())
      setEmailSent(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      alert(`Registration failed: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Join the Rota</DialogTitle>
          {!emailSent && !passkeyFailed && (
            <DialogDescription>
              Enter your name to create your account with a passkey.
            </DialogDescription>
          )}
        </DialogHeader>

        {emailSent ? (
          <div className="space-y-3 text-sm">
            <p>
              Account created! Check{' '}
              <strong className="text-foreground">{email}</strong> for a sign-in link.
            </p>
            <p className="text-muted-foreground">The link expires in 15 minutes.</p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)} className="w-full">
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : passkeyFailed ? (
          <div className="space-y-3 text-sm">
            <p>
              Passkey setup didn't work on this device. We can create your account with
              email instead — you'll receive a sign-in link.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasskeyFailed(false)}>
                Try Passkey Again
              </Button>
              <Button onClick={handleEmailFallback} disabled={isLoading}>
                {isLoading ? 'Creating…' : 'Register with Email'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handlePasskeySubmit} className="space-y-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Your name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Allison Bentley"
                autoFocus
                disabled={isLoading}
                className="h-9 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Email <span className="text-muted-foreground font-normal">(optional)</span></span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={isLoading}
                className="h-9 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="text-xs text-muted-foreground">
                Used for magic link sign-in and shift notifications.
              </span>
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !name.trim()}>
                {isLoading ? 'Creating…' : 'Create Account'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

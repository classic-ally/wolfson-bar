import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import Page from './Page'
import SignInModal from './auth/SignInModal'
import { Button } from '@/components/ui/button'
import { AuthError, checkInShift, isLoggedIn } from '../lib/auth'
import { rememberReturnTo } from '../lib/returnTo'
import type { CheckInResponse } from '../types/CheckInResponse'

// Public landing page a rota member reaches by scanning the kiosk QR.
type State = 'idle' | 'checking' | 'success' | 'expired' | 'error' | 'needauth'

export default function CheckInPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const code = params.get('code') || ''
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  // 403: onboarding incomplete (typically a Code of Conduct to re-sign).
  const [forbidden, setForbidden] = useState(false)
  const [result, setResult] = useState<CheckInResponse | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)

  async function submit() {
    setState('checking')
    try {
      setResult(await checkInShift(code))
      setState('success')
    } catch (e) {
      // The kiosk code rotates every 30s; after a sign-in round trip it has usually moved on.
      if (e instanceof AuthError && e.status === 400) {
        setState('expired')
        return
      }
      setForbidden(e instanceof AuthError && e.status === 403)
      setMessage(e instanceof Error ? e.message : 'Check-in failed')
      setState('error')
    }
  }

  useEffect(() => {
    if (!code) {
      setMessage('Missing check-in code. Scan the QR on the bar screen.')
      setState('error')
      return
    }
    if (isLoggedIn()) {
      submit()
    } else {
      // Passkey login reloads and magic links go via email: both come back here.
      rememberReturnTo(location.pathname + location.search)
      setState('needauth')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Page size="narrow">
      <div style={{ textAlign: 'center' }}>
        {state === 'checking' && <h2>Checking you in…</h2>}

        {state === 'success' && result && (
          <>
            <h2 style={{ color: '#198754' }}>✅ You're checked in!</h2>
            <p style={{ color: '#666' }}>
              {result.was_signed_up
                ? 'Thanks for taking your shift.'
                : 'Walk-in recorded — thanks for covering.'}
            </p>
            <p style={{ color: '#666' }}>
              {result.bar_open
                ? 'The bar is marked open.'
                : "The bar's scheduled hours are over, so it hasn't been marked open."}
            </p>
          </>
        )}

        {state === 'needauth' && (
          <>
            <h2>Sign in to check in</h2>
            <p style={{ color: '#666' }}>
              Sign in with your passkey or an email link to record your attendance.
            </p>
            <Button onClick={() => setSignInOpen(true)}>Sign in</Button>
            <SignInModal open={signInOpen} onOpenChange={setSignInOpen} onSignedIn={() => {}} />
          </>
        )}

        {state === 'expired' && (
          <>
            <h2>Code expired</h2>
            <p style={{ color: '#666' }}>
              The check-in code changes every 30 seconds. Scan the QR on the bar screen again.
            </p>
          </>
        )}

        {state === 'error' && (
          <>
            <h2 style={{ color: '#dc3545' }}>Couldn't check you in</h2>
            <p style={{ color: '#666' }}>{message}</p>
            <div className="mt-4">
              {forbidden ? (
                <Button asChild>
                  <Link to="/profile/induction">Go to your onboarding checklist</Link>
                </Button>
              ) : (
                code && <Button onClick={submit}>Try again</Button>
              )}
            </div>
          </>
        )}
      </div>
    </Page>
  )
}

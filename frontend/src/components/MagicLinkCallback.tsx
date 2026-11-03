import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Page from './Page'
import { Button } from '@/components/ui/button'
import { redeemMagicLink } from '../lib/auth'
import { consumeReturnTo } from '../lib/returnTo'

/** Sign-in step for a magic link. The link is single-use and only redeemed when
 *  the member presses the button, so mail scanners that prefetch the link from
 *  the email can't use it up. */
export default function MagicLinkCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const [error, setError] = useState<string | null>(token ? null : 'Invalid magic link. Please try again.')
  const [signingIn, setSigningIn] = useState(false)

  const signIn = async () => {
    if (!token) return
    setSigningIn(true)
    setError(null)
    try {
      await redeemMagicLink(token)
      // Back to the page that asked for login (e.g. a kiosk check-in), else home
      navigate(consumeReturnTo() ?? '/', { replace: true })
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in')
      setSigningIn(false)
    }
  }

  return (
    <Page size="narrow">
      <div style={{ textAlign: 'center' }}>
        {error ? (
          <>
            <h2 style={{ color: '#dc3545' }}>Sign-in Failed</h2>
            <p style={{ color: '#666' }}>{error}</p>
            <Button variant="outline" onClick={() => navigate('/')}>
              Go Home
            </Button>
          </>
        ) : (
          <>
            <h2>Sign in to Wolfson Cellar Bar</h2>
            <p style={{ color: '#666' }}>Press the button to finish signing in.</p>
            <Button onClick={signIn} disabled={signingIn}>
              {signingIn ? 'Signing in…' : 'Sign in'}
            </Button>
          </>
        )}
      </div>
    </Page>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Page from './Page'
import { checkInShift, isLoggedIn, loginWithPasskey } from '../lib/auth'

// Public landing page a rota member reaches by scanning the kiosk QR.
type State = 'idle' | 'checking' | 'success' | 'error' | 'needauth'

const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  backgroundColor: '#8B0000',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
}

export default function CheckInPage() {
  const [params] = useSearchParams()
  const code = params.get('code') || ''
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  const [wasSignedUp, setWasSignedUp] = useState(false)

  async function submit() {
    setState('checking')
    try {
      const res = await checkInShift(code)
      setWasSignedUp(res.was_signed_up)
      setState('success')
    } catch (e) {
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
      setState('needauth')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLogin() {
    try {
      // On success this reloads; isLoggedIn() then true and the effect submits.
      await loginWithPasskey()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Login failed')
    }
  }

  return (
    <Page size="narrow">
      <div style={{ textAlign: 'center' }}>
        {state === 'checking' && <h2>Checking you in…</h2>}

        {state === 'success' && (
          <>
            <h2 style={{ color: '#198754' }}>✅ You're checked in!</h2>
            <p style={{ color: '#666' }}>
              {wasSignedUp
                ? 'Thanks for taking your shift.'
                : 'Walk-in recorded — thanks for covering.'}
            </p>
            <p style={{ color: '#666' }}>The bar is now marked open.</p>
          </>
        )}

        {state === 'needauth' && (
          <>
            <h2>Log in to check in</h2>
            <p style={{ color: '#666' }}>
              Sign in with your passkey to record your attendance.
            </p>
            <button onClick={handleLogin} style={buttonStyle}>
              Log in with passkey
            </button>
            {message && <p style={{ color: '#dc3545', marginTop: 16 }}>{message}</p>}
          </>
        )}

        {state === 'error' && (
          <>
            <h2 style={{ color: '#dc3545' }}>Couldn't check you in</h2>
            <p style={{ color: '#666' }}>{message}</p>
            {code && (
              <button onClick={submit} style={buttonStyle}>
                Try again
              </button>
            )}
          </>
        )}
      </div>
    </Page>
  )
}

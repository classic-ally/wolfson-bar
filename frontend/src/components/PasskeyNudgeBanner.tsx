import { useState, useEffect } from 'react'
import { isLoggedIn, getUserStatus, startPasskeySetup, UserStatus } from '../lib/auth'

const DISMISS_KEY = 'passkey_nudge_dismissed'

export default function PasskeyNudgeBanner() {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [dismissed, setDismissed] = useState(localStorage.getItem(DISMISS_KEY) === 'true')
  const [setting, setSetting] = useState(false)

  useEffect(() => {
    if (!isLoggedIn() || dismissed) return
    getUserStatus().then(setStatus).catch(() => {})
  }, [dismissed])

  if (!isLoggedIn() || dismissed || !status || status.has_passkey) return null

  const handleSetup = async () => {
    setSetting(true)
    try {
      await startPasskeySetup()
      alert('Passkey set up successfully! You can now use it to sign in.')
      setStatus({ ...status, has_passkey: true })
    } catch (err) {
      console.error('Passkey setup failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to set up passkey. Please try again.')
    } finally {
      setSetting(false)
    }
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  return (
    <div style={{
      backgroundColor: '#e7f3ff',
      borderBottom: '1px solid #b8daff',
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '15px',
      fontSize: '14px',
    }}>
      <span>Set up a passkey for faster, more secure login</span>
      <button
        onClick={handleSetup}
        disabled={setting}
        style={{
          padding: '4px 12px',
          backgroundColor: setting ? '#ccc' : '#0d6efd',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: setting ? 'not-allowed' : 'pointer',
          fontSize: '13px',
        }}
      >
        {setting ? 'Setting up...' : 'Set Up Passkey'}
      </button>
      <button
        onClick={handleDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: '#666',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '0 4px',
        }}
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

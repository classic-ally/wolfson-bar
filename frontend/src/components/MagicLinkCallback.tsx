import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

export default function MagicLinkCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')
    const userId = searchParams.get('user_id')
    const isCommittee = searchParams.get('is_committee')
    const isAdmin = searchParams.get('is_admin')

    if (!token || !userId) {
      setError('Invalid magic link. Please try again.')
      return
    }

    // Store auth data
    localStorage.setItem('auth_token', token)
    localStorage.setItem('user_id', userId)
    localStorage.setItem('is_committee', isCommittee === 'true' ? 'true' : 'false')
    localStorage.setItem('is_admin', isAdmin === 'true' ? 'true' : 'false')

    // Redirect to home
    navigate('/', { replace: true })
    window.location.reload()
  }, [searchParams, navigate])

  if (error) {
    return (
      <div style={{ maxWidth: '500px', margin: '100px auto', padding: '30px', textAlign: 'center' }}>
        <h2 style={{ color: '#dc3545' }}>Sign-in Failed</h2>
        <p style={{ color: '#666' }}>{error}</p>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '10px 20px',
            backgroundColor: '#8B0000',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Go Home
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '500px', margin: '100px auto', padding: '30px', textAlign: 'center' }}>
      <h2>Signing you in...</h2>
      <p style={{ color: '#666' }}>Please wait while we complete your sign-in.</p>
    </div>
  )
}

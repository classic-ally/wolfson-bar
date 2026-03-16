import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerWithPasskey, registerWithEmail, loginWithPasskey, isLoggedIn, logout, getUserStatus, isCommittee, isAdmin, requestMagicLink } from '../lib/auth'

export function LoginButton() {
  const [isLoading, setIsLoading] = useState(false)
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const [showMenu, setShowMenu] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [registerName, setRegisterName] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerEmailSent, setRegisterEmailSent] = useState(false)
  const [passkeyFailed, setPasskeyFailed] = useState(false)
  const [magicLinkEmail, setMagicLinkEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkSending, setMagicLinkSending] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (loggedIn) {
      loadUserInfo()
    }
  }, [loggedIn])

  async function loadUserInfo() {
    try {
      const status = await getUserStatus()
      setDisplayName(status.display_name)
    } catch (err) {
      console.error('Failed to load user info:', err)
    }
  }

  async function handleRegisterClick() {
    setShowMenu(false)
    setShowRegisterForm(true)
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!registerName.trim()) return

    setIsLoading(true)

    try {
      await registerWithPasskey(registerName.trim(), registerEmail.trim() || undefined)
      setLoggedIn(true)
      setShowRegisterForm(false)
      setRegisterName('')
      setRegisterEmail('')
      alert('Registration successful! 🎉 You can now claim shifts.')
    } catch (err) {
      // If passkey failed and user provided an email, offer email-only registration
      if (registerEmail.trim()) {
        setPasskeyFailed(true)
      } else {
        const message = err instanceof Error ? err.message : 'Registration failed'
        alert(`Registration failed: ${message}\n\nEnter an email address to register without a passkey.`)
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function handleRegisterWithEmail() {
    if (!registerName.trim() || !registerEmail.trim()) return

    setIsLoading(true)
    try {
      await registerWithEmail(registerName.trim(), registerEmail.trim())
      setRegisterEmailSent(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      alert(`Registration failed: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  async function handlePasskeyLogin() {
    setIsLoading(true)

    try {
      await loginWithPasskey()
      setLoggedIn(true)
      setShowLoginModal(false)
      alert('Login successful! 🎉')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      alert(`Passkey login failed: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
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

  function openLoginModal() {
    setShowMenu(false)
    setShowLoginModal(true)
    setMagicLinkEmail('')
    setMagicLinkSent(false)
  }

  function closeLoginModal() {
    setShowLoginModal(false)
    setMagicLinkEmail('')
    setMagicLinkSent(false)
  }

  function handleLogout() {
    logout()
    setLoggedIn(false)
    setDisplayName(null)
    setShowMenu(false)
    navigate('/')
  }

  const buttonStyle = {
    padding: '8px 16px',
    backgroundColor: '#8B0000',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: isLoading ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    fontWeight: 500
  }

  const menuItemStyle = {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: 'white',
    color: '#333',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    textAlign: 'left' as const,
    display: 'block'
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={isLoading}
        style={buttonStyle}
      >
        {isLoading ? 'Processing...' : loggedIn ? `👤 ${displayName || 'User'}` : 'Rota Members'}
      </button>

      {showMenu && !isLoading && (
        <>
          <div
            onClick={() => setShowMenu(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              backgroundColor: 'white',
              border: '1px solid #ddd',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1000,
              minWidth: '200px'
            }}
          >
            {loggedIn ? (
              <>
                <button
                  onClick={() => {
                    setShowMenu(false)
                    navigate('/profile')
                  }}
                  style={{
                    ...menuItemStyle,
                    borderBottom: '1px solid #eee',
                    borderRadius: '4px 4px 0 0'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  My Profile
                </button>
                {isCommittee() && (
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      navigate('/committee')
                    }}
                    style={{
                      ...menuItemStyle,
                      borderBottom: '1px solid #eee'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                  >
                    Committee
                  </button>
                )}
                {isAdmin() && (
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      navigate('/admin')
                    }}
                    style={{
                      ...menuItemStyle,
                      borderBottom: '1px solid #eee'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                  >
                    Admin
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  style={{
                    ...menuItemStyle,
                    borderRadius: '0 0 4px 4px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  Log Out
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={openLoginModal}
                  style={{
                    ...menuItemStyle,
                    borderBottom: '1px solid #eee',
                    borderRadius: '4px 4px 0 0'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  Sign In
                </button>
                <button
                  onClick={handleRegisterClick}
                  style={{
                    ...menuItemStyle,
                    borderRadius: '0 0 4px 4px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  Join Rota
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Unified Sign In Modal */}
      {showLoginModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
          onClick={closeLoginModal}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '24px', color: '#002147' }}>Sign In</h2>

            {magicLinkSent ? (
              <>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  If an account exists with <strong>{magicLinkEmail}</strong>, we've sent a sign-in link.
                  Check your inbox.
                </p>
                <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
                  The link expires in 15 minutes.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setMagicLinkSent(false); setMagicLinkEmail('') }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Try again
                  </button>
                  <button
                    onClick={closeLoginModal}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#8B0000',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Passkey — primary option */}
                <button
                  onClick={handlePasskeyLogin}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: isLoading ? '#ccc' : '#8B0000',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: 500,
                  }}
                >
                  {isLoading ? 'Authenticating...' : 'Sign in with Passkey'}
                </button>

                {/* Divider */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  margin: '20px 0',
                  gap: '12px',
                }}>
                  <div style={{ flex: 1, height: '1px', backgroundColor: '#ddd' }} />
                  <span style={{ color: '#999', fontSize: '13px' }}>or</span>
                  <div style={{ flex: 1, height: '1px', backgroundColor: '#ddd' }} />
                </div>

                {/* Email — fallback */}
                <form onSubmit={handleMagicLinkSubmit}>
                  <input
                    type="email"
                    value={magicLinkEmail}
                    onChange={(e) => setMagicLinkEmail(e.target.value)}
                    placeholder="your@email.com"
                    disabled={magicLinkSending}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '16px',
                      marginBottom: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={magicLinkSending || !magicLinkEmail.trim()}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: magicLinkSending || !magicLinkEmail.trim() ? '#ccc' : '#002147',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: magicLinkSending || !magicLinkEmail.trim() ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    {magicLinkSending ? 'Sending...' : 'Send sign-in link'}
                  </button>
                </form>

                <button
                  onClick={closeLoginModal}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: 'transparent',
                    color: '#666',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    marginTop: '12px',
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Register Modal */}
      {showRegisterForm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
          onClick={() => setShowRegisterForm(false)}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, color: '#002147' }}>Join the Rota</h2>

            {registerEmailSent ? (
              <>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Account created! Check <strong>{registerEmail}</strong> for a sign-in link.
                </p>
                <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
                  The link expires in 15 minutes.
                </p>
                <button
                  onClick={() => { setShowRegisterForm(false); setRegisterEmailSent(false); setPasskeyFailed(false); setRegisterName(''); setRegisterEmail('') }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: '#8B0000',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Close
                </button>
              </>
            ) : passkeyFailed ? (
              <>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Passkey setup didn't work on this device. We can create your account with email instead — you'll receive a sign-in link.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setPasskeyFailed(false) }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Try Passkey Again
                  </button>
                  <button
                    onClick={handleRegisterWithEmail}
                    disabled={isLoading}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: isLoading ? '#ccc' : '#8B0000',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    {isLoading ? 'Creating...' : 'Register with Email'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Enter your name to create your account with a passkey.
                </p>
                <form onSubmit={handleRegisterSubmit}>
                  <input
                    type="text"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                    disabled={isLoading}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '16px',
                      marginBottom: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <input
                    type="email"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    placeholder="Email (optional)"
                    disabled={isLoading}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '16px',
                      marginBottom: '8px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <p style={{ color: '#888', fontSize: '12px', marginTop: 0, marginBottom: '20px' }}>
                    Used for magic link sign-in and shift notifications.
                  </p>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setShowRegisterForm(false)}
                      disabled={isLoading}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading || !registerName.trim()}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: isLoading || !registerName.trim() ? '#ccc' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isLoading || !registerName.trim() ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                      }}
                    >
                      {isLoading ? 'Creating...' : 'Create Account'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

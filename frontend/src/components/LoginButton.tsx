import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerWithPasskey, loginWithPasskey, isLoggedIn, logout, getUserStatus, isCommittee } from '../lib/auth'

export function LoginButton() {
  const [isLoading, setIsLoading] = useState(false)
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const [showMenu, setShowMenu] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [registerName, setRegisterName] = useState('')
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
      await registerWithPasskey(registerName.trim())
      setLoggedIn(true)
      setShowRegisterForm(false)
      setRegisterName('')
      alert('Registration successful! 🎉 You can now claim shifts.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      alert(`Registration failed: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLogin() {
    setIsLoading(true)
    setShowMenu(false)

    try {
      await loginWithPasskey()
      setLoggedIn(true)
      alert('Login successful! 🎉')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      alert(`Login failed: ${message}`)
    } finally {
      setIsLoading(false)
    }
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
                  onClick={handleLogin}
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
                  marginBottom: '20px',
                  boxSizing: 'border-box',
                }}
              />
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
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isLoggedIn, logout, getUserStatus, isCommittee, isAdmin } from '../lib/auth'
import SignInModal from './auth/SignInModal'
import RegisterModal from './auth/RegisterModal'

export function LoginButton() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const [showMenu, setShowMenu] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
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
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
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
    display: 'block',
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setShowMenu(!showMenu)} style={buttonStyle}>
        {loggedIn ? `👤 ${displayName || 'User'}` : 'Rota Members'}
      </button>

      {showMenu && (
        <>
          <div
            onClick={() => setShowMenu(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
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
              minWidth: '200px',
            }}
          >
            {loggedIn ? (
              <>
                <button
                  onClick={() => {
                    setShowMenu(false)
                    navigate('/profile')
                  }}
                  style={{ ...menuItemStyle, borderBottom: '1px solid #eee', borderRadius: '4px 4px 0 0' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                >
                  My Profile
                </button>
                {isCommittee() && (
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      navigate('/committee')
                    }}
                    style={{ ...menuItemStyle, borderBottom: '1px solid #eee' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
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
                    style={{ ...menuItemStyle, borderBottom: '1px solid #eee' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                  >
                    Admin
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  style={{ ...menuItemStyle, borderRadius: '0 0 4px 4px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                >
                  Log Out
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setShowMenu(false)
                    setShowLoginModal(true)
                  }}
                  style={{ ...menuItemStyle, borderBottom: '1px solid #eee', borderRadius: '4px 4px 0 0' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                >
                  Sign In
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false)
                    setShowRegisterForm(true)
                  }}
                  style={{ ...menuItemStyle, borderRadius: '0 0 4px 4px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                >
                  Join Rota
                </button>
              </>
            )}
          </div>
        </>
      )}

      <SignInModal
        open={showLoginModal}
        onOpenChange={setShowLoginModal}
        onSignedIn={() => setLoggedIn(true)}
      />
      <RegisterModal
        open={showRegisterForm}
        onOpenChange={setShowRegisterForm}
        onRegistered={() => setLoggedIn(true)}
      />
    </div>
  )
}

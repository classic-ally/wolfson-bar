import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { usePageTitle } from './hooks/usePageTitle'
import { LoginButton } from './components/LoginButton'
import CommitteeLayout from './components/CommitteeLayout'
import AdminLayout from './components/AdminLayout'
import AdminUsers from './components/admin/AdminUsers'
import CommitteeOverview from './components/committee/CommitteeOverview'
import CommitteeEvents from './components/committee/CommitteeEvents'
import CommitteeHours from './components/committee/CommitteeHours'
import CommitteeStock from './components/committee/CommitteeStock'
import CommitteeStockUpdate from './components/committee/CommitteeStockUpdate'
import CommitteeMembers from './components/committee/CommitteeMembers'
import CommitteeInduction from './components/committee/CommitteeInduction'
import OnboardingStatusBar from './components/OnboardingStatusBar'
import UserProfileLayout from './components/UserProfileLayout'
import UserOverview from './components/user/UserOverview'
import UserShifts from './components/user/UserShifts'
import UserProfile from './components/user/UserProfile'
import UserInduction from './components/user/UserInduction'
import AboutPage from './components/AboutPage'
import MenuPage from './components/MenuPage'
import EventsCalendar from './components/EventsCalendar'
import ShiftDetailModal from './components/ShiftDetailModal'
import ProtectedRoute from './components/ProtectedRoute'
import { isLoggedIn, getEvents, Event, getShifts, ShiftInfo, getUserStatus, UserStatus } from './lib/auth'

// Helper to get date range for events (3 months before to 3 months after current month)
function getEventsDateRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 4, 0)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0]
  }
}

function Header() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <>
      <nav className="main-nav">
        <div className="nav-container">
          <div className="logo-title" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <div className="wolfson-logo">
              <img src="/logo.png" alt="Wolfson Cellar Bar Logo" width="40" height="40" />
            </div>
            <h1 className="site-title">Wolfson Cellar Bar</h1>
          </div>
          <div className="nav-menu">
            <Link
              to="/events"
              style={{
                fontWeight: location.pathname === '/events' ? 600 : 400,
                borderBottom: location.pathname === '/events' ? '2px solid white' : 'none'
              }}
            >
              Calendar
            </Link>
            <Link
              to="/menu"
              style={{
                fontWeight: location.pathname === '/menu' ? 600 : 400,
                borderBottom: location.pathname === '/menu' ? '2px solid white' : 'none'
              }}
            >
              Menu
            </Link>
            <Link
              to="/about"
              style={{
                fontWeight: location.pathname === '/about' ? 600 : 400,
                borderBottom: location.pathname === '/about' ? '2px solid white' : 'none'
              }}
            >
              About
            </Link>
          </div>
          <div className="auth-section">
            <LoginButton />
          </div>
        </div>
      </nav>
    </>
  )
}

function HomePage() {
  const navigate = useNavigate()
  usePageTitle()

  return (
    <main className="content">
      <div className="hero-image">
        <img src="/pop-art.jpg" alt="Wolfson Bar Pop Art" className="hero-img" />
        <p className="photo-credit">Photo: George Mather</p>
      </div>

      <div className="intro-text">
        <p>The Cellar Bar is the social heart of Wolfson, run entirely by students and open to, everyone in college. Whether you're here for a quiet pint, a lively bop, a midweek quiz, or a night of live music, there's always something happening.</p>

        <p>We offer some of the most affordable drinks and snacks in Oxford, all served by our friendly rota volunteers. From legendary parties to relaxed evenings with friends, the bar is a space to unwind, connect, and enjoy college life.</p>
      </div>

      <div className="divider">🍺</div>

      <div className="cta-section">
        <button className="cta-button" onClick={() => navigate('/events')}>Explore This Term's Events →</button>
      </div>

      <div className="quote-section">
        <div className="quote-marks">"</div>
        <div className="poem">
          <p><em>Oh the Wolfson wolves they howl at night,</em></p>
          <p><em>With tankards full and spirits bright,</em></p>
          <p><em>They prowl the bar by moonlight's gleam,</em></p>
          <p><em>Where beer flows thick as a scholar's dream</em></p>
        </div>
      </div>
    </main>
  )
}

function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [shifts, setShifts] = useState<ShiftInfo[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [selectedShift, setSelectedShift] = useState<ShiftInfo | null>(null)
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null)
  usePageTitle('Events Calendar')

  useEffect(() => {
    loadEvents()
    if (isLoggedIn()) {
      loadShifts()
      loadUserStatus()
    }
  }, [])

  const loadUserStatus = async () => {
    try {
      const status = await getUserStatus()
      setUserStatus(status)
    } catch (err) {
      console.error('Failed to load user status:', err)
    }
  }

  const loadEvents = async () => {
    setEventsLoading(true)
    try {
      const dateRange = getEventsDateRange()
      const fetchedEvents = await getEvents(dateRange.start, dateRange.end)
      setEvents(fetchedEvents)
    } catch (err) {
      console.error('Failed to load events:', err)
    } finally {
      setEventsLoading(false)
    }
  }

  const loadShifts = async () => {
    try {
      const dateRange = getEventsDateRange()
      const fetchedShifts = await getShifts(dateRange.start, dateRange.end)
      setShifts(fetchedShifts)
    } catch (err) {
      console.error('Failed to load shifts:', err)
    }
  }

  const handleDateClick = (date: Date) => {
    if (!isLoggedIn()) {
      return
    }

    // Don't allow clicking on past dates
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const clickedDate = new Date(date)
    clickedDate.setHours(0, 0, 0, 0)

    if (clickedDate < today) {
      return // Silently ignore clicks on past dates
    }

    // Format date to match shift data
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const dateStr = `${year}-${month}-${day}`

    // Find shift for this date
    const shift = shifts.find(s => s.date === dateStr)
    if (shift) {
      setSelectedShift(shift)
    }
  }

  const handleCloseModal = () => {
    setSelectedShift(null)
  }

  const handleShiftUpdate = () => {
    loadShifts() // Refresh shift data after signup/cancel
  }

  return (
    <main className="content events-page">
      <h1 className="page-header" style={{ marginBottom: '20px' }}>Events Calendar</h1>

      {isLoggedIn() && userStatus && (
        <div style={{ padding: '10px 20px', backgroundColor: '#e7f3ff', borderRadius: '4px', marginBottom: '20px' }}>
          <strong>Shift Signup:</strong> Click on any date to view shift details and sign up.
          <br />
          <span style={{ fontSize: '14px', color: '#666' }}>
            {!userStatus.induction_completed ? (
              <>🔴 Red = No volunteers | 🟡 Yellow = Needs volunteers | ⚪ Grey = No committee (induction only) | No color = Fully staffed</>
            ) : (
              <>🔴 Red = No volunteers | 🟡 Yellow = Needs more volunteers | No color = Fully staffed</>
            )}
          </span>
        </div>
      )}

      {eventsLoading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>Loading events...</div>
      ) : (
        <EventsCalendar
          events={events}
          shifts={isLoggedIn() ? shifts : undefined}
          userStatus={userStatus}
          selectable={isLoggedIn()}
          onSelectSlot={(slotInfo) => handleDateClick(slotInfo.start)}
          onSelectEvent={(event) => handleDateClick(event.start)}
          defaultDate={new Date()}
          defaultView="month"
        />
      )}

      <ShiftDetailModal
        shift={selectedShift}
        userStatus={userStatus}
        onClose={handleCloseModal}
        onUpdate={handleShiftUpdate}
      />
    </main>
  )
}

function OnboardingStatusBarWrapper() {
  const navigate = useNavigate()
  return <OnboardingStatusBar onNavigateToOnboarding={() => navigate('/profile')} />
}

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Header />
        <OnboardingStatusBarWrapper />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/profile" element={<UserProfileLayout />}>
            <Route index element={<UserOverview />} />
            <Route path="shifts" element={<UserShifts />} />
            <Route path="account" element={<UserProfile />} />
            <Route path="induction" element={<UserInduction />} />
          </Route>
          <Route path="/committee" element={<CommitteeLayout />}>
            <Route index element={<CommitteeOverview />} />
            <Route path="events" element={<CommitteeEvents />} />
            <Route path="hours" element={<CommitteeHours />} />
            <Route path="stock" element={<CommitteeStock />} />
            <Route path="stock/update" element={<CommitteeStockUpdate />} />
            <Route path="members" element={<CommitteeMembers />} />
            <Route path="induction" element={<CommitteeInduction />} />
          </Route>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminUsers />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App

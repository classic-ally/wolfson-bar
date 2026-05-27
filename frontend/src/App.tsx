import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { usePageTitle } from './hooks/usePageTitle'
import { LoginButton } from './components/LoginButton'
import CommitteeLayout from './components/CommitteeLayout'
import AdminLayout from './components/AdminLayout'
import AdminUsers from './components/admin/AdminUsers'
import AdminBulkImport from './components/admin/AdminBulkImport'
import CommitteeOverview from './components/committee/CommitteeOverview'
import CommitteeEvents from './components/committee/CommitteeEvents'
import CommitteeHours from './components/committee/CommitteeHours'
import CommitteeStock from './components/committee/CommitteeStock'
import CommitteeStockUpdate from './components/committee/CommitteeStockUpdate'
import CommitteeMembers from './components/committee/CommitteeMembers'
import CommitteeInduction from './components/committee/CommitteeInduction'
import CommitteeRotaManager from './components/committee/CommitteeRotaManager'
import OnboardingStatusBar from './components/OnboardingStatusBar'
import UserProfileLayout from './components/UserProfileLayout'
import UserOverview from './components/user/UserOverview'
import UserShifts from './components/user/UserShifts'
import UserProfile from './components/user/UserProfile'
import UserInduction from './components/user/UserInduction'
import AboutPage from './components/AboutPage'
import MenuPage from './components/MenuPage'
import ShiftSlotCalendar from './components/committee/ShiftSlotCalendar'
import { Button } from './components/ui/button'
import Page from './components/Page'
import ShiftDetailModal from './components/ShiftDetailModal'
import PasskeyNudgeBanner from './components/PasskeyNudgeBanner'
import ProtectedRoute from './components/ProtectedRoute'
import MagicLinkCallback from './components/MagicLinkCallback'
import PrivacyPage from './components/PrivacyPage'
import Footer from './components/Footer'
import { isLoggedIn, isCommittee, getEvents, getShifts, getUserStatus, getTermWeeks, TermWeek, getInductionDates } from './lib/auth'
import type { Event } from './types/Event'
import type { ShiftInfo } from './types/ShiftInfo'
import type { UserStatus } from './types/UserStatus'
import type { InductionDate } from './types/InductionDate'

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
    <Page size="wide">
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
    </Page>
  )
}

function CalendarLegendPopup({ userStatus }: { userStatus: UserStatus }) {
  // Per-visit only: dismiss state resets every time the user navigates to
  // /events. The legend is short enough that re-showing isn't intrusive.
  const [open, setOpen] = useState(true)

  if (!open) return null

  const dismiss = () => setOpen(false)

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        ×
      </button>
      <div className="space-y-2 p-4 pr-8 text-sm">
        {!userStatus.induction_completed ? (
          <p>
            <strong>Induction signup:</strong> click a date with a blue{' '}
            <strong>I</strong> badge to sign up for an induction.
          </p>
        ) : (
          <>
            <p>
              <strong>Shift signup:</strong> click any date to view details and sign up.
            </p>
            <p className="text-xs text-muted-foreground">
              🔴 Red = no volunteers · 🟡 Amber = needs more · Grey + strikethrough = full
            </p>
            {!userStatus.supervised_shift_completed && (
              <p className="text-xs text-muted-foreground">
                Your first shift must be supervised by a committee member.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [shifts, setShifts] = useState<ShiftInfo[]>([])
  const [termWeeks, setTermWeeks] = useState<TermWeek[]>([])
  const [inductionDates, setInductionDates] = useState<InductionDate[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [selectedShift, setSelectedShift] = useState<ShiftInfo | null>(null)
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null)
  // Cell-selection visual = whatever the modal is currently on. Single source
  // of truth — no risk of the highlight outliving the modal close.
  const selectedDate = selectedShift
    ? new Date(selectedShift.date + 'T00:00:00')
    : undefined
  usePageTitle('Events Calendar')

  // 3 months back, 3 months forward — same window used to fetch events/shifts.
  const { fromDate, toDate } = (() => {
    const r = getEventsDateRange()
    return { fromDate: new Date(r.start + 'T00:00:00'), toDate: new Date(r.end + 'T00:00:00') }
  })()

  useEffect(() => {
    loadEvents()
    getTermWeeks().then(setTermWeeks)
    if (isLoggedIn()) {
      loadUserStatus().then((status) => {
        if (status && !status.induction_completed) {
          getInductionDates().then(setInductionDates).catch(err => console.error('Failed to load induction dates:', err))
        }
        if (status && status.induction_completed) {
          loadShifts()
        }
      })
    }
  }, [])

  // Keep selectedShift in sync when shifts data refreshes
  useEffect(() => {
    if (selectedShift) {
      const updated = shifts.find(s => s.date === selectedShift.date)
      if (updated) {
        setSelectedShift(updated)
      }
    }
  }, [shifts])

  const loadUserStatus = async (): Promise<UserStatus | null> => {
    try {
      const status = await getUserStatus()
      setUserStatus(status)
      return status
    } catch (err) {
      console.error('Failed to load user status:', err)
      return null
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
    } else if (userStatus && !userStatus.induction_completed) {
      // For pre-induction users, create a minimal ShiftInfo so the modal can show induction signup
      const inductionDate = inductionDates.find(d => d.date === dateStr)
      setSelectedShift({
        date: dateStr,
        event_title: null,
        event_description: null,
        max_volunteers: 0,
        requires_contract: false,
        signups_count: 0,
        signups: [],
        open_time: null,
        close_time: null,
        has_induction_availability: !!inductionDate,
        induction_signups_count: inductionDate ? (4 - inductionDate.slots_remaining) : 0,
        current_user_induction_available: false,
      })
    }
  }

  const handleCloseModal = () => {
    setSelectedShift(null)
  }

  const handleShiftUpdate = () => {
    loadShifts() // Refresh shift data after signup/cancel
  }

  const loggedIn = isLoggedIn()
  const viewerContext = loggedIn
    ? ({ kind: 'self' as const, userStatus })
    : ({ kind: 'public' as const })

  return (
    <Page
      size="full"
      title="Events Calendar"
      titleAction={
        <Button asChild variant="outline" size="sm">
          <a href={`webcal://${window.location.host}/api/events/calendar.ics`}>
            📅 Subscribe
          </a>
        </Button>
      }
    >
      {loggedIn && userStatus && (
        <CalendarLegendPopup userStatus={userStatus} />
      )}

      {eventsLoading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>Loading events...</div>
      ) : (
        <ShiftSlotCalendar
          shifts={loggedIn ? shifts : []}
          events={events}
          termWeeks={termWeeks}
          inductionDates={inductionDates.length > 0 ? inductionDates : undefined}
          viewerContext={viewerContext}
          fromDate={fromDate}
          toDate={toDate}
          selected={selectedDate}
          onSelect={(d) => {
            if (loggedIn) handleDateClick(d)
          }}
        />
      )}

      <ShiftDetailModal
        shift={selectedShift}
        event={selectedShift ? events.find(e => e.event_date === selectedShift.date) : null}
        userStatus={userStatus}
        isCommittee={isCommittee()}
        onClose={handleCloseModal}
        onUpdate={handleShiftUpdate}
      />
    </Page>
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
        <PasskeyNudgeBanner />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/auth/magic-link-callback" element={<MagicLinkCallback />} />
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
            <Route path="rotamanager" element={<CommitteeRotaManager />} />
          </Route>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminUsers />} />
            <Route path="import" element={<AdminBulkImport />} />
          </Route>
        </Routes>
        <Footer />
      </div>
    </BrowserRouter>
  )
}

export default App

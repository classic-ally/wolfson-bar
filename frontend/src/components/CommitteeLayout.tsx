import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isCommittee, isLoggedIn } from '../lib/auth'
import { rememberReturnTo } from '../lib/returnTo'
import CommitteeNav from './CommitteeNav'
import Page from './Page'

export default function CommitteeLayout() {
  const location = useLocation()

  if (!isLoggedIn()) {
    // Signed-out committee members (e.g. scanning a kiosk pairing QR) come back here after login.
    rememberReturnTo(location.pathname + location.search)
    return <Navigate to="/" replace />
  }

  if (!isCommittee()) {
    return <Navigate to="/profile" replace />
  }

  return (
    <Page size="full">
      <CommitteeNav />
      <Outlet />
    </Page>
  )
}

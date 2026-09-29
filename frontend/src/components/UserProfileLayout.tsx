import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isLoggedIn } from '../lib/auth'
import { rememberReturnTo } from '../lib/returnTo'
import UserProfileNav from './UserProfileNav'
import Page from './Page'

export default function UserProfileLayout() {
  const location = useLocation()

  if (!isLoggedIn()) {
    rememberReturnTo(location.pathname + location.search)
    return <Navigate to="/" replace />
  }

  return (
    <Page size="wide" title="My Profile">
      <UserProfileNav />
      <Outlet />
    </Page>
  )
}

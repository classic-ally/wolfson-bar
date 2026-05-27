import { Outlet } from 'react-router-dom'
import { isLoggedIn } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import UserProfileNav from './UserProfileNav'
import Page from './Page'

export default function UserProfileLayout() {
  if (!isLoggedIn()) {
    return <Navigate to="/" replace />
  }

  return (
    <Page size="wide" title="My Profile">
      <UserProfileNav />
      <Outlet />
    </Page>
  )
}

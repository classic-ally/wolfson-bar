import { Outlet } from 'react-router-dom'
import { isLoggedIn } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import UserProfileNav from './UserProfileNav'

export default function UserProfileLayout() {
  if (!isLoggedIn()) {
    return <Navigate to="/" replace />
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '10px' }}>My Profile</h1>
      <UserProfileNav />
      <Outlet />
    </div>
  )
}

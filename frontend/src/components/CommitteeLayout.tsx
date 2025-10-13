import { Outlet } from 'react-router-dom'
import { isCommittee } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import CommitteeNav from './CommitteeNav'

export default function CommitteeLayout() {
  if (!isCommittee()) {
    return <Navigate to="/profile" replace />
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <CommitteeNav />
      <Outlet />
    </div>
  )
}

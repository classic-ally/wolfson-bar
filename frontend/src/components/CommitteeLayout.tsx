import { Outlet } from 'react-router-dom'
import { isCommittee } from '../lib/auth'
import { Navigate } from 'react-router-dom'
import CommitteeNav from './CommitteeNav'
import Page from './Page'

export default function CommitteeLayout() {
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

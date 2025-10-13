import { Navigate } from 'react-router-dom'
import { isLoggedIn, isCommittee } from '../lib/auth'

interface CommitteeRouteProps {
  children: React.ReactNode
}

export default function CommitteeRoute({ children }: CommitteeRouteProps) {
  if (!isLoggedIn()) {
    return <Navigate to="/" replace />
  }

  if (!isCommittee()) {
    return <Navigate to="/profile" replace />
  }

  return <>{children}</>
}

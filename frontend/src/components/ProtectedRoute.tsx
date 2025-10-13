import { Navigate } from 'react-router-dom'
import { isLoggedIn } from '../lib/auth'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  if (!isLoggedIn()) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

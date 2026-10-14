import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getUserStatus, isCommittee, isRotaMember } from '../lib/auth'

export default function UserProfileNav() {
  const location = useLocation()
  // Mirrors the /api/members gate: rota members and committee only.
  const [canSeeMembers, setCanSeeMembers] = useState(isCommittee)

  useEffect(() => {
    if (isCommittee()) return
    getUserStatus()
      .then((status) => setCanSeeMembers(isRotaMember(status)))
      .catch(() => {})
  }, [])

  const tabs = [
    { path: '/profile', label: 'Overview' },
    { path: '/profile/shifts', label: 'Shifts' },
    { path: '/profile/account', label: 'Profile' },
    { path: '/profile/induction', label: 'Induction' },
    ...(canSeeMembers ? [{ path: '/profile/members', label: 'Members' }] : []),
  ]

  return (
    <div style={{
      borderBottom: '2px solid #e0e0e0',
      marginBottom: '30px',
      overflowX: 'auto',
      overflowY: 'hidden'
    }}>
      <div style={{ display: 'flex', gap: '0', minWidth: 'max-content' }}>
        {tabs.map(tab => (
          <Link
            key={tab.path}
            to={tab.path}
            style={{
              padding: '12px 24px',
              textDecoration: 'none',
              color: location.pathname === tab.path ? '#8B0000' : '#666',
              borderBottom: location.pathname === tab.path ? '3px solid #8B0000' : '3px solid transparent',
              marginBottom: '-2px',
              fontWeight: location.pathname === tab.path ? 600 : 400,
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

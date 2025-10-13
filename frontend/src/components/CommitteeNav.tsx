import { Link, useLocation } from 'react-router-dom'

export default function CommitteeNav() {
  const location = useLocation()

  const tabs = [
    { path: '/committee', label: 'Overview' },
    { path: '/committee/events', label: 'Events' },
    { path: '/committee/hours', label: 'Hours' },
    { path: '/committee/members', label: 'Members' },
    { path: '/committee/induction', label: 'Induction' },
  ]

  return (
    <nav style={{
      borderBottom: '2px solid #dee2e6',
      marginBottom: '30px',
      overflowX: 'auto',
      overflowY: 'hidden'
    }}>
      <div style={{ display: 'flex', gap: '0', minWidth: 'max-content' }}>
      {tabs.map((tab) => {
        const isActive = location.pathname === tab.path
        return (
          <Link
            key={tab.path}
            to={tab.path}
            style={{
              padding: '12px 24px',
              textDecoration: 'none',
              color: isActive ? '#8B0000' : '#666',
              borderBottom: isActive ? '3px solid #8B0000' : '3px solid transparent',
              fontWeight: isActive ? 600 : 400,
              transition: 'all 0.2s',
              marginBottom: '-2px'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = '#333'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = '#666'
              }
            }}
          >
            {tab.label}
          </Link>
        )
      })}
      </div>
    </nav>
  )
}

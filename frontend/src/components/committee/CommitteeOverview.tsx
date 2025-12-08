import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOverviewStats, OverviewStats } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function CommitteeOverview() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [loading, setLoading] = useState(true)
  usePageTitle('Committee')

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const overviewStats = await getOverviewStats()
      setStats(overviewStats)
    } catch (err) {
      console.error('Failed to load stats:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h1>Committee Dashboard</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Manage events, members, and rota operations.
      </p>

      {loading ? (
        <p>Loading...</p>
      ) : stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(310px, 100%), 1fr))', gap: '20px' }}>
          {/* Active Members */}
          <div
            onClick={() => navigate('/committee/members')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ marginTop: 0, color: '#8B0000' }}>Active Members</h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {stats.active_members_count}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              Fully onboarded rota members
            </p>
          </div>

          {/* Unstaffed Shifts */}
          <div
            onClick={() => navigate('/events')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              position: 'relative',
              border: stats.unstaffed_shifts_next_3_days > 0 ? '2px solid #dc3545' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ marginTop: 0, color: stats.unstaffed_shifts_next_3_days > 0 ? '#dc3545' : '#8B0000' }}>
              Unstaffed Shifts (3 days)
            </h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {stats.unstaffed_shifts_next_3_days}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              {stats.unstaffed_shifts_next_3_days > 0 ? "Bar won't open without staffing" : 'All shifts covered'}
            </p>
          </div>

          {/* Understaffed Events */}
          <div
            onClick={() => navigate('/events')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              position: 'relative',
              border: stats.understaffed_events_next_7_days > 0 ? '2px solid #ffc107' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ marginTop: 0, color: stats.understaffed_events_next_7_days > 0 ? '#e9a300' : '#8B0000' }}>
              Understaffed Events (7 days)
            </h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {stats.understaffed_events_next_7_days}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              {stats.understaffed_events_next_7_days > 0 ? 'Events need more volunteers' : 'All events staffed'}
            </p>
          </div>

          {/* Pending Certificates */}
          <div
            onClick={() => navigate('/committee/members')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ marginTop: 0, color: '#8B0000' }}>Pending Certificates</h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {stats.pending_certificates_count}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              Food safety certificates to review
            </p>
          </div>

          {/* Pending Contracts */}
          <div
            onClick={() => navigate('/committee/members')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ marginTop: 0, color: '#8B0000' }}>Pending Contracts</h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {stats.pending_contracts_count}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              Contract requests to approve
            </p>
          </div>

          {/* Expiring Contracts */}
          <div
            onClick={() => navigate('/committee/members')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ marginTop: 0, color: '#8B0000' }}>Expiring Contracts (30 days)</h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {stats.expiring_contracts_next_30_days}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              Contracts need renewal soon
            </p>
          </div>
        </div>
      ) : (
        <p style={{ color: '#666' }}>Failed to load dashboard stats</p>
      )}
    </div>
  )
}

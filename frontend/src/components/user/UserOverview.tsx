import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyOverview } from '../../lib/auth'
import type { UserOverview as UserOverviewType } from '../../types/UserOverview'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function UserOverview() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<UserOverviewType | null>(null)
  const [loading, setLoading] = useState(true)
  usePageTitle('Dashboard')

  useEffect(() => {
    loadOverview()
  }, [])

  const loadOverview = async () => {
    try {
      const data = await getMyOverview()
      setOverview(data)
    } catch (err) {
      console.error('Failed to load overview:', err)
    } finally {
      setLoading(false)
    }
  }

  const getOnboardingStepInfo = (step: string | null) => {
    if (!step) {
      return { main: '✓', subtitle: 'All onboarding complete' }
    }
    switch (step) {
      case 'code_of_conduct':
        return { main: 'Incomplete', subtitle: 'Sign Code of Conduct' }
      case 'food_safety':
        return { main: 'Incomplete', subtitle: 'Upload Food Safety Certificate' }
      case 'induction':
        return { main: 'Incomplete', subtitle: 'Complete Induction Shift' }
      case 'supervised_shift':
        return { main: 'Incomplete', subtitle: 'Complete Supervised Shift' }
      default:
        return { main: 'Unknown', subtitle: 'Unknown step' }
    }
  }

  const getContractInfo = (expiryDate: string | null) => {
    if (!expiryDate) {
      return { title: 'Contract Status', main: 'N/A', subtitle: 'No active contract' }
    }
    return { title: 'Contract Expiry', main: expiryDate, subtitle: 'View contract details' }
  }

  return (
    <div>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Quick view of your rota membership status.
      </p>

      {loading ? (
        <p>Loading...</p>
      ) : overview ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(310px, 100%), 1fr))', gap: '20px' }}>
          {/* Rota Membership */}
          <div
            onClick={() => navigate('/profile/induction')}
            style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              border: overview.next_onboarding_step ? '2px solid #ffc107' : 'none'
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
            <h3 style={{ marginTop: 0, color: overview.next_onboarding_step ? '#e9a300' : '#8B0000' }}>
              Rota Membership
            </h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {getOnboardingStepInfo(overview.next_onboarding_step).main}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              {getOnboardingStepInfo(overview.next_onboarding_step).subtitle}
            </p>
          </div>

          {/* Shifts Next 7 Days */}
          <div
            onClick={() => navigate(overview.shifts_next_7_days > 0 ? '/profile/shifts' : '/events')}
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
            <h3 style={{ marginTop: 0, color: '#8B0000' }}>
              Shifts (next 7 days)
            </h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {overview.shifts_next_7_days}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              {overview.shifts_next_7_days === 0 ? 'No shifts scheduled' : 'Upcoming shifts'}
            </p>
          </div>

          {/* Contract */}
          <div
            onClick={() => navigate('/profile/account')}
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
            <h3 style={{ marginTop: 0, color: '#8B0000' }}>
              {getContractInfo(overview.contract_expiry_date).title}
            </h3>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
              {getContractInfo(overview.contract_expiry_date).main}
            </div>
            <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
              {getContractInfo(overview.contract_expiry_date).subtitle}
            </p>
          </div>
        </div>
      ) : (
        <p style={{ color: '#666' }}>Failed to load overview</p>
      )}
    </div>
  )
}

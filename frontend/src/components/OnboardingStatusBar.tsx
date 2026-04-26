import { useEffect, useState } from 'react'
import { getUserStatus, isLoggedIn, isRotaMember, canSignupForShifts } from '../lib/auth'
import type { UserStatus } from '../types/UserStatus'

interface OnboardingStatusBarProps {
  onNavigateToOnboarding: () => void
}

export default function OnboardingStatusBar({ onNavigateToOnboarding }: OnboardingStatusBarProps) {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false)
      return
    }

    getUserStatus()
      .then(setStatus)
      .catch((err) => console.error('Failed to fetch user status:', err))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !status) return null

  if (isRotaMember(status)) return null

  const pendingTasks = []

  if (!status.induction_completed) {
    pendingTasks.push('Complete Induction')
  }

  if (!status.code_of_conduct_signed) {
    pendingTasks.push('Complete Code of Conduct')
  }

  if (!status.food_safety_completed) {
    if (!status.has_food_safety_certificate) {
      pendingTasks.push('Upload Food Safety Certificate')
    } else {
      pendingTasks.push('Food Safety Certificate Pending Review')
    }
  }

  if (!status.supervised_shift_completed && canSignupForShifts(status)) {
    pendingTasks.push('Complete Supervised Shift')
  }

  return (
    <div style={{
      backgroundColor: '#fff3cd',
      borderBottom: '2px solid #ffc107',
      padding: '12px 20px',
      textAlign: 'center',
      fontSize: '14px',
    }}>
      <span style={{ fontWeight: 'bold', marginRight: '10px' }}>
        ⚠️ Action Required:
      </span>
      {pendingTasks.map((task, index) => (
        <span key={task}>
          {task}
          {index < pendingTasks.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
        </span>
      ))}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault()
          onNavigateToOnboarding()
        }}
        style={{
          marginLeft: '15px',
          color: '#856404',
          fontWeight: 'bold',
          textDecoration: 'underline',
          cursor: 'pointer'
        }}
      >
        View Details →
      </a>
    </div>
  )
}

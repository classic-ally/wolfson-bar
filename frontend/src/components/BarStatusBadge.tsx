import { useEffect, useState } from 'react'
import { getBarStatus } from '../lib/auth'

// Small public indicator of whether the bar is open right now.
export default function BarStatusBadge() {
  const [isOpen, setIsOpen] = useState<boolean | null>(null)

  useEffect(() => {
    getBarStatus()
      .then((s) => setIsOpen(s.is_open))
      .catch(() => setIsOpen(null))
  }, [])

  if (isOpen === null) return null

  return (
    <div
      data-testid="bar-status-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        fontWeight: 600,
        backgroundColor: isOpen ? '#d1e7dd' : '#e9ecef',
        color: isOpen ? '#0f5132' : '#495057',
      }}
    >
      {isOpen ? '🟢 Bar open now' : '⚪ Bar closed'}
    </div>
  )
}

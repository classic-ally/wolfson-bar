import { useState } from 'react'
import { ShiftInfo, signupForShift, cancelShiftSignup, getUserId, UserStatus } from '../lib/auth'

interface ShiftDetailModalProps {
  shift: ShiftInfo | null
  userStatus: UserStatus | null
  onClose: () => void
  onUpdate: () => void
}

export default function ShiftDetailModal({ shift, userStatus, onClose, onUpdate }: ShiftDetailModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!shift) return null

  const currentUserId = getUserId()
  const isSignedUp = shift.signups.some(s => s.user_id === currentUserId)
  const isFull = shift.signups_count >= shift.max_volunteers
  const lacksContract = shift.requires_contract && (!userStatus || !userStatus.has_contract)
  const hasCommitteeMember = shift.signups.some(s => s.is_committee)
  const isInducted = userStatus?.induction_completed ?? false
  const needsInduction = !isInducted && !hasCommitteeMember
  const canSignup = !isSignedUp && !isFull && !lacksContract && !needsInduction

  const handleSignup = async () => {
    setLoading(true)
    setError(null)
    try {
      await signupForShift(shift.date)
      onUpdate() // Refresh shift data
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    setLoading(true)
    setError(null)
    try {
      await cancelShiftSignup(shift.date)
      onUpdate() // Refresh shift data
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel signup')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '8px',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0, color: '#002147' }}>
          Shift Details
        </h2>

        <div style={{ marginBottom: '20px' }}>
          <p style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>
            {formatDate(shift.date)}
          </p>
          {shift.event_title && (
            <p style={{ color: '#8B0000', fontWeight: 'bold', marginBottom: '5px' }}>
              Event: {shift.event_title}
            </p>
          )}
          {shift.event_description && (
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '10px' }}>
              {shift.event_description}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <div style={{ marginBottom: '8px' }}>
            <strong>Volunteers needed:</strong> {shift.max_volunteers}
          </div>
          <div style={{ marginBottom: '8px' }}>
            <strong>Currently signed up:</strong> {shift.signups_count}
            {isFull && <span style={{ color: '#28a745', marginLeft: '10px', fontWeight: 'bold' }}>✓ Full</span>}
          </div>
          {shift.requires_contract && (
            <div style={{ color: '#856404', backgroundColor: '#fff3cd', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
              ⚠️ This shift requires a valid contract
            </div>
          )}
          {!isInducted && (
            <div style={{ color: '#004085', backgroundColor: '#cce5ff', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
              ℹ️ You haven't completed your induction yet. You can only sign up for shifts where a committee member is present.
            </div>
          )}
        </div>

        {shift.signups.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <strong>Signed up:</strong>
            <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
              {shift.signups.map((signup) => (
                <li key={signup.user_id}>
                  {signup.display_name || 'Unknown'}
                  {signup.user_id === currentUserId && (
                    <span style={{ color: '#8B0000', marginLeft: '5px' }}>(You)</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div style={{
            backgroundColor: '#f8d7da',
            color: '#721c24',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '20px',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>

          {isSignedUp ? (
            <button
              onClick={handleCancel}
              disabled={loading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Cancelling...' : 'Cancel Signup'}
            </button>
          ) : canSignup ? (
            <button
              onClick={handleSignup}
              disabled={loading}
              style={{
                padding: '10px 20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Signing up...' : 'Sign Up'}
            </button>
          ) : needsInduction ? (
            <button
              disabled
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'not-allowed',
                opacity: 0.6,
              }}
            >
              Induction Required
            </button>
          ) : lacksContract ? (
            <button
              disabled
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'not-allowed',
                opacity: 0.6,
              }}
            >
              Contract Required
            </button>
          ) : isFull ? (
            <button
              disabled
              style={{
                padding: '10px 20px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'not-allowed',
                opacity: 0.6,
              }}
            >
              Shift Full
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

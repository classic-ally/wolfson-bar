import { useState, useEffect } from 'react'
import { ShiftInfo, signupForShift, cancelShiftSignup, removeUserFromShift, getUserId, UserStatus, ActiveMember, getActiveMembers, assignUserToShift, Event, setInductionAvailability, removeInductionAvailability, signupForInduction, cancelInductionSignup, getInductionDates, InductionDateInductee } from '../lib/auth'

interface ShiftDetailModalProps {
  shift: ShiftInfo | null
  event?: Event | null
  userStatus: UserStatus | null
  isCommittee?: boolean
  onClose: () => void
  onUpdate: () => void
}

export default function ShiftDetailModal({ shift, event, userStatus, isCommittee, onClose, onUpdate }: ShiftDetailModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [removeLoading, setRemoveLoading] = useState<string | null>(null)
  const [inductionLoading, setInductionLoading] = useState(false)
  const [inductionFullShift, setInductionFullShift] = useState(false)
  const [inductionAvailChecked, setInductionAvailChecked] = useState(false)
  const [inductionInductees, setInductionInductees] = useState<InductionDateInductee[]>([])
  const [userInductionSignedUp, setUserInductionSignedUp] = useState(false)
  const [userInductionFullShift, setUserInductionFullShift] = useState(false)
  const [inductionHasFullShiftCommittee, setInductionHasFullShiftCommittee] = useState(false)

  useEffect(() => {
    if (!shift) return

    setInductionAvailChecked(shift.current_user_induction_available)
    setInductionInductees([])
    setUserInductionSignedUp(false)
    setUserInductionFullShift(false)
    setInductionHasFullShiftCommittee(false)

    if (isCommittee) {
      getActiveMembers().then(setActiveMembers).catch(() => {})
    }

    // Load induction date details if relevant (committee needs inductee list, pre-induction users need signup state)
    const needsInductionData = isCommittee
      ? (shift.has_induction_availability || shift.current_user_induction_available)
      : shift.has_induction_availability

    if (needsInductionData) {
      getInductionDates().then(dates => {
        const dateInfo = dates.find(d => d.date === shift.date)
        if (dateInfo) {
          setInductionInductees(dateInfo.inductees)
          setUserInductionSignedUp(dateInfo.user_signed_up)
          setUserInductionFullShift(dateInfo.user_signed_up_full_shift)
          setInductionHasFullShiftCommittee(dateInfo.has_full_shift_committee)
        }
      }).catch(() => {})
    }
  }, [shift, isCommittee])

  if (!shift) return null

  const currentUserId = getUserId()
  const isSignedUp = shift.signups.some(s => s.user_id === currentUserId)
  const isFull = shift.signups_count >= shift.max_volunteers
  const lacksContract = shift.requires_contract && (!userStatus || !userStatus.has_contract)
  const hasCommitteeMember = shift.signups.some(s => s.is_committee)

  // Derive user states
  const isInducted = userStatus?.induction_completed ?? false
  const isSupervisedComplete = userStatus?.supervised_shift_completed ?? false
  const needsInduction = !isInducted
  const needsSupervision = isInducted && !isSupervisedComplete && !hasCommitteeMember

  // canSignup requires induction_completed + code_of_conduct_signed + food_safety_completed
  // If supervised_shift not complete, needs committee member on shift
  const hasRequiredOnboarding = isInducted
    && (userStatus?.code_of_conduct_signed ?? false)
    && (userStatus?.food_safety_completed ?? false)
  const supervisedOk = isSupervisedComplete || hasCommitteeMember
  const canSignup = !isSignedUp && !isFull && !lacksContract && hasRequiredOnboarding && supervisedOk

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

  const handleAssign = async () => {
    if (!selectedUserId || !shift) return
    setAssignLoading(true)
    setError(null)
    try {
      await assignUserToShift(shift.date, selectedUserId)
      setSelectedUserId('')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign user')
    } finally {
      setAssignLoading(false)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!shift || !confirm('Remove this user from the shift?')) return
    setRemoveLoading(userId)
    setError(null)
    try {
      await removeUserFromShift(shift.date, userId)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user')
    } finally {
      setRemoveLoading(null)
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

  const handleInductionAvailToggle = async (checked: boolean) => {
    setInductionLoading(true)
    setError(null)
    try {
      if (checked) {
        await setInductionAvailability(shift.date)
      } else {
        await removeInductionAvailability(shift.date)
      }
      setInductionAvailChecked(checked)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update induction availability')
    } finally {
      setInductionLoading(false)
    }
  }

  const handleInductionSignup = async () => {
    setInductionLoading(true)
    setError(null)
    try {
      await signupForInduction(shift.date, inductionFullShift)
      onUpdate()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up for induction')
    } finally {
      setInductionLoading(false)
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

  // Determine if induction slots are available
  const inductionAvailable = shift.has_induction_availability && shift.induction_signups_count < 4

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
          maxHeight: '90vh',
          overflowY: 'auto',
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
          {(() => {
            // Compute effective shift time: broader of bar hours and event times
            const barOpen = shift.open_time
            const barClose = shift.close_time
            const eventStart = event?.start_time
            const eventEnd = event?.end_time
            const shiftStart = barOpen && eventStart ? (barOpen < eventStart ? barOpen : eventStart) : barOpen || eventStart
            const shiftEnd = barClose && eventEnd ? (barClose > eventEnd ? barClose : eventEnd) : barClose || eventEnd
            if (!shiftStart && !shiftEnd) return null
            return (
              <p style={{ color: '#555', fontSize: '15px', marginBottom: '5px' }}>
                {shiftStart && shiftEnd ? `${shiftStart} – ${shiftEnd}` : shiftStart || shiftEnd}
              </p>
            )
          })()}
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
          {needsInduction && (
            <div style={{ color: '#004085', backgroundColor: '#cce5ff', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
              ℹ️ You haven't completed your induction yet. Sign up for an induction session below.
            </div>
          )}
          {!needsInduction && !isSupervisedComplete && (
            <div style={{ color: '#004085', backgroundColor: '#cce5ff', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
              ℹ️ You need to complete a supervised shift with a committee member present.
            </div>
          )}
        </div>

        {/* Signup list - hidden for pre-induction users since API returns empty */}
        {!needsInduction && shift.signups.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <strong>Signed up:</strong>
            <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
              {shift.signups.map((signup) => (
                <li key={signup.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>
                    {signup.display_name || 'Unknown'}
                    {signup.user_id === currentUserId && (
                      <span style={{ color: '#8B0000', marginLeft: '5px' }}>(You)</span>
                    )}
                  </span>
                  {isCommittee && (
                    <button
                      onClick={() => handleRemove(signup.user_id)}
                      disabled={removeLoading === signup.user_id}
                      style={{
                        padding: '2px 8px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        fontSize: '12px',
                        cursor: removeLoading === signup.user_id ? 'not-allowed' : 'pointer',
                        opacity: removeLoading === signup.user_id ? 0.6 : 1,
                        marginLeft: '8px',
                      }}
                    >
                      {removeLoading === signup.user_id ? '...' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Committee: Induction availability */}
        {isCommittee && shift && (
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#e8f4fd', borderRadius: '4px', border: '1px solid #b8daff' }}>
            <strong style={{ display: 'block', marginBottom: '4px' }}>Your Induction Availability</strong>
            <p style={{ color: '#666', fontSize: '13px', margin: '0 0 10px 0' }}>
              Mark yourself as available to run an induction on this date (7:45–8:30). This is separate from signing up for the shift.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                <input
                  type="checkbox"
                  checked={inductionAvailChecked}
                  onChange={(e) => setInductionAvailChecked(e.target.checked)}
                />
                I can run an induction on this date
              </label>
              {inductionAvailChecked !== shift.current_user_induction_available && (
                <button
                  onClick={() => handleInductionAvailToggle(inductionAvailChecked)}
                  disabled={inductionLoading}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: inductionLoading ? '#ccc' : '#0d6efd',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: inductionLoading ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                  }}
                >
                  {inductionLoading ? 'Saving...' : 'Save'}
                </button>
              )}
              {inductionAvailChecked === shift.current_user_induction_available && shift.current_user_induction_available && (
                <span style={{ color: '#28a745', fontSize: '13px' }}>Saved ✓</span>
              )}
            </div>
            {inductionInductees.length > 0 && (
              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #b8daff' }}>
                <strong style={{ fontSize: '13px' }}>Inductees signed up ({inductionInductees.length}/4):</strong>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
                  {inductionInductees.map(ind => (
                    <li key={ind.user_id} style={{ fontSize: '13px', marginBottom: '2px' }}>
                      {ind.display_name || 'Unknown'}
                      {ind.full_shift && <span style={{ color: '#28a745', marginLeft: '6px', fontSize: '11px' }}>+ full shift</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {shift.induction_signups_count > 0 && inductionInductees.length === 0 && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
                {shift.induction_signups_count} inductee(s) signed up
              </div>
            )}
          </div>
        )}

        {/* Committee: Assign member */}
        {isCommittee && shift && (
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
            <strong style={{ display: 'block', marginBottom: '8px' }}>Assign Member to Shift</strong>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              >
                <option value="">Select a member...</option>
                {activeMembers
                  .filter(m => !shift.signups.some(s => s.user_id === m.user_id))
                  .map(m => (
                    <option
                      key={m.user_id}
                      value={m.user_id}
                      disabled={shift.requires_contract && !m.has_contract}
                    >
                      {m.display_name || m.user_id}
                      {shift.requires_contract && !m.has_contract ? ' (no contract)' : ''}
                    </option>
                  ))}
              </select>
              <button
                onClick={handleAssign}
                disabled={!selectedUserId || assignLoading || isFull}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#002147',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: !selectedUserId || assignLoading || isFull ? 'not-allowed' : 'pointer',
                  opacity: !selectedUserId || assignLoading || isFull ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {assignLoading ? 'Assigning...' : 'Assign'}
              </button>
            </div>
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

        {/* Pre-induction user section */}
        {needsInduction && !isCommittee && (
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#e8f4fd', borderRadius: '4px', border: '1px solid #b8daff' }}>
            {userInductionSignedUp ? (
              <div>
                <div style={{
                  backgroundColor: '#d4edda',
                  border: '1px solid #c3e6cb',
                  borderRadius: '4px',
                  padding: '12px',
                  marginBottom: '10px',
                }}>
                  <p style={{ margin: '0 0 4px 0', color: '#155724', fontSize: '14px', fontWeight: 500 }}>
                    You're signed up for induction on this date
                  </p>
                  <p style={{ margin: 0, color: '#155724', fontSize: '13px' }}>
                    Induction: 7:45–8:30{userInductionFullShift ? ' + supervised shift (full evening)' : ''}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setInductionLoading(true)
                    try {
                      await cancelInductionSignup(shift.date)
                      setUserInductionSignedUp(false)
                      setUserInductionFullShift(false)
                      onUpdate()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to cancel')
                    } finally {
                      setInductionLoading(false)
                    }
                  }}
                  disabled={inductionLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: inductionLoading ? 'not-allowed' : 'pointer',
                    opacity: inductionLoading ? 0.6 : 1,
                    fontSize: '13px',
                  }}
                >
                  {inductionLoading ? 'Cancelling...' : 'Cancel Induction Signup'}
                </button>
              </div>
            ) : (
              <>
                <strong style={{ display: 'block', marginBottom: '8px', color: '#004085' }}>
                  Sign up for an induction session on this date
                </strong>
                {inductionAvailable ? (
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input type="checkbox" checked readOnly />
                      <span style={{ fontSize: '14px' }}>Induction (7:45–8:30)</span>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '12px',
                        cursor: inductionHasFullShiftCommittee ? 'pointer' : 'not-allowed',
                        opacity: inductionHasFullShiftCommittee ? 1 : 0.5,
                      }}
                      title={!inductionHasFullShiftCommittee ? 'No committee member available for the full shift' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={inductionFullShift}
                        onChange={(e) => setInductionFullShift(e.target.checked)}
                        disabled={!inductionHasFullShiftCommittee}
                      />
                      <span style={{ fontSize: '14px' }}>
                        Also do supervised shift (full evening)
                        {!inductionHasFullShiftCommittee && (
                          <span style={{ color: '#856404', fontSize: '12px', display: 'block', marginTop: '2px' }}>
                            No committee member available for the full shift
                          </span>
                        )}
                      </span>
                    </label>
                    <button
                      onClick={handleInductionSignup}
                      disabled={inductionLoading}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: inductionLoading ? 'not-allowed' : 'pointer',
                        opacity: inductionLoading ? 0.6 : 1,
                        width: '100%',
                      }}
                    >
                      {inductionLoading ? 'Signing up...' : 'Sign Up for Induction'}
                    </button>
                  </div>
                ) : (
                  <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
                    No induction available on this date
                  </p>
                )}
              </>
            )}
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

          {/* Post-induction users: show regular signup/cancel or status buttons */}
          {!needsInduction && (
            <>
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
              ) : needsSupervision ? (
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
                  Supervised Shift Required
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { signupForShift, signupForWholeNight, cancelShiftSignup, removeUserFromShift, getUserId, getActiveMembers, assignUserToShift, setInductionAvailability, removeInductionAvailability, signupForInduction, cancelInductionSignup, getInductionDates, canSignupForShifts } from '../lib/auth'
import type { ShiftInfo } from '../types/ShiftInfo'
import { Badge } from '@/components/ui/badge'
import type { UserStatus } from '../types/UserStatus'
import type { RefObject } from 'react'
import type { ActiveMember } from '../types/ActiveMember'
import type { Event } from '../types/Event'
import type { InductionDateInductee } from '../types/InductionDateInductee'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

interface ShiftDetailModalProps {
  /** Every shift on the selected night, in start order. More than one when
   *  the committee staffs events on that night separately. */
  shifts: ShiftInfo[] | null
  /** Events on the selected night. */
  events?: Event[]
  userStatus: UserStatus | null
  isCommittee?: boolean
  onClose: () => void
  onUpdate: () => void
}

/** What the viewer can do on one shift. */
function slotStatus(shift: ShiftInfo, userStatus: UserStatus | null, currentUserId: string | null) {
  const isSignedUp = shift.signups.some(s => s.user_id === currentUserId)
  const isFull = shift.signups_count >= shift.max_volunteers
  const lacksContract = shift.requires_contract && (!userStatus || !userStatus.has_contract)
  const hasCommitteeMember = shift.signups.some(s => s.is_committee)
  const isInducted = userStatus?.induction_completed ?? false
  const isSupervisedComplete = userStatus?.supervised_shift_completed ?? false
  const needsSupervision = isInducted && !isSupervisedComplete && !hasCommitteeMember
  // If supervised_shift not complete, signup is allowed only when a committee member is present.
  const hasRequiredOnboarding = userStatus ? canSignupForShifts(userStatus) : false
  const supervisedOk = isSupervisedComplete || hasCommitteeMember
  const canSignup = !isSignedUp && !isFull && !lacksContract && hasRequiredOnboarding && supervisedOk
  return { isSignedUp, isFull, lacksContract, hasCommitteeMember, needsSupervision, canSignup }
}

/** Displayed time for a shift. The regular shift widens to cover the night's
 *  events that aren't staffed separately; a separate shift is its event's times. */
function shiftTimes(shift: ShiftInfo, events: Event[]): string | null {
  let start = shift.open_time
  let end = shift.close_time
  if (shift.slot === '') {
    for (const e of events.filter(e => !e.staff_separately)) {
      if (e.start_time && (!start || e.start_time < start)) start = e.start_time
      if (e.end_time && (!end || e.end_time > end)) end = e.end_time
    }
  }
  if (!start && !end) return null
  return start && end ? `${start} – ${end}` : start || end
}

export default function ShiftDetailModal({ shifts, events = [], userStatus, isCommittee, onClose, onUpdate }: ShiftDetailModalProps) {
  const shift = shifts?.[0] ?? null
  // Slot key being signed up for or cancelled, or 'night' for the whole night.
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([])
  const [inductionLoading, setInductionLoading] = useState(false)
  const [inductionFullShift, setInductionFullShift] = useState(false)
  const [inductionAvailChecked, setInductionAvailChecked] = useState(false)
  const [inductionInductees, setInductionInductees] = useState<InductionDateInductee[]>([])
  const [userInductionSignedUp, setUserInductionSignedUp] = useState(false)
  const [userInductionFullShift, setUserInductionFullShift] = useState(false)
  const [inductionHasFullShiftCommittee, setInductionHasFullShiftCommittee] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shift) return

    setNotice(null)
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
  const isSplit = shifts!.length > 1
  const statuses = shifts!.map(sh => slotStatus(sh, userStatus, currentUserId))
  const single = statuses[0]

  // Derive user states
  const isInducted = userStatus?.induction_completed ?? false
  const isSupervisedComplete = userStatus?.supervised_shift_completed ?? false
  const needsInduction = !isInducted

  const shiftName = (slot: string) =>
    shifts!.find(sh => sh.slot === slot)?.event_title || 'Regular opening'

  const handleSignup = async (slot: string) => {
    setLoading(slot)
    setError(null)
    try {
      await signupForShift(shift.date, slot)
      onUpdate() // Refresh shift data
      if (!isSplit) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up')
    } finally {
      setLoading(null)
    }
  }

  const handleWholeNight = async () => {
    setLoading('night')
    setError(null)
    setNotice(null)
    try {
      const result = await signupForWholeNight(shift.date)
      onUpdate()
      if (result.skipped.length > 0) {
        setNotice(
          'Signed up, except for: ' +
            result.skipped.map(s => `${shiftName(s.slot)} (${s.reason})`).join('; '),
        )
      } else {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up')
    } finally {
      setLoading(null)
    }
  }

  const handleCancel = async (slot: string) => {
    setLoading(slot)
    setError(null)
    try {
      await cancelShiftSignup(shift.date, slot)
      onUpdate() // Refresh shift data
      if (!isSplit) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel signup')
    } finally {
      setLoading(null)
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
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent ref={dialogRef} className="sm:max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-[#002147]">Shift Details</DialogTitle>
        </DialogHeader>

        <div>
          <p style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '5px' }}>
            {formatDate(shift.date)}
          </p>
          {isSplit && (
            <p style={{ color: '#555', fontSize: '14px', margin: 0 }}>
              This night has {shifts!.length} separate shifts. Sign up for either, or the whole night.
            </p>
          )}
        </div>

        {shifts!.map((sh, i) => (
          <ShiftSection
            key={sh.slot}
            shift={sh}
            status={statuses[i]}
            times={shiftTimes(sh, events)}
            split={isSplit}
            needsInduction={needsInduction}
            isSupervisedComplete={isSupervisedComplete}
            isCommittee={!!isCommittee}
            currentUserId={currentUserId}
            activeMembers={activeMembers}
            dialogRef={dialogRef}
            loading={loading}
            onSignup={handleSignup}
            onCancel={handleCancel}
            onUpdate={onUpdate}
            onError={setError}
          />
        ))}

        {/* Committee: Induction availability */}
        {isCommittee && shift && (
          <div style={{ padding: '15px', backgroundColor: '#e8f4fd', borderRadius: '4px', border: '1px solid #b8daff' }}>
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
                <Button
                  size="sm"
                  onClick={() => handleInductionAvailToggle(inductionAvailChecked)}
                  disabled={inductionLoading}
                >
                  {inductionLoading ? 'Saving…' : 'Save'}
                </Button>
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

        {notice && (
          <div style={{
            backgroundColor: '#fff3cd',
            color: '#856404',
            padding: '12px',
            borderRadius: '4px',
          }}>
            {notice}
          </div>
        )}

        {error && (
          <div style={{
            backgroundColor: '#f8d7da',
            color: '#721c24',
            padding: '12px',
            borderRadius: '4px',
          }}>
            {error}
          </div>
        )}

        {/* Pre-induction user section */}
        {needsInduction && !isCommittee && (
          <div style={{ padding: '15px', backgroundColor: '#e8f4fd', borderRadius: '4px', border: '1px solid #b8daff' }}>
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
                <Button
                  variant="destructive"
                  size="sm"
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
                >
                  {inductionLoading ? 'Cancelling…' : 'Cancel Induction Signup'}
                </Button>
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
                    <Button
                      onClick={handleInductionSignup}
                      disabled={inductionLoading}
                      className="w-full"
                    >
                      {inductionLoading ? 'Signing up…' : 'Sign Up for Induction'}
                    </Button>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>

          {!needsInduction && (isSplit ? (
            <Button
              onClick={handleWholeNight}
              disabled={loading !== null || !statuses.some(st => st.canSignup)}
              title="Sign up for every shift on this night that has room"
            >
              {loading === 'night' ? 'Signing up…' : 'Whole night'}
            </Button>
          ) : (
            <SignupAction status={single} slot={shift.slot} loading={loading} onSignup={handleSignup} onCancel={handleCancel} />
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type SlotStatus = ReturnType<typeof slotStatus>

/** Sign up / cancel button for one shift, or why it can't be booked. */
function SignupAction({ status, slot, loading, onSignup, onCancel, size }: {
  status: SlotStatus
  slot: string
  loading: string | null
  onSignup: (slot: string) => void
  onCancel: (slot: string) => void
  size?: 'sm'
}) {
  const { isSignedUp, canSignup, needsSupervision, lacksContract, isFull } = status
  if (isSignedUp) {
    return (
      <Button variant="destructive" size={size} onClick={() => onCancel(slot)} disabled={loading !== null}>
        {loading === slot ? 'Cancelling…' : 'Cancel Signup'}
      </Button>
    )
  }
  if (canSignup) {
    return (
      <Button size={size} onClick={() => onSignup(slot)} disabled={loading !== null}>
        {loading === slot ? 'Signing up…' : 'Sign Up'}
      </Button>
    )
  }
  const reason = needsSupervision
    ? 'Supervised Shift Required'
    : lacksContract
      ? 'Contract Required'
      : isFull
        ? 'Shift Full'
        : null
  return reason ? <Button variant="secondary" size={size} disabled>{reason}</Button> : null
}

/** One shift's details, sign-ups and committee controls. On a split night
 *  each shift carries its own sign-up button. */
function ShiftSection({
  shift, status, times, split, needsInduction, isSupervisedComplete, isCommittee, currentUserId,
  activeMembers, dialogRef, loading, onSignup, onCancel, onUpdate, onError,
}: {
  shift: ShiftInfo
  status: SlotStatus
  times: string | null
  split: boolean
  needsInduction: boolean
  isSupervisedComplete: boolean
  isCommittee: boolean
  currentUserId: string | null
  activeMembers: ActiveMember[]
  dialogRef: RefObject<HTMLDivElement | null>
  loading: string | null
  onSignup: (slot: string) => void
  onCancel: (slot: string) => void
  onUpdate: () => void
  onError: (error: string | null) => void
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [removeLoading, setRemoveLoading] = useState<string | null>(null)
  const { isSignedUp, isFull, hasCommitteeMember } = status

  const handleAssign = async () => {
    if (!selectedUserId) return
    setAssignLoading(true)
    onError(null)
    try {
      await assignUserToShift(shift.date, selectedUserId, shift.slot)
      setSelectedUserId('')
      onUpdate()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to assign user')
    } finally {
      setAssignLoading(false)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this user from the shift?')) return
    setRemoveLoading(userId)
    onError(null)
    try {
      await removeUserFromShift(shift.date, userId, shift.slot)
      onUpdate()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove user')
    } finally {
      setRemoveLoading(null)
    }
  }

  return (
    <div data-shift-slot={shift.slot} style={split ? { border: '1px solid #dee2e6', borderRadius: '6px', padding: '12px', display: 'grid', gap: '12px' } : { display: 'contents' }}>
      <div>
        {split && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ fontWeight: 'bold', margin: 0 }}>{shift.event_title || 'Regular opening'}</p>
            {!needsInduction && (
              <SignupAction status={status} slot={shift.slot} loading={loading} onSignup={onSignup} onCancel={onCancel} size="sm" />
            )}
          </div>
        )}
        {times && (
          <p style={{ color: '#555', fontSize: '15px', marginBottom: '5px' }}>
            {times}
          </p>
        )}
        {!split && shift.event_title && (
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

      <div style={{ padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <div style={{ marginBottom: '8px' }}>
          <strong>Volunteers needed:</strong> {shift.max_volunteers}
        </div>
        <div style={{ marginBottom: '8px' }}>
          <strong>Currently signed up:</strong> {shift.signups_count}
          {isFull && <span className="ml-2.5 font-bold text-primary">✓ Full</span>}
        </div>
        {shift.requires_contract && (
          <div style={{ color: '#856404', backgroundColor: '#fff3cd', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
            ⚠️ This shift requires a valid contract
          </div>
        )}
        {needsInduction && !split && (
          <div style={{ color: '#004085', backgroundColor: '#cce5ff', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
            ℹ️ You haven't completed your induction yet. Sign up for an induction session below.
          </div>
        )}
        {!needsInduction && !isSupervisedComplete && (
          <div style={{ color: '#004085', backgroundColor: '#cce5ff', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
            {!hasCommitteeMember
              ? 'ℹ️ You need to complete a supervised shift with a committee member present. Look for dates with a green S on the calendar.'
              : isSignedUp
                ? 'ℹ️ A committee member is on this shift with you. Ask them to mark your supervised shift complete afterwards.'
                : 'ℹ️ A committee member is on this shift, so it counts as your supervised shift.'}
          </div>
        )}
      </div>

      {/* Signup list - hidden for pre-induction users since API returns empty */}
      {!needsInduction && shift.signups.length > 0 && (
        <div>
          <strong>Signed up:</strong>
          <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
            {shift.signups.map((signup) => (
              <li key={signup.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>
                  {signup.display_name || 'Unknown'}
                  {signup.user_id === currentUserId && (
                    <span style={{ color: '#8B0000', marginLeft: '5px' }}>(You)</span>
                  )}
                  {signup.is_committee && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-emerald-300 bg-emerald-50 text-emerald-800"
                    >
                      Committee
                    </Badge>
                  )}
                  {signup.needs_coc && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-amber-300 bg-amber-50 text-amber-800"
                      title="Can't check in until they re-sign the updated Code of Conduct"
                    >
                      Needs to re-sign CoC
                    </Badge>
                  )}
                </span>
                {isCommittee && (
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => handleRemove(signup.user_id)}
                    disabled={removeLoading === signup.user_id}
                    className="ml-2"
                  >
                    {removeLoading === signup.user_id ? '…' : 'Remove'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Committee: Assign member */}
      {isCommittee && (
        <div style={{ padding: '15px', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
          <strong style={{ display: 'block', marginBottom: '8px' }}>Assign Member to Shift</strong>
          {(() => {
            const items = activeMembers
              .filter(m => !shift.signups.some(s => s.user_id === m.user_id))
              .map(m => ({
                value: m.user_id,
                label: (m.display_name || m.user_id) + (shift.requires_contract && !m.has_contract ? ' (no contract)' : ''),
                disabled: shift.requires_contract && !m.has_contract,
              }))
            const selectedItem = items.find(i => i.value === selectedUserId) ?? null
            return (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Combobox
                    items={items}
                    value={selectedItem}
                    onValueChange={(item: typeof items[number] | null) =>
                      setSelectedUserId(item?.value ?? '')
                    }
                    itemToStringValue={(item: typeof items[number]) => item.label}
                  >
                    <ComboboxInput aria-label="Select a member" placeholder="Select a member..." />
                    <ComboboxContent container={dialogRef}>
                      <ComboboxEmpty>No members found.</ComboboxEmpty>
                      <ComboboxList aria-label="Members">
                        {(item: typeof items[number]) => (
                          <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                            {item.label}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </div>
                <Button
                  onClick={handleAssign}
                  disabled={!selectedUserId || assignLoading || isFull}
                >
                  {assignLoading ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

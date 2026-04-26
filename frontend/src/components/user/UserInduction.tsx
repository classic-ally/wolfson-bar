import { useEffect, useState } from 'react'
import { getUserStatus, UserStatus, acceptCodeOfConduct, uploadCertificate, getInductionDates, signupForInduction, cancelInductionSignup, InductionDate, canSignupForShifts, isRotaMember } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'
import CodeOfConduct from '../CodeOfConduct'

export default function UserInduction() {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCoc, setShowCoc] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [inductionDates, setInductionDates] = useState<InductionDate[]>([])
  const [signingUpInduction, setSigningUpInduction] = useState(false)
  const [inductionSignupDate, setInductionSignupDate] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [wantsFullShift, setWantsFullShift] = useState(false)
  usePageTitle('Onboarding')

  useEffect(() => {
    loadStatus()
  }, [])

  useEffect(() => {
    if (status && !status.induction_completed) {
      loadInductionDates()
    }
  }, [status?.induction_completed])

  const loadStatus = async () => {
    try {
      const userStatus = await getUserStatus()
      setStatus(userStatus)
    } catch (err) {
      console.error('Failed to fetch status:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadInductionDates = async () => {
    try {
      const dates = await getInductionDates()
      setInductionDates(dates)
      const signedUp = dates.find(d => d.user_signed_up)
      if (signedUp) {
        setInductionSignupDate(signedUp.date)
        setWantsFullShift(signedUp.user_signed_up_full_shift)
      } else {
        setInductionSignupDate(null)
      }
    } catch (err) {
      console.error('Failed to fetch induction dates:', err)
    }
  }

  const handleCocAccept = async () => {
    try {
      await acceptCodeOfConduct()
      setShowCoc(false)
      loadStatus()
    } catch (err) {
      console.error('Failed to accept CoC:', err)
      alert('Failed to accept Code of Conduct. Please try again.')
    }
  }

  const handleCocDecline = () => {
    setShowCoc(false)
  }

  const handleCertificateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      alert('File must be under 5 MB')
      return
    }

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      alert('Only image files and PDFs are allowed')
      return
    }

    setUploading(true)
    try {
      await uploadCertificate(file)
      alert('Certificate uploaded successfully! It will be reviewed by the committee.')
      loadStatus()
    } catch (err) {
      console.error('Failed to upload certificate:', err)
      alert(err instanceof Error ? err.message : 'Failed to upload certificate. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleInductionSignup = async () => {
    if (!selectedDate) return
    setSigningUpInduction(true)
    try {
      await signupForInduction(selectedDate, wantsFullShift)
      setInductionSignupDate(selectedDate)
      setSelectedDate(null)
      setWantsFullShift(false)
      alert('Signed up for induction successfully!')
      loadInductionDates()
      loadStatus()
    } catch (err) {
      console.error('Failed to sign up for induction:', err)
      alert(err instanceof Error ? err.message : 'Failed to sign up for induction.')
    } finally {
      setSigningUpInduction(false)
    }
  }

  const handleCancelInduction = async (date: string) => {
    try {
      await cancelInductionSignup(date)
      setInductionSignupDate(null)
      alert('Induction signup cancelled.')
      loadInductionDates()
      loadStatus()
    } catch (err) {
      console.error('Failed to cancel induction signup:', err)
      alert(err instanceof Error ? err.message : 'Failed to cancel.')
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>
  }

  if (!status) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Error loading status</div>
  }

  if (showCoc) {
    return <CodeOfConduct onAccept={handleCocAccept} onDecline={handleCocDecline} />
  }

  const isFullyOnboarded = isRotaMember(status)

  return (
    <div>
      <h2>Onboarding Checklist</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Complete these steps to become an active rota member and claim shifts.
      </p>

      {isFullyOnboarded && (
        <div style={{
          backgroundColor: '#d4edda',
          border: '1px solid #c3e6cb',
          color: '#155724',
          padding: '15px',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          ✅ <strong>You're all set!</strong> You can now claim shifts.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* 1. Induction */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.induction_completed ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.induction_completed ? '✅' : '☐'} Induction
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Attend a 7:45–8:30 induction session with a committee member. This is your first step.
          </p>
          {!status.induction_completed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {inductionSignupDate ? (
                <div style={{
                  backgroundColor: '#d4edda',
                  border: '1px solid #c3e6cb',
                  borderRadius: '4px',
                  padding: '12px'
                }}>
                  <p style={{ margin: '0 0 8px 0', color: '#155724', fontSize: '14px' }}>
                    You are signed up for induction on <strong>{formatDate(inductionSignupDate)}</strong>
                  </p>
                  <button
                    onClick={() => handleCancelInduction(inductionSignupDate)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                  >
                    Cancel Signup
                  </button>
                </div>
              ) : inductionDates.length === 0 ? (
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>
                  No induction dates currently available. Check back soon or view the calendar.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <select
                    value={selectedDate || ''}
                    onChange={(e) => {
                      setSelectedDate(e.target.value || null)
                      setWantsFullShift(false)
                    }}
                    style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      backgroundColor: 'white',
                    }}
                  >
                    <option value="">Select an induction date...</option>
                    {inductionDates.filter(d => d.slots_remaining > 0).map(d => (
                      <option key={d.date} value={d.date}>
                        {formatDate(d.date)} — {d.slots_remaining}/4 slots{d.has_full_shift_committee ? ' (full shift available)' : ''}
                      </option>
                    ))}
                  </select>
                  {selectedDate && (() => {
                    const sel = inductionDates.find(d => d.date === selectedDate)
                    const dateHasFullShift = sel?.has_full_shift_committee ?? false
                    return (
                      <div style={{
                        padding: '12px',
                        border: '1px solid #e0e0e0',
                        borderRadius: '6px',
                        backgroundColor: '#fafafa',
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                          <label style={{ fontSize: '13px', color: '#555', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input type="checkbox" checked disabled />
                            Induction (7:45–8:30)
                          </label>
                          <label style={{ fontSize: '13px', color: dateHasFullShift ? '#555' : '#aaa', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="checkbox"
                              checked={wantsFullShift}
                              onChange={(e) => setWantsFullShift(e.target.checked)}
                              disabled={!dateHasFullShift}
                            />
                            Also do supervised shift (full evening)
                            {!dateHasFullShift && (
                              <span style={{ fontSize: '11px', color: '#999' }}> — committee member not on full shift</span>
                            )}
                          </label>
                        </div>
                        <button
                          onClick={handleInductionSignup}
                          disabled={signingUpInduction}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: signingUpInduction ? '#ccc' : '#8B0000',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: signingUpInduction ? 'not-allowed' : 'pointer',
                            fontSize: '13px'
                          }}
                        >
                          {signingUpInduction ? 'Signing up...' : 'Sign Up for Induction'}
                        </button>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}
          {status.induction_completed && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Completed ✓</span>
          )}
        </div>

        {/* 2. Code of Conduct */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.code_of_conduct_signed ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.code_of_conduct_signed ? '✅' : '☐'} Code of Conduct
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Read and agree to the bar's code of conduct.
          </p>
          {!status.code_of_conduct_signed && (
            <button
              onClick={() => setShowCoc(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#8B0000',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Read and Accept
            </button>
          )}
          {status.code_of_conduct_signed && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Completed ✓</span>
          )}
        </div>

        {/* 3. Food Safety */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.food_safety_completed ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.food_safety_completed ? '✅' : '☐'} Food Safety Certificate
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Complete the online food safety course and upload your certificate.
          </p>
          {!status.food_safety_completed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label
                htmlFor="certificate-upload-induction"
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  backgroundColor: uploading ? '#ccc' : '#8B0000',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  width: 'fit-content'
                }}
              >
                {uploading ? 'Uploading...' : status.has_food_safety_certificate ? 'Replace Certificate' : 'Upload Certificate'}
              </label>
              <input
                id="certificate-upload-induction"
                type="file"
                accept="image/*,application/pdf"
                onChange={handleCertificateUpload}
                disabled={uploading}
                style={{ display: 'none' }}
              />
              <span style={{ color: '#888', fontSize: '12px' }}>Accepts images or PDF (max 5 MB)</span>
              {status.has_food_safety_certificate && (
                <span style={{ color: '#856404', fontSize: '14px' }}>⏳ Pending committee review</span>
              )}
            </div>
          )}
          {status.food_safety_completed && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Completed ✓</span>
          )}
        </div>

        {/* 4. Supervised Shift */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.supervised_shift_completed ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.supervised_shift_completed ? '✅' : '☐'} Supervised Shift
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            {status.supervised_shift_completed
              ? 'You have completed a supervised shift.'
              : 'Complete a full shift with a committee member present. This can be done alongside your induction if the committee member is available for the full evening, or separately afterwards.'
            }
          </p>
          {!status.supervised_shift_completed && !status.induction_completed && (
            <p style={{ color: '#888', fontSize: '13px', margin: 0, fontStyle: 'italic' }}>
              Tip: When signing up for induction, select "Also do supervised shift" if a committee member is available for the full evening.
            </p>
          )}
          {!status.supervised_shift_completed && canSignupForShifts(status) && (
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>
              Check the calendar for shifts where a committee member is signed up.
            </p>
          )}
          {status.supervised_shift_completed && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Completed ✓</span>
          )}
        </div>
      </div>
    </div>
  )
}

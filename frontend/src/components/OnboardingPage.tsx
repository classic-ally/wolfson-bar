import { useEffect, useState } from 'react'
import { getUserStatus, UserStatus, acceptCodeOfConduct, uploadCertificate, updateDisplayName, submitContractRequest, acceptPrivacy, startPasskeySetup, getInductionDates, signupForInduction, cancelInductionSignup, InductionDate } from '../lib/auth'
import CodeOfConduct from './CodeOfConduct'

export default function OnboardingPage() {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCoc, setShowCoc] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState('')
  const [contractExpiryDate, setContractExpiryDate] = useState('')
  const [submittingContract, setSubmittingContract] = useState(false)
  const [settingUpPasskey, setSettingUpPasskey] = useState(false)
  const [inductionDates, setInductionDates] = useState<InductionDate[]>([])
  const [inductionSignupDate, setInductionSignupDate] = useState<string | null>(null)
  const [selectedInductionDate, setSelectedInductionDate] = useState<string | null>(null)
  const [inductionFullShift, setInductionFullShift] = useState(false)
  const [signingUpInduction, setSigningUpInduction] = useState(false)

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
      // Restore signup state from API
      const signedUp = dates.find(d => d.user_signed_up)
      if (signedUp) {
        setInductionSignupDate(signedUp.date)
        setInductionFullShift(signedUp.user_signed_up_full_shift)
      } else {
        setInductionSignupDate(null)
      }
    } catch (err) {
      console.error('Failed to fetch induction dates:', err)
    }
  }

  const handlePrivacyAccept = async () => {
    try {
      await acceptPrivacy()
      loadStatus()
    } catch (err) {
      console.error('Failed to accept privacy notice:', err)
      alert('Failed to accept privacy notice. Please try again.')
    }
  }

  const handleCocAccept = async () => {
    try {
      await acceptCodeOfConduct()
      setShowCoc(false)
      loadStatus() // Refresh status
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
      loadStatus() // Refresh status
    } catch (err) {
      console.error('Failed to upload certificate:', err)
      alert(err instanceof Error ? err.message : 'Failed to upload certificate. Please try again.')
    } finally {
      setUploading(false)
      // Reset file input
      e.target.value = ''
    }
  }

  const handleInductionSignup = async () => {
    if (!selectedInductionDate) return
    setSigningUpInduction(true)
    try {
      await signupForInduction(selectedInductionDate, inductionFullShift)
      setInductionSignupDate(selectedInductionDate)
      setSelectedInductionDate(null)
      setInductionFullShift(false)
      alert('Signed up for induction successfully!')
      loadInductionDates()
      loadStatus()
    } catch (err) {
      console.error('Failed to sign up for induction:', err)
      alert(err instanceof Error ? err.message : 'Failed to sign up for induction. Please try again.')
    } finally {
      setSigningUpInduction(false)
    }
  }

  const handleCancelInduction = async (date: string) => {
    try {
      await cancelInductionSignup(date)
      setInductionSignupDate(null)
      setInductionFullShift(false)
      alert('Induction signup cancelled.')
      loadInductionDates()
      loadStatus()
    } catch (err) {
      console.error('Failed to cancel induction signup:', err)
      alert(err instanceof Error ? err.message : 'Failed to cancel induction signup. Please try again.')
    }
  }

  const handleUpdateName = async () => {
    const trimmed = newDisplayName.trim()
    if (!trimmed) {
      alert('Display name cannot be empty')
      return
    }

    try {
      await updateDisplayName(trimmed)
      setEditingName(false)
      setNewDisplayName('')
      loadStatus() // Refresh to show new name
    } catch (err) {
      console.error('Failed to update display name:', err)
      alert(err instanceof Error ? err.message : 'Failed to update display name. Please try again.')
    }
  }

  const startEditingName = () => {
    setNewDisplayName(status?.display_name || '')
    setEditingName(true)
  }

  const handleContractRequest = async () => {
    if (!contractExpiryDate) {
      alert('Please select a contract expiry date')
      return
    }

    setSubmittingContract(true)
    try {
      await submitContractRequest(contractExpiryDate)
      alert('Contract request submitted! It will be reviewed by the committee.')
      setContractExpiryDate('')
      loadStatus() // Refresh status
    } catch (err) {
      console.error('Failed to submit contract request:', err)
      alert(err instanceof Error ? err.message : 'Failed to submit contract request. Please try again.')
    } finally {
      setSubmittingContract(false)
    }
  }

  const handlePasskeySetup = async () => {
    setSettingUpPasskey(true)
    try {
      await startPasskeySetup()
      alert('Passkey set up successfully! You can now use it to sign in.')
      loadStatus()
    } catch (err) {
      console.error('Passkey setup failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to set up passkey. Please try again.')
    } finally {
      setSettingUpPasskey(false)
    }
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

  const isFullyOnboarded =
    status.code_of_conduct_signed &&
    status.food_safety_completed &&
    status.induction_completed &&
    status.supervised_shift_completed

  const formatInductionDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
      <h1>My Profile</h1>

      {/* User Details Section */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '30px',
        backgroundColor: 'white'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '15px' }}>Account Details</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '5px' }}>
              Display Name
            </label>
            {editingName ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  style={{
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    flex: 1,
                    fontSize: '14px'
                  }}
                  maxLength={100}
                  autoFocus
                />
                <button
                  onClick={handleUpdateName}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#666',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '16px', fontWeight: 500 }}>
                  {status.display_name || 'Not set'}
                </span>
                <button
                  onClick={startEditingName}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '5px' }}>
              User ID
            </label>
            <span style={{ fontSize: '14px', color: '#999', fontFamily: 'monospace' }}>
              {status.user_id}
            </span>
          </div>

          {status.is_committee && (
            <div style={{
              backgroundColor: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '4px',
              padding: '8px 12px',
              marginTop: '5px'
            }}>
              <span style={{ fontSize: '14px', color: '#856404' }}>
                ⭐ Committee Member
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Onboarding Section */}
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
        {/* 1. Privacy Notice */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.privacy_consent_given ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.privacy_consent_given ? '✅' : '☐'} Privacy Notice
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Read and acknowledge our privacy notice about how your data is used.
          </p>
          {!status.privacy_consent_given && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <a
                href="/privacy"
                target="_blank"
                style={{
                  color: '#007bff',
                  fontSize: '14px'
                }}
              >
                Read Privacy Notice
              </a>
              <button
                onClick={handlePrivacyAccept}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#8B0000',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                I Acknowledge
              </button>
            </div>
          )}
          {status.privacy_consent_given && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Acknowledged ✓</span>
          )}
        </div>

        {/* 2. Induction */}
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
            Attend a 7:45–8:30 induction session with a committee member.
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
                    You are signed up for induction on <strong>{formatInductionDate(inductionSignupDate)}</strong>
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
                  No induction dates currently available. Check back soon.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <select
                    value={selectedInductionDate || ''}
                    onChange={(e) => {
                      setSelectedInductionDate(e.target.value || null)
                      setInductionFullShift(false)
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
                        {formatInductionDate(d.date)} — {d.slots_remaining}/4 slots{d.has_full_shift_committee ? ' (full shift available)' : ''}
                      </option>
                    ))}
                  </select>
                  {selectedInductionDate && (() => {
                    const selectedDate = inductionDates.find(d => d.date === selectedInductionDate)
                    const dateHasFullShift = selectedDate?.has_full_shift_committee ?? false
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
                              checked={inductionFullShift}
                              onChange={(e) => setInductionFullShift(e.target.checked)}
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

        {/* 3. Code of Conduct */}
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

        {/* 4. Food Safety */}
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
                htmlFor="certificate-upload"
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
                id="certificate-upload"
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

        {/* 5. Supervised Shift */}
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
              Tip: When signing up for induction above, select "Also do supervised shift" if a committee member is available for the full evening.
            </p>
          )}
          {!status.supervised_shift_completed && status.induction_completed && status.code_of_conduct_signed && status.food_safety_completed && (
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>
              Check the calendar for shifts where a committee member is signed up.
            </p>
          )}
          {status.supervised_shift_completed && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Completed ✓</span>
          )}
        </div>

        {/* 6. Contract (Optional) */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.has_contract ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.has_contract ? '✅' : '☐'} Contract (For Paid Shifts)
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            {status.has_contract
              ? `Valid until: ${status.contract_expiry_date || 'N/A'}`
              : 'Optional: Required for certain paid shifts. Submit your contract expiry date for committee verification.'
            }
          </p>
          {!status.has_contract && !status.contract_expiry_date && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '14px', fontWeight: 500 }}>
                Contract Expiry Date
              </label>
              <input
                type="date"
                value={contractExpiryDate}
                onChange={(e) => setContractExpiryDate(e.target.value)}
                style={{
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  width: '200px'
                }}
              />
              <button
                onClick={handleContractRequest}
                disabled={submittingContract || !contractExpiryDate}
                style={{
                  padding: '8px 16px',
                  backgroundColor: submittingContract || !contractExpiryDate ? '#ccc' : '#8B0000',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: submittingContract || !contractExpiryDate ? 'not-allowed' : 'pointer',
                  width: 'fit-content'
                }}
              >
                {submittingContract ? 'Submitting...' : 'Submit Contract Request'}
              </button>
            </div>
          )}
          {!status.has_contract && status.contract_expiry_date && (
            <span style={{ color: '#856404', fontSize: '14px' }}>
              ⏳ Pending committee approval (Expiry: {status.contract_expiry_date})
            </span>
          )}
          {status.has_contract && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Approved ✓</span>
          )}
        </div>

        {/* 7. Passkey Setup (Optional, shown after all required steps) */}
        {isFullyOnboarded && !status.has_passkey && (
          <div style={{
            border: '1px solid #b8daff',
            borderRadius: '8px',
            padding: '20px',
            backgroundColor: '#e7f3ff'
          }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              ☐ Set Up a Passkey (Recommended)
            </h3>
            <p style={{ color: '#666', fontSize: '14px' }}>
              Passkeys let you sign in with your fingerprint, face, or device PIN — faster and more secure than email links.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handlePasskeySetup}
                disabled={settingUpPasskey}
                style={{
                  padding: '8px 16px',
                  backgroundColor: settingUpPasskey ? '#ccc' : '#0d6efd',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: settingUpPasskey ? 'not-allowed' : 'pointer',
                }}
              >
                {settingUpPasskey ? 'Setting up...' : 'Set Up Passkey'}
              </button>
            </div>
          </div>
        )}
        {status.has_passkey && (
          <div style={{
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '20px',
            backgroundColor: '#f0f9ff'
          }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              ✅ Passkey
            </h3>
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Configured ✓</span>
          </div>
        )}
      </div>
    </div>
  )
}

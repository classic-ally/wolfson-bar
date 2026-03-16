import { useEffect, useState } from 'react'
import { getUserStatus, UserStatus, updateDisplayName, submitContractRequest, updateEmail, updateEmailNotifications, exportMyData, deleteMyAccount, logout } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function UserProfile() {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState('')
  const [editingEmail, setEditingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [contractExpiryDate, setContractExpiryDate] = useState('')
  const [submittingContract, setSubmittingContract] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  usePageTitle('Account')

  useEffect(() => {
    loadStatus()
  }, [])

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

  const handleUpdateEmail = async () => {
    const trimmed = newEmail.trim()
    try {
      await updateEmail(trimmed || null)
      setEditingEmail(false)
      setNewEmail('')
      loadStatus()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update email')
    }
  }

  const startEditingEmail = () => {
    setNewEmail(status?.email || '')
    setEditingEmail(true)
  }

  const handleToggleNotifications = async () => {
    if (!status) return
    try {
      await updateEmailNotifications(!status.email_notifications_enabled)
      loadStatus()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update notification settings')
    }
  }

  const handleExportData = async () => {
    try {
      const data = await exportMyData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'my-data.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export data')
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmName !== status?.display_name) {
      alert('Display name does not match')
      return
    }
    try {
      await deleteMyAccount()
      logout()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete account')
    }
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

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>
  }

  if (!status) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Error loading status</div>
  }

  return (
    <div>
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

          {/* Email */}
          <div style={{ marginTop: '10px' }}>
            <label style={{ fontSize: '14px', color: '#666', display: 'block', marginBottom: '5px' }}>
              Email
            </label>
            {editingEmail ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="your@email.com"
                  style={{
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    flex: 1,
                    fontSize: '14px'
                  }}
                  autoFocus
                />
                <button
                  onClick={handleUpdateEmail}
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
                  onClick={() => setEditingEmail(false)}
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
                  {status.email || 'Not set'}
                </span>
                <button
                  onClick={startEditingEmail}
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
            <span style={{ fontSize: '12px', color: '#888' }}>
              Used for magic link sign-in and shift notifications.
            </span>
          </div>

          {/* Email Notifications Toggle */}
          {status.email && (
            <div style={{ marginTop: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={status.email_notifications_enabled}
                  onChange={handleToggleNotifications}
                  style={{ width: '18px', height: '18px' }}
                />
                <span style={{ fontSize: '14px' }}>
                  Receive email notifications for shift changes
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Contract Section */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: status.has_contract ? '#f0f9ff' : 'white'
      }}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          {status.has_contract ? '✅' : '☐'} Contract (For Paid Shifts)
        </h2>
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

      {/* Privacy & Data Section */}
      <div style={{
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '30px',
        backgroundColor: 'white'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '15px' }}>Privacy & Data</h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '15px' }}>
          Read our <a href="/privacy" style={{ color: '#007bff' }}>privacy notice</a> for details about how your data is used.
        </p>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleExportData}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Download My Data
          </button>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Delete My Account
            </button>
          ) : (
            <div style={{
              border: '1px solid #dc3545',
              borderRadius: '4px',
              padding: '15px',
              backgroundColor: '#fff5f5',
              width: '100%',
              marginTop: '10px'
            }}>
              <p style={{ color: '#dc3545', fontWeight: 500, marginTop: 0 }}>
                This will permanently delete your account and all associated data. This cannot be undone.
              </p>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Type your display name (<strong>{status.display_name}</strong>) to confirm:
              </p>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder="Type your display name"
                  style={{
                    padding: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    flex: 1,
                    fontSize: '14px'
                  }}
                />
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmName !== status.display_name}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: deleteConfirmName === status.display_name ? '#dc3545' : '#ccc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: deleteConfirmName === status.display_name ? 'pointer' : 'not-allowed',
                    fontSize: '14px'
                  }}
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); setDeleteConfirmName('') }}
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

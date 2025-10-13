import { useEffect, useState } from 'react'
import { getUserStatus, UserStatus, updateDisplayName, submitContractRequest } from '../../lib/auth'

export default function UserProfile() {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState('')
  const [contractExpiryDate, setContractExpiryDate] = useState('')
  const [submittingContract, setSubmittingContract] = useState(false)

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
    </div>
  )
}

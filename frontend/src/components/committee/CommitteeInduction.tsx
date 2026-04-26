import { useState, useEffect } from 'react'
import { getPendingInductionApprovals, markInduction, markSupervisedShift, verifyInduction } from '../../lib/auth'
import type { PendingInductionApproval } from '../../types/PendingInductionApproval'
import { usePageTitle } from '../../hooks/usePageTitle'
import QRScanner from '../QRScanner'

export default function CommitteeInduction() {
  const [showScanner, setShowScanner] = useState(false)
  const [approvals, setApprovals] = useState<PendingInductionApproval[]>([])
  const [loadingApprovals, setLoadingApprovals] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  usePageTitle('Verify Induction')

  useEffect(() => {
    loadApprovals()
  }, [])

  const loadApprovals = async () => {
    try {
      const data = await getPendingInductionApprovals()
      setApprovals(data)
    } catch (err) {
      console.error('Failed to load pending induction approvals:', err)
    } finally {
      setLoadingApprovals(false)
    }
  }

  const handleApproveInduction = async (approval: PendingInductionApproval) => {
    if (!confirm(`Approve induction for ${approval.display_name || 'Unknown'}?`)) return
    setActionInProgress(approval.user_id)
    try {
      await markInduction(approval.user_id)
      await loadApprovals()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve induction')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleApproveWithSupervised = async (approval: PendingInductionApproval) => {
    if (!confirm(`Approve induction AND supervised shift for ${approval.display_name || 'Unknown'}?`)) return
    setActionInProgress(approval.user_id)
    try {
      await markInduction(approval.user_id)
      await markSupervisedShift(approval.user_id)
      await loadApprovals()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve induction and supervised shift')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleDismiss = async (approval: PendingInductionApproval) => {
    if (!confirm(`Dismiss induction request from ${approval.display_name || 'Unknown'}? This will not mark them as inducted.`)) return
    setApprovals(prev => prev.filter(a => a.user_id !== approval.user_id))
  }

  const handleQRScan = async (token: string) => {
    try {
      await verifyInduction(token)
      alert('Induction verified successfully!')
      setShowScanner(false)
      await loadApprovals()
    } catch (err) {
      console.error('Failed to verify induction:', err)
      alert(err instanceof Error ? err.message : 'Failed to verify induction. Please try again.')
      setShowScanner(false)
    }
  }

  return (
    <div>
      <h1>Induction Verification</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Review pending induction approvals and verify member inductions.
      </p>

      {/* Pending Induction Approvals */}
      <div style={{
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: '30px',
      }}>
        <h3 style={{ marginTop: 0 }}>Pending Induction Approvals</h3>

        {loadingApprovals ? (
          <p style={{ color: '#666' }}>Loading...</p>
        ) : approvals.length === 0 ? (
          <p style={{ color: '#666' }}>No pending induction approvals.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '13px' }}>Date</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '13px' }}>Inductee</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => {
                const disabled = actionInProgress === approval.user_id
                return (
                  <tr key={approval.user_id} style={{ borderBottom: '1px solid #dee2e6' }}>
                    <td style={{ padding: '10px 12px', fontSize: '14px' }}>
                      {new Date(approval.shift_date + 'T00:00:00').toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '14px' }}>
                      {approval.display_name || 'Unknown'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleApproveInduction(approval)}
                          disabled={disabled}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: disabled ? '#ccc' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          Approve Induction
                        </button>
                        {approval.full_shift && (
                          <button
                            onClick={() => handleApproveWithSupervised(approval)}
                            disabled={disabled}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: disabled ? '#ccc' : '#0d6efd',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            Also Approve Supervised Shift
                          </button>
                        )}
                        <button
                          onClick={() => handleDismiss(approval)}
                          disabled={disabled}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: disabled ? '#ccc' : '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* QR Scanner Fallback */}
      <div style={{
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        maxWidth: '600px'
      }}>
        <h3 style={{ marginTop: 0 }}>QR Scanner</h3>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '16px' }}>
          Use this as a manual verification fallback. Scan a member's QR code to verify their induction.
        </p>

        <button
          onClick={() => setShowScanner(true)}
          style={{
            padding: '12px 24px',
            backgroundColor: '#8B0000',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 500,
          }}
        >
          Scan QR Code
        </button>
      </div>

      <div style={{
        marginTop: '30px',
        padding: '16px',
        backgroundColor: '#fff3cd',
        borderRadius: '4px',
        border: '1px solid #ffc107'
      }}>
        <strong>Note:</strong> QR codes expire after 5 minutes for security. If scanning fails, ask the member to generate a new code.
      </div>

      {showScanner && (
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}

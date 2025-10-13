import { useEffect, useState } from 'react'
import { isCommittee, getPendingCertificates, approveCertificate, verifyInduction, getActiveMembers, getPendingContracts, approveContract, getBarHours, updateBarHours, PendingCertificate, ActiveMember, PendingContract, BarHours } from '../lib/auth'
import CertificateModal from './CertificateModal'
import QRScanner from './QRScanner'
import EventManagement from './EventManagement'

export default function CommitteePage() {
  const [pendingCerts, setPendingCerts] = useState<PendingCertificate[]>([])
  const [pendingContracts, setPendingContracts] = useState<PendingContract[]>([])
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([])
  const [barHours, setBarHours] = useState<BarHours[]>([])
  const [editingDay, setEditingDay] = useState<number | null>(null)
  const [editOpenTime, setEditOpenTime] = useState('')
  const [editCloseTime, setEditCloseTime] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedCert, setSelectedCert] = useState<PendingCertificate | null>(null)
  const [showScanner, setShowScanner] = useState(false)

  useEffect(() => {
    loadPendingCertificates()
    loadPendingContracts()
    loadActiveMembers()
    loadBarHours()
  }, [])

  const loadPendingCertificates = async () => {
    try {
      const certs = await getPendingCertificates()
      setPendingCerts(certs)
    } catch (err) {
      console.error('Failed to load pending certificates:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadPendingContracts = async () => {
    try {
      const contracts = await getPendingContracts()
      setPendingContracts(contracts)
    } catch (err) {
      console.error('Failed to load pending contracts:', err)
    }
  }

  const loadActiveMembers = async () => {
    try {
      const members = await getActiveMembers()
      setActiveMembers(members)
    } catch (err) {
      console.error('Failed to load active members:', err)
    }
  }

  const loadBarHours = async () => {
    try {
      const hours = await getBarHours()
      setBarHours(hours)
    } catch (err) {
      console.error('Failed to load bar hours:', err)
    }
  }

  const handleEditBarHours = (day: BarHours) => {
    setEditingDay(day.day_of_week)
    setEditOpenTime(day.open_time)
    setEditCloseTime(day.close_time)
  }

  const handleSaveBarHours = async () => {
    if (editingDay === null) return

    try {
      await updateBarHours(editingDay, editOpenTime, editCloseTime)
      setEditingDay(null)
      setEditOpenTime('')
      setEditCloseTime('')
      loadBarHours()
    } catch (err) {
      console.error('Failed to update bar hours:', err)
      alert('Failed to update bar hours. Please try again.')
    }
  }

  const handleCancelEdit = () => {
    setEditingDay(null)
    setEditOpenTime('')
    setEditCloseTime('')
  }

  const getDayName = (dayOfWeek: number): string => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return days[dayOfWeek]
  }

  const handleApprove = async () => {
    if (!selectedCert) return

    try {
      await approveCertificate(selectedCert.user_id)
      setSelectedCert(null)
      loadPendingCertificates() // Refresh list
    } catch (err) {
      console.error('Failed to approve certificate:', err)
      alert('Failed to approve certificate. Please try again.')
    }
  }

  const handleQRScan = async (token: string) => {
    try {
      await verifyInduction(token)
      alert('Induction verified successfully!')
      setShowScanner(false)
    } catch (err) {
      console.error('Failed to verify induction:', err)
      alert(err instanceof Error ? err.message : 'Failed to verify induction. Please try again.')
      setShowScanner(false)
    }
  }

  if (!isCommittee()) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Access Denied</h1>
        <p>You need to be a committee member to access this page.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>Committee Dashboard</h1>
      <p style={{ color: '#666' }}>Manage users, review certificates, and oversee rota operations.</p>

      <section style={{ marginTop: '40px' }}>
        <EventManagement />
      </section>

      <section style={{ marginTop: '40px' }}>
        <h2>Bar Opening Hours</h2>
        <p style={{ color: '#666', marginBottom: '10px' }}>
          Configure the default opening and closing times for each day of the week.
        </p>
        {barHours.length === 0 ? (
          <p>Loading...</p>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '10px',
            backgroundColor: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Day</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Open Time</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Close Time</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {barHours.map((day) => (
                <tr key={day.day_of_week} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px' }}>{getDayName(day.day_of_week)}</td>
                  <td style={{ padding: '12px' }}>
                    {editingDay === day.day_of_week ? (
                      <input
                        type="time"
                        value={editOpenTime}
                        onChange={(e) => setEditOpenTime(e.target.value)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '14px'
                        }}
                      />
                    ) : (
                      day.open_time
                    )}
                  </td>
                  <td style={{ padding: '12px' }}>
                    {editingDay === day.day_of_week ? (
                      <input
                        type="time"
                        value={editCloseTime}
                        onChange={(e) => setEditCloseTime(e.target.value)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '14px'
                        }}
                      />
                    ) : (
                      day.close_time
                    )}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {editingDay === day.day_of_week ? (
                      <>
                        <button
                          onClick={handleSaveBarHours}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            marginRight: '8px'
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px'
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleEditBarHours(day)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#007bff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '40px' }}>
        <h2>Verify Induction</h2>
        <p style={{ color: '#666', marginBottom: '10px' }}>
          Scan a member's QR code to verify their induction completion.
        </p>
        <button
          onClick={() => setShowScanner(true)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#8B0000',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Scan QR Code
        </button>
      </section>

      <section style={{ marginTop: '40px' }}>
        <h2>Active Members</h2>
        <p style={{ color: '#666', marginBottom: '10px' }}>
          Members who have completed all onboarding requirements (CoC, food safety, and induction).
        </p>
        {loading ? (
          <p>Loading...</p>
        ) : activeMembers.length === 0 ? (
          <div style={{
            padding: '20px',
            backgroundColor: '#f8f9fa',
            borderRadius: '4px',
            textAlign: 'center'
          }}>
            No active members yet
          </div>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '10px',
            backgroundColor: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Role</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Contract</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {activeMembers.map((member) => (
                <tr key={member.user_id} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px' }}>{member.display_name || 'Unknown'}</td>
                  <td style={{ padding: '12px' }}>
                    {member.is_committee ? (
                      <span style={{
                        backgroundColor: '#ffc107',
                        color: '#856404',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 500
                      }}>
                        Committee
                      </span>
                    ) : (
                      <span style={{ color: '#666' }}>Member</span>
                    )}
                  </td>
                  <td style={{ padding: '12px' }}>
                    {member.has_contract ? (
                      <span style={{ color: '#28a745' }}>✓ Yes</span>
                    ) : (
                      <span style={{ color: '#999' }}>No</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', color: '#666' }}>
                    {member.contract_expiry_date || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '40px' }}>
        <h2>Pending Contract Approvals</h2>
        <p style={{ color: '#666', marginBottom: '10px' }}>
          Review and approve contract requests. Verify with HR before approving.
        </p>
        {loading ? (
          <p>Loading...</p>
        ) : pendingContracts.length === 0 ? (
          <div style={{
            padding: '20px',
            backgroundColor: '#f0f9ff',
            borderRadius: '4px',
            textAlign: 'center'
          }}>
            ✓ No pending contract requests
          </div>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '10px',
            backgroundColor: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Expiry Date</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingContracts.map((contract) => (
                <tr key={contract.user_id} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px' }}>{contract.display_name || 'Unknown'}</td>
                  <td style={{ padding: '12px', color: '#666' }}>{contract.contract_expiry_date}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button
                      onClick={async () => {
                        if (confirm(`Approve contract for ${contract.display_name || 'this user'} (expires ${contract.contract_expiry_date})?`)) {
                          try {
                            await approveContract(contract.user_id)
                            loadPendingContracts()
                            loadActiveMembers() // Refresh active members list
                          } catch (err) {
                            alert('Failed to approve contract')
                          }
                        }
                      }}
                      style={{
                        padding: '6px 16px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '40px' }}>
        <h2>Pending Food Safety Certificate Reviews</h2>
        {loading ? (
          <p>Loading...</p>
        ) : pendingCerts.length === 0 ? (
          <div style={{
            padding: '20px',
            backgroundColor: '#f0f9ff',
            borderRadius: '4px',
            textAlign: 'center'
          }}>
            ✓ No pending certificates to review
          </div>
        ) : (
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '10px',
            backgroundColor: 'white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingCerts.map((cert) => (
                <tr key={cert.user_id} style={{ borderBottom: '1px solid #dee2e6' }}>
                  <td style={{ padding: '12px' }}>{cert.display_name || 'Unknown'}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button
                      onClick={() => setSelectedCert(cert)}
                      style={{
                        padding: '6px 16px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginRight: '8px'
                      }}
                    >
                      View Certificate
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`Approve certificate for ${cert.display_name || 'this user'}?`)) {
                          try {
                            await approveCertificate(cert.user_id)
                            loadPendingCertificates()
                          } catch (err) {
                            alert('Failed to approve')
                          }
                        }
                      }}
                      style={{
                        padding: '6px 16px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedCert && (
        <CertificateModal
          userId={selectedCert.user_id}
          displayName={selectedCert.display_name}
          onApprove={handleApprove}
          onClose={() => setSelectedCert(null)}
        />
      )}

      {showScanner && (
        <QRScanner
          onScan={handleQRScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { getPendingCertificates, getPendingContracts, getActiveMembers, approveCertificate, approveContract, PendingCertificate, PendingContract, ActiveMember } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'
import CertificateModal from '../CertificateModal'

export default function CommitteeMembers() {
  const [pendingCerts, setPendingCerts] = useState<PendingCertificate[]>([])
  const [pendingContracts, setPendingContracts] = useState<PendingContract[]>([])
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCert, setSelectedCert] = useState<PendingCertificate | null>(null)
  usePageTitle('Members')

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      await Promise.all([
        loadPendingCertificates(),
        loadPendingContracts(),
        loadActiveMembers()
      ])
    } finally {
      setLoading(false)
    }
  }

  const loadPendingCertificates = async () => {
    try {
      const certs = await getPendingCertificates()
      setPendingCerts(certs)
    } catch (err) {
      console.error('Failed to load pending certificates:', err)
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

  const handleApprove = async () => {
    if (!selectedCert) return

    try {
      await approveCertificate(selectedCert.user_id)
      setSelectedCert(null)
      loadPendingCertificates()
      loadActiveMembers()
    } catch (err) {
      console.error('Failed to approve certificate:', err)
      alert('Failed to approve certificate. Please try again.')
    }
  }

  return (
    <div>
      <h1>Member Management</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Review pending approvals and manage active rota members.
      </p>

      {/* Pending Contracts */}
      <section style={{ marginBottom: '40px' }}>
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
                            loadActiveMembers()
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

      {/* Pending Food Safety Certificates */}
      <section style={{ marginBottom: '40px' }}>
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
                            loadActiveMembers()
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

      {/* Active Members */}
      <section>
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

      {selectedCert && (
        <CertificateModal
          userId={selectedCert.user_id}
          displayName={selectedCert.display_name}
          onApprove={handleApprove}
          onClose={() => setSelectedCert(null)}
        />
      )}
    </div>
  )
}

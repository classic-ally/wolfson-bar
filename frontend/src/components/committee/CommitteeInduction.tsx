import { useState } from 'react'
import { verifyInduction } from '../../lib/auth'
import QRScanner from '../QRScanner'

export default function CommitteeInduction() {
  const [showScanner, setShowScanner] = useState(false)

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

  return (
    <div>
      <h1>Induction Verification</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Scan a member's QR code to verify their induction completion during their training shift.
      </p>

      <div style={{
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        maxWidth: '600px'
      }}>
        <h3 style={{ marginTop: 0 }}>How to Verify Induction</h3>
        <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>Member completes their training shift with you</li>
          <li>Member opens their profile page and generates QR code</li>
          <li>Click "Scan QR Code" below to open the scanner</li>
          <li>Scan the QR code displayed on the member's device</li>
          <li>System will mark their induction as complete</li>
        </ol>

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
            marginTop: '20px'
          }}
        >
          📷 Scan QR Code
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

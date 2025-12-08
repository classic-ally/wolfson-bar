import { useEffect, useState } from 'react'
import { getUserStatus, UserStatus, acceptCodeOfConduct, uploadCertificate, getVerificationToken } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'
import CodeOfConduct from '../CodeOfConduct'
import QRCode from 'qrcode'

export default function UserInduction() {
  const [status, setStatus] = useState<UserStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCoc, setShowCoc] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  usePageTitle('Induction')

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

  const handleShowQR = async () => {
    try {
      const token = await getVerificationToken('induction')
      const qr = await QRCode.toDataURL(token, { width: 300 })
      setQrDataUrl(qr)
      setShowQR(true)
    } catch (err) {
      console.error('Failed to generate QR code:', err)
      alert('Failed to generate QR code. Please try again.')
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

  if (showQR && qrDataUrl) {
    return (
      <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', textAlign: 'center' }}>
        <h2>Induction Verification QR Code</h2>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          Show this QR code to a committee member during your induction shift.
          This code expires in 5 minutes.
        </p>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          border: '2px solid #ddd',
          marginBottom: '20px'
        }}>
          <img src={qrDataUrl} alt="Verification QR Code" style={{ maxWidth: '100%' }} />
        </div>
        <button
          onClick={() => setShowQR(false)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#666',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    )
  }

  const isFullyOnboarded =
    status.code_of_conduct_signed &&
    status.food_safety_completed &&
    status.induction_completed

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
        {/* Code of Conduct */}
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

        {/* Food Safety */}
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

        {/* Induction Shift */}
        <div style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: status.induction_completed ? '#f0f9ff' : 'white'
        }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            {status.induction_completed ? '✅' : '☐'} Induction Shift
          </h3>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Complete an induction shift with an experienced rota member.
          </p>
          {!status.induction_completed && (
            <button
              onClick={handleShowQR}
              style={{
                padding: '8px 16px',
                backgroundColor: '#8B0000',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Show QR Code for Verification
            </button>
          )}
          {status.induction_completed && (
            <span style={{ color: '#0066cc', fontSize: '14px' }}>Completed ✓</span>
          )}
        </div>
      </div>
    </div>
  )
}

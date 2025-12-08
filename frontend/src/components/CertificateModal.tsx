import { useEffect, useState } from 'react'
import { getCertificateData, CertificateData } from '../lib/auth'

interface CertificateModalProps {
  userId: string
  displayName: string | null
  onApprove: () => void
  onClose: () => void
}

export default function CertificateModal({ userId, displayName, onApprove, onClose }: CertificateModalProps) {
  const [certificate, setCertificate] = useState<CertificateData | null>(null)

  useEffect(() => {
    getCertificateData(userId)
      .then(setCertificate)
      .catch(err => console.error('Failed to load certificate:', err))

    // Cleanup blob URL when component unmounts
    return () => {
      if (certificate?.url) {
        URL.revokeObjectURL(certificate.url)
      }
    }
  }, [userId])

  const isPdf = certificate?.contentType === 'application/pdf'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '30px',
          width: isPdf ? '90vw' : 'auto',
          maxWidth: isPdf ? '1200px' : '800px',
          height: isPdf ? '90vh' : 'auto',
          maxHeight: '90vh',
          overflow: 'auto',
          position: 'relative',
          display: isPdf ? 'flex' : 'block',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: '#666',
          }}
        >
          ×
        </button>

        <h2 style={{ marginTop: 0 }}>Food Safety Certificate</h2>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          User: {displayName || 'Unknown'}
        </p>

        <div
          style={{
            marginBottom: '20px',
            textAlign: 'center',
            flex: isPdf ? 1 : undefined,
            minHeight: 0,
          }}
        >
          {!certificate ? (
            <div style={{ padding: '40px', color: '#666' }}>Loading...</div>
          ) : isPdf ? (
            <iframe
              src={certificate.url}
              title="Food Safety Certificate"
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '4px',
                border: '1px solid #ddd',
              }}
            />
          ) : (
            <img
              src={certificate.url}
              alt="Food Safety Certificate"
              style={{
                maxWidth: '100%',
                maxHeight: '60vh',
                borderRadius: '4px',
                border: '1px solid #ddd',
              }}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
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
          <button
            onClick={onApprove}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

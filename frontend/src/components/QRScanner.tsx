import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

interface QRScannerProps {
  onScan: (decodedText: string) => void
  onClose: () => void
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const qrCodeRegionId = 'qr-reader'

  useEffect(() => {
    const startScanner = async () => {
      try {
        const html5QrCode = new Html5Qrcode(qrCodeRegionId)
        scannerRef.current = html5QrCode

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            onScan(decodedText)
            stopScanner()
          },
          () => {
            // Ignore decode errors (happens frequently as it scans)
          }
        )

        setIsScanning(true)
      } catch (err) {
        console.error('Failed to start QR scanner:', err)
        setError('Failed to access camera. Please grant camera permissions.')
      }
    }

    startScanner()

    return () => {
      stopScanner()
    }
  }, [])

  const stopScanner = () => {
    if (scannerRef.current?.isScanning) {
      scannerRef.current
        .stop()
        .then(() => {
          setIsScanning(false)
        })
        .catch((err) => {
          console.error('Failed to stop scanner:', err)
        })
    }
  }

  const handleClose = () => {
    stopScanner()
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '30px',
          maxWidth: '600px',
          width: '90%',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
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

        <h2 style={{ marginTop: 0 }}>Scan QR Code</h2>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          Position the QR code in front of your camera
        </p>

        {error && (
          <div
            style={{
              backgroundColor: '#f8d7da',
              color: '#721c24',
              padding: '10px',
              borderRadius: '4px',
              marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        <div
          id={qrCodeRegionId}
          style={{
            width: '100%',
            border: '2px solid #ddd',
            borderRadius: '4px',
          }}
        />

        {isScanning && (
          <p style={{ textAlign: 'center', color: '#666', marginTop: '10px', fontSize: '14px' }}>
            Scanning...
          </p>
        )}
      </div>
    </div>
  )
}

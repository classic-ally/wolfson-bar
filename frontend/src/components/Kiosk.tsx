import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import Page from './Page'
import {
  clearKioskToken,
  getKioskCode,
  getKioskToken,
  kioskPairStart,
  kioskPairStatus,
  randomHex,
  setKioskToken,
  sha256Hex,
} from '../lib/auth'

// Device-facing kiosk screen, shown on the bar PC.
//  - unenrolled  → display a pairing QR for a committee phone to scan + approve
//  - enrolled    → display the rotating check-in QR rota members scan
type Mode = 'loading' | 'pairing' | 'enrolled' | 'error'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function Kiosk() {
  const [mode, setMode] = useState<Mode>('loading')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [error, setError] = useState('')
  // Raw device token held until the committee approves the pairing. Never sent
  // to the server — only its hash is.
  const pendingToken = useRef<string | null>(null)

  // Bootstrap: enrolled if our token still mints codes, else begin pairing.
  useEffect(() => {
    let active = true
    async function boot() {
      if (getKioskToken()) {
        try {
          await getKioskCode()
          if (active) setMode('enrolled')
          return
        } catch {
          clearKioskToken()
        }
      }
      try {
        const rawToken = randomHex(32)
        const hash = await sha256Hex(rawToken)
        const code = await kioskPairStart(hash)
        if (!active) return
        pendingToken.current = rawToken
        setPairingCode(code)
        setMode('pairing')
      } catch (e) {
        if (active) {
          setError(msg(e))
          setMode('error')
        }
      }
    }
    boot()
    return () => {
      active = false
    }
  }, [])

  // While pairing: render the pairing QR and poll for committee approval.
  useEffect(() => {
    if (mode !== 'pairing' || !pairingCode) return
    let active = true
    const pairUrl = `${window.location.origin}/committee/kiosk/pair?code=${encodeURIComponent(pairingCode)}`
    QRCode.toDataURL(pairUrl, { width: 360, margin: 2 }).then((u) => {
      if (active) setQrDataUrl(u)
    })
    const id = setInterval(async () => {
      try {
        const status = await kioskPairStatus(pairingCode)
        if (status === 'approved' && pendingToken.current) {
          setKioskToken(pendingToken.current)
          pendingToken.current = null
          if (active) setMode('enrolled')
        }
      } catch {
        // transient — keep polling
      }
    }, 3000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [mode, pairingCode])

  // While enrolled: refresh the rotating check-in QR on an interval.
  useEffect(() => {
    if (mode !== 'enrolled') return
    let active = true
    async function refresh() {
      try {
        const cc = await getKioskCode()
        const u = await QRCode.toDataURL(cc.url, { width: 360, margin: 2 })
        if (active) setQrDataUrl(u)
      } catch {
        // Token revoked or unreachable → forget it and re-pair from scratch.
        clearKioskToken()
        if (active) {
          pendingToken.current = null
          setQrDataUrl('')
          setPairingCode('')
          setMode('loading')
        }
      }
    }
    refresh()
    const id = setInterval(refresh, 10000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [mode])

  return (
    <Page size="wide">
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        {mode === 'loading' && <h2>Starting kiosk…</h2>}

        {mode === 'error' && (
          <>
            <h2 style={{ color: '#dc3545' }}>Kiosk error</h2>
            <p style={{ color: '#666' }}>{error}</p>
          </>
        )}

        {mode === 'pairing' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Pair this kiosk</h1>
            <p style={{ color: '#666', marginTop: 0 }}>
              Scan with a committee member's phone to enrol this screen.
            </p>
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="Pairing QR code"
                data-testid="pairing-qr"
                style={{
                  display: 'block',
                  margin: '0 auto',
                  width: 360,
                  height: 360,
                  maxWidth: '80vw',
                  maxHeight: '80vw',
                }}
              />
            )}
          </>
        )}

        {mode === 'enrolled' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Scan to check in</h1>
            <p style={{ color: '#666', marginTop: 0 }}>
              Scan with your phone when you start your shift.
            </p>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Check-in QR code"
                data-testid="checkin-qr"
                style={{
                  display: 'block',
                  margin: '0 auto',
                  width: 360,
                  height: 360,
                  maxWidth: '80vw',
                  maxHeight: '80vw',
                }}
              />
            ) : (
              <p>Loading code…</p>
            )}
          </>
        )}
      </div>
    </Page>
  )
}

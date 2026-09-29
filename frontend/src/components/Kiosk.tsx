import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import Page from './Page'
import { Button } from '@/components/ui/button'
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
import { isRevoked, nextRefreshDelay, pairingIsDead } from '../lib/kioskPolicy'

// Device-facing kiosk screen, shown on the bar PC.
//  - unenrolled  → display a pairing QR for a committee phone to scan + approve
//  - enrolled    → display the rotating check-in QR rota members scan
// Only a 401 from the server de-enrols the kiosk; network errors and 5xx keep
// the token and retry, so power cuts and deploys don't force a re-pair.
type Mode = 'starting' | 'pairing' | 'enrolled' | 'error'

const PAIR_POLL_MS = 3000
const QR_OPTIONS = { width: 360, margin: 2 }

const qrStyle: React.CSSProperties = {
  display: 'block',
  margin: '0 auto',
  width: 360,
  height: 360,
  maxWidth: '80vw',
  maxHeight: '80vw',
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function Kiosk() {
  const [mode, setMode] = useState<Mode>('starting')
  // Bumped to re-run boot (after a revoke, expired pairing, or manual retry).
  const [attempt, setAttempt] = useState(0)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState('')
  // Raw device token held until the committee approves the pairing. Never sent
  // to the server — only its hash is.
  const pendingToken = useRef<string | null>(null)

  const restart = useCallback(() => {
    pendingToken.current = null
    setQrDataUrl('')
    setPairingCode('')
    setOffline(false)
    setError('')
    setMode('starting')
    setAttempt((n) => n + 1)
  }, [])

  // Boot: enrolled if we hold a token the server hasn't revoked, else begin pairing.
  useEffect(() => {
    let active = true
    async function boot() {
      if (getKioskToken()) {
        try {
          await getKioskCode()
          if (active) setMode('enrolled')
          return
        } catch (e) {
          if (!isRevoked(e)) {
            // Server unreachable: stay enrolled; the refresh loop keeps retrying.
            if (active) {
              setOffline(true)
              setMode('enrolled')
            }
            return
          }
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
  }, [attempt])

  // While pairing: render the pairing QR and poll for committee approval.
  useEffect(() => {
    if (mode !== 'pairing' || !pairingCode) return
    let active = true
    const pairUrl = `${window.location.origin}/committee/kiosk/pair?code=${encodeURIComponent(pairingCode)}`
    QRCode.toDataURL(pairUrl, QR_OPTIONS)
      .then((u) => {
        if (active) setQrDataUrl(u)
      })
      .catch((e) => {
        if (active) {
          setError(msg(e))
          setMode('error')
        }
      })
    const id = setInterval(async () => {
      try {
        const status = await kioskPairStatus(pairingCode)
        if (!active) return
        if (status === 'approved' && pendingToken.current) {
          setKioskToken(pendingToken.current)
          pendingToken.current = null
          setQrDataUrl('')
          setMode('enrolled')
        } else if (status === 'approved' || pairingIsDead(status)) {
          // Expired, purged, or approved without our token in hand: start over.
          restart()
        }
      } catch {
        // transient — keep polling
      }
    }, PAIR_POLL_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [mode, pairingCode, restart])

  // While enrolled: refresh the rotating check-in QR, backing off while offline.
  useEffect(() => {
    if (mode !== 'enrolled') return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    async function refresh() {
      let period: number | null = null
      try {
        const cc = await getKioskCode()
        period = cc.period_seconds
        const u = await QRCode.toDataURL(cc.url, QR_OPTIONS)
        if (!active) return
        failures = 0
        setQrDataUrl(u)
        setOffline(false)
      } catch (e) {
        if (!active) return
        if (isRevoked(e)) {
          clearKioskToken()
          restart()
          return
        }
        failures += 1
        setOffline(true)
      }
      timer = setTimeout(refresh, nextRefreshDelay(period, failures))
    }
    refresh()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [mode, restart])

  return (
    <Page size="wide">
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        {mode === 'starting' && <h2>Starting kiosk…</h2>}

        {mode === 'error' && (
          <>
            <h2 style={{ color: '#dc3545' }}>Kiosk error</h2>
            <p style={{ color: '#666' }}>{error}</p>
            <Button onClick={restart}>Try again</Button>
          </>
        )}

        {mode === 'pairing' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Pair this kiosk</h1>
            <p style={{ color: '#666', marginTop: 0 }}>
              Scan with a committee member's phone to enrol this screen.
            </p>
            {qrDataUrl && (
              <img src={qrDataUrl} alt="Pairing QR code" data-testid="pairing-qr" style={qrStyle} />
            )}
          </>
        )}

        {mode === 'enrolled' && (
          <>
            <h1 style={{ marginBottom: 8 }}>Scan to check in</h1>
            <p style={{ color: '#666', marginTop: 0 }}>
              Scan with your phone when you start your shift.
            </p>
            {offline && (
              <p role="status" style={{ color: '#b45309', fontWeight: 600 }}>
                Reconnecting to the server…
              </p>
            )}
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Check-in QR code"
                data-testid="checkin-qr"
                style={{ ...qrStyle, opacity: offline ? 0.25 : 1 }}
              />
            ) : (
              !offline && <p>Loading code…</p>
            )}
          </>
        )}
      </div>
    </Page>
  )
}

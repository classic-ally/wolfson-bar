import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getKioskPairingInfo, kioskPairApprove } from '../../lib/auth'
import type { PairingInfo } from '../../types/PairingInfo'

// Committee-only approve screen, reached by scanning the kiosk's pairing QR.
type State = 'idle' | 'approving' | 'done' | 'error'

/** Server timestamps are UTC `YYYY-MM-DD HH:MM:SS`; show them in the viewer's time. */
function formatUtc(ts: string): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString()
}

export default function CommitteeKioskPair() {
  const [params] = useSearchParams()
  const code = params.get('code') || ''
  const [name, setName] = useState('Bar till PC')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')
  const [info, setInfo] = useState<PairingInfo | null>(null)

  useEffect(() => {
    if (!code) return
    getKioskPairingInfo(code)
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load pairing'))
  }, [code])

  async function approve() {
    setState('approving')
    try {
      await kioskPairApprove(code, name)
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve')
      setState('error')
    }
  }

  if (!code) {
    return (
      <div>
        <h2>Pair a kiosk</h2>
        <p style={{ color: '#dc3545' }}>
          No pairing code. Scan the QR shown on the bar PC's kiosk screen.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h2>Pair a kiosk</h2>
      {state === 'done' ? (
        <p style={{ color: '#198754' }}>
          ✅ Kiosk enrolled. The bar PC will switch to showing check-in codes.
        </p>
      ) : (
        <>
          <p style={{ color: '#666' }}>
            Approve this screen as a trusted kiosk. Only do this for the bar's own
            computer, while you're standing in front of it.
          </p>
          {info && (
            <dl data-testid="pairing-info" style={{ color: '#444', margin: '12px 0' }}>
              <dt style={{ fontWeight: 600 }}>Requested</dt>
              <dd style={{ margin: '0 0 8px' }}>{formatUtc(info.created_at)}</dd>
              <dt style={{ fontWeight: 600 }}>From</dt>
              <dd style={{ margin: '0 0 8px' }}>{info.client_ip ?? 'unknown address'}</dd>
              <dt style={{ fontWeight: 600 }}>Browser</dt>
              <dd style={{ margin: '0 0 8px', wordBreak: 'break-word' }}>
                {info.user_agent ?? 'unknown'}
              </dd>
            </dl>
          )}
          {info && info.active_devices > 0 && (
            <p role="alert" style={{ color: '#b45309' }}>
              Approving replaces the current kiosk — it will stop showing check-in codes.
            </p>
          )}
          <label style={{ display: 'block', marginBottom: 8 }}>
            Device name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px',
                marginTop: 4,
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
          </label>
          <button
            onClick={approve}
            disabled={state === 'approving'}
            style={{
              padding: '10px 20px',
              backgroundColor: '#8B0000',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {state === 'approving' ? 'Approving…' : 'Approve kiosk'}
          </button>
          {error && <p style={{ color: '#dc3545', marginTop: 16 }}>{error}</p>}
        </>
      )}
    </div>
  )
}

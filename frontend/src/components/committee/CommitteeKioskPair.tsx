import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { kioskPairApprove } from '../../lib/auth'

// Committee-only approve screen, reached by scanning the kiosk's pairing QR.
type State = 'idle' | 'approving' | 'done' | 'error'

export default function CommitteeKioskPair() {
  const [params] = useSearchParams()
  const code = params.get('code') || ''
  const [name, setName] = useState('Bar till PC')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')

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
            computer.
          </p>
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

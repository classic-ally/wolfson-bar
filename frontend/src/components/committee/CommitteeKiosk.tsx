import { useEffect, useState } from 'react'
import { closeBar, getBarStatus, listKioskDevices, revokeKioskDevice } from '../../lib/auth'
import type { BarStatus } from '../../types/BarStatus'
import type { KioskDeviceInfo } from '../../types/KioskDeviceInfo'

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function CommitteeKiosk() {
  const [devices, setDevices] = useState<KioskDeviceInfo[]>([])
  const [bar, setBar] = useState<BarStatus | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      setError('')
      setDevices(await listKioskDevices())
      setBar(await getBarStatus())
    } catch (e) {
      setError(msg(e))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleRevoke(id: string) {
    try {
      await revokeKioskDevice(id)
      await load()
    } catch (e) {
      setError(msg(e))
    }
  }

  async function handleCloseBar() {
    try {
      await closeBar()
      await load()
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div>
      <h2>Kiosk</h2>
      <p style={{ color: '#666' }}>
        On the bar PC, open <code>/kiosk</code> and scan the pairing QR with your
        phone to enrol it. Once enrolled it shows the rotating check-in code rota
        members scan at the start of their shift.
      </p>

      {error && <p style={{ color: '#dc3545' }}>{error}</p>}

      <section style={{ margin: '24px 0' }}>
        <h3>Bar status</h3>
        <p data-testid="bar-status">
          {bar === null ? 'Loading…' : bar.is_open ? '🟢 Open' : '⚪ Closed'}
        </p>
        {bar?.is_open && (
          <button
            onClick={handleCloseBar}
            style={{
              padding: '8px 16px',
              backgroundColor: '#8B0000',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Close bar
          </button>
        )}
      </section>

      <section>
        <h3>Enrolled devices</h3>
        {devices.length === 0 ? (
          <p style={{ color: '#666' }}>No devices enrolled yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '8px' }}>Name</th>
                <th style={{ padding: '8px' }}>Last seen</th>
                <th style={{ padding: '8px' }}>Status</th>
                <th style={{ padding: '8px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px' }}>{d.name || 'Unnamed device'}</td>
                  <td style={{ padding: '8px', color: '#666' }}>{d.last_seen_at || 'never'}</td>
                  <td style={{ padding: '8px' }}>{d.revoked ? 'Revoked' : 'Active'}</td>
                  <td style={{ padding: '8px' }}>
                    {!d.revoked && (
                      <button
                        onClick={() => handleRevoke(d.id)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'transparent',
                          color: '#8B0000',
                          border: '1px solid #8B0000',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

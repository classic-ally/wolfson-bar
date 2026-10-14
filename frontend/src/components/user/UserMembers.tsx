import { useEffect, useMemo, useState } from 'react'
import { getRotaMembers } from '../../lib/auth'
import type { RotaMember } from '../../types/RotaMember'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function UserMembers() {
  const [members, setMembers] = useState<RotaMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  usePageTitle('Rota Members')

  useEffect(() => {
    getRotaMembers()
      .then(setMembers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load rota members'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? members.filter((m) => m.display_name.toLowerCase().includes(q)) : members
  }, [members, query])

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: 0, marginBottom: '5px' }}>Rota Members</h2>
        <p style={{ color: '#666', margin: 0 }}>
          Everyone currently active on the rota. If you're asking someone to cover your shift, check they're listed here.
        </p>
      </div>

      {error ? (
        <div style={{ backgroundColor: '#fdecea', color: '#8B0000', padding: '12px 16px', borderRadius: '8px' }}>
          {error}
        </div>
      ) : (
        <>
          <input
            type="search"
            aria-label="Search members"
            placeholder="Search by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              maxWidth: '360px',
              padding: '8px 12px',
              marginBottom: '16px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                {members.length === 0 ? 'No active rota members yet.' : 'No members match your search.'}
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {filtered.map((m, i) => (
                  <li
                    key={`${m.display_name}-${i}`}
                    style={{ padding: '12px 16px', borderBottom: '1px solid #dee2e6', fontSize: '14px' }}
                  >
                    {m.display_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '8px' }}>
            {members.length} active member{members.length === 1 ? '' : 's'}
          </p>
        </>
      )}
    </div>
  )
}

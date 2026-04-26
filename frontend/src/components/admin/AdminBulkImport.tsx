import { useState } from 'react'
import { bulkImportUsers, BulkImportUser } from '../../lib/auth'
import type { BulkImportResult } from '../../types/BulkImportResult'
import { usePageTitle } from '../../hooks/usePageTitle'

interface ParsedEntry {
  email: string
  display_name?: string
}

function parseEmailInput(text: string): ParsedEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const entries: ParsedEntry[] = []

  for (const line of lines) {
    // Format: "Name <email>"
    const angleMatch = line.match(/^(.+?)\s*<([^>]+@[^>]+)>$/)
    if (angleMatch) {
      entries.push({ email: angleMatch[2].trim(), display_name: angleMatch[1].trim() })
      continue
    }

    // Format: "email, name" or "email,name"
    const commaMatch = line.match(/^([^,]+@[^,]+),\s*(.+)$/)
    if (commaMatch) {
      entries.push({ email: commaMatch[1].trim(), display_name: commaMatch[2].trim() })
      continue
    }

    // Format: plain email
    if (line.includes('@')) {
      entries.push({ email: line })
    }
  }

  return entries
}

function parseCSV(text: string): ParsedEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  // Skip header if it looks like one
  const firstLine = lines[0].toLowerCase()
  const startIdx = (firstLine.includes('email') || firstLine.includes('name')) ? 1 : 0

  const entries: ParsedEntry[] = []
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim().replace(/^"|"$/g, ''))
    if (parts.length >= 1 && parts[0].includes('@')) {
      entries.push({
        email: parts[0],
        display_name: parts.length >= 2 && parts[1] ? parts[1] : undefined,
      })
    }
  }
  return entries
}

export default function AdminBulkImport() {
  const [inputText, setInputText] = useState('')
  const [parsedEntries, setParsedEntries] = useState<ParsedEntry[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<BulkImportResult | null>(null)
  usePageTitle('Import Users')

  const handleParse = () => {
    const entries = parseEmailInput(inputText)
    setParsedEntries(entries)
    setShowPreview(true)
    setResult(null)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const text = await file.text()
    const entries = parseCSV(text)
    setParsedEntries(entries)
    setShowPreview(true)
    setResult(null)
    e.target.value = ''
  }

  const handleImport = async () => {
    if (parsedEntries.length === 0) return

    setImporting(true)
    try {
      const users: BulkImportUser[] = parsedEntries.map(e => ({
        email: e.email,
        display_name: e.display_name,
      }))
      const importResult = await bulkImportUsers(users)
      setResult(importResult)
    } catch (err) {
      console.error('Bulk import failed:', err)
      alert(err instanceof Error ? err.message : 'Failed to import users')
    } finally {
      setImporting(false)
    }
  }

  const handleReset = () => {
    setInputText('')
    setParsedEntries([])
    setShowPreview(false)
    setResult(null)
  }

  return (
    <div>
      <h1 style={{ marginBottom: '10px' }}>Bulk Import Users</h1>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Import users by email. They can log in later via magic link. No emails are sent during import.
      </p>

      {!result && (
        <>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <h3 style={{ marginTop: 0, marginBottom: '10px' }}>Paste Emails</h3>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '10px' }}>
              One per line. Supported formats: <code>email@example.com</code>, <code>email, Name</code>, <code>Name &lt;email&gt;</code>
            </p>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={"alice@example.com\nbob@example.com, Bob Smith\nCharlie <charlie@example.com>"}
              rows={8}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '14px',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', alignItems: 'center' }}>
              <button
                onClick={handleParse}
                disabled={!inputText.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: inputText.trim() ? '#8B0000' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: inputText.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Preview
              </button>
              <span style={{ color: '#999' }}>or</span>
              <label style={{
                padding: '8px 16px',
                backgroundColor: '#6c757d',
                color: 'white',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'inline-block',
              }}>
                Upload CSV
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          </div>

          {showPreview && parsedEntries.length > 0 && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              padding: '20px',
              marginBottom: '20px',
            }}>
              <h3 style={{ marginTop: 0 }}>Preview ({parsedEntries.length} users)</h3>
              <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '15px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #dee2e6' }}>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Email</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedEntries.map((entry, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '13px' }}>{entry.email}</td>
                        <td style={{ padding: '8px', color: entry.display_name ? '#333' : '#999' }}>
                          {entry.display_name || '(none)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: importing ? '#ccc' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: importing ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {importing ? 'Importing...' : `Import ${parsedEntries.length} Users`}
                </button>
                <button
                  onClick={handleReset}
                  disabled={importing}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showPreview && parsedEntries.length === 0 && (
            <div style={{
              backgroundColor: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '4px',
              padding: '15px',
              color: '#856404',
            }}>
              No valid email addresses found. Check your input format.
            </div>
          )}
        </>
      )}

      {result && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: '20px',
        }}>
          <h3 style={{ marginTop: 0 }}>Import Results</h3>

          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
            <div style={{
              padding: '15px 20px',
              backgroundColor: '#d4edda',
              borderRadius: '8px',
              textAlign: 'center',
              flex: 1,
            }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#155724' }}>{result.created}</div>
              <div style={{ color: '#155724', fontSize: '14px' }}>Created</div>
            </div>
            <div style={{
              padding: '15px 20px',
              backgroundColor: '#fff3cd',
              borderRadius: '8px',
              textAlign: 'center',
              flex: 1,
            }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#856404' }}>{result.skipped}</div>
              <div style={{ color: '#856404', fontSize: '14px' }}>Skipped</div>
            </div>
            <div style={{
              padding: '15px 20px',
              backgroundColor: result.errors.length > 0 ? '#f8d7da' : '#e2e3e5',
              borderRadius: '8px',
              textAlign: 'center',
              flex: 1,
            }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: result.errors.length > 0 ? '#721c24' : '#383d41' }}>{result.errors.length}</div>
              <div style={{ color: result.errors.length > 0 ? '#721c24' : '#383d41', fontSize: '14px' }}>Errors</div>
            </div>
          </div>

          {result.details.length > 0 && (
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '15px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #dee2e6' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Email</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {result.details.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '13px' }}>{d.email}</td>
                      <td style={{ padding: '8px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'white',
                          backgroundColor: d.status === 'created' ? '#28a745' : d.status === 'skipped' ? '#ffc107' : '#dc3545',
                        }}>
                          {d.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: '#666', fontSize: '13px' }}>{d.message || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={handleReset}
            style={{
              padding: '10px 24px',
              backgroundColor: '#8B0000',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Import More
          </button>
        </div>
      )}
    </div>
  )
}

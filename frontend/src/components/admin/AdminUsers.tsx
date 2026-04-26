import { useEffect, useState, useRef } from 'react'
import { getAllUsers, promoteUser, demoteUser, deleteUser, markCoC, markInduction, markSupervisedShift, adminUploadCertificate, adminSetEmail, getUserId } from '../../lib/auth'
import type { UserListItem } from '../../types/UserListItem'
import { usePageTitle } from '../../hooks/usePageTitle'
import ContractModal from './ContractModal'

function ActionsDropdown({ user, currentUserId, isLastAdmin, actionInProgress, onAction }: {
  user: UserListItem
  currentUserId: string | null
  isLastAdmin: boolean
  actionInProgress: string | null
  onAction: (action: string, userId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const disabled = actionInProgress === user.id

  const items: { label: string; action: string; show: boolean; color?: string; disabledReason?: string }[] = [
    { label: 'Promote', action: 'promote', show: !user.is_admin },
    { label: 'Demote', action: 'demote', show: user.is_admin || user.is_committee, disabledReason: isLastAdmin ? 'Last admin' : undefined },
    { label: 'Mark CoC Signed', action: 'mark-coc', show: !user.code_of_conduct_signed },
    { label: 'Mark Inducted', action: 'mark-induction', show: !user.induction_completed },
    { label: 'Mark Supervised Shift', action: 'mark-supervised', show: !user.supervised_shift_completed },
    { label: 'Upload Certificate', action: 'upload-cert', show: true },
    { label: 'Set Email', action: 'set-email', show: true },
    { label: 'Manage Contract', action: 'manage-contract', show: true },
    { label: 'Delete', action: 'delete', show: user.id !== currentUserId, color: '#dc3545', disabledReason: isLastAdmin ? 'Last admin' : undefined },
  ]

  const visibleItems = items.filter(i => i.show)

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        style={{
          padding: '6px 14px',
          backgroundColor: disabled ? '#ccc' : '#6c757d',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '13px',
        }}
      >
        Actions ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: '100%',
          marginTop: '4px',
          backgroundColor: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 100,
          minWidth: '180px',
          overflow: 'hidden',
        }}>
          {visibleItems.map((item, i) => (
            <button
              key={item.action}
              onClick={() => {
                setOpen(false)
                onAction(item.action, user.id)
              }}
              disabled={!!item.disabledReason}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                border: 'none',
                borderBottom: i < visibleItems.length - 1 ? '1px solid #f0f0f0' : 'none',
                backgroundColor: 'white',
                color: item.disabledReason ? '#aaa' : (item.color || '#333'),
                textAlign: 'left',
                cursor: item.disabledReason ? 'not-allowed' : 'pointer',
                fontSize: '13px',
              }}
              title={item.disabledReason || ''}
              onMouseEnter={(e) => {
                if (!item.disabledReason) e.currentTarget.style.backgroundColor = '#f8f9fa'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white'
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [contractModal, setContractModal] = useState<{ userId: string; userName: string } | null>(null)
  const currentUserId = getUserId()
  usePageTitle('Admin')

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      const fetchedUsers = await getAllUsers()
      setUsers(fetchedUsers)
    } catch (err) {
      console.error('Failed to load users:', err)
      alert('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const adminCount = users.filter(u => u.is_admin).length

  const handleAction = async (action: string, userId: string) => {
    const user = users.find(u => u.id === userId)
    if (!user) return
    const last = user.is_admin && adminCount <= 1

    switch (action) {
      case 'promote': {
        if (!confirm('Promote this user?')) return
        setActionInProgress(userId)
        try {
          await promoteUser(userId)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to promote user')
        } finally {
          setActionInProgress(null)
        }
        break
      }
      case 'demote': {
        if (last) { alert('Cannot demote the last admin'); return }
        if (!confirm('Demote this user?')) return
        setActionInProgress(userId)
        try {
          await demoteUser(userId)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to demote user')
        } finally {
          setActionInProgress(null)
        }
        break
      }
      case 'mark-coc': {
        if (!confirm('Mark code of conduct as signed for this user?')) return
        setActionInProgress(userId)
        try {
          await markCoC(userId)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to mark CoC signed')
        } finally {
          setActionInProgress(null)
        }
        break
      }
      case 'mark-induction': {
        if (!confirm('Mark induction as complete for this user?')) return
        setActionInProgress(userId)
        try {
          await markInduction(userId)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to mark induction complete')
        } finally {
          setActionInProgress(null)
        }
        break
      }
      case 'mark-supervised': {
        if (!confirm('Mark supervised shift as complete for this user?')) return
        setActionInProgress(userId)
        try {
          await markSupervisedShift(userId)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to mark supervised shift complete')
        } finally {
          setActionInProgress(null)
        }
        break
      }
      case 'upload-cert': {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*,application/pdf'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return
          if (file.size > 5 * 1024 * 1024) { alert('File must be under 5 MB'); return }
          setActionInProgress(userId)
          try {
            await adminUploadCertificate(userId, file)
            alert('Certificate uploaded and approved')
            await loadUsers()
          } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to upload certificate')
          } finally {
            setActionInProgress(null)
          }
        }
        input.click()
        break
      }
      case 'set-email': {
        const email = prompt('Enter new email for ' + (user.display_name || 'this user') + ':', user.email || '')
        if (!email) return
        setActionInProgress(userId)
        try {
          await adminSetEmail(userId, email)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to set email')
        } finally {
          setActionInProgress(null)
        }
        break
      }
      case 'manage-contract': {
        setContractModal({ userId, userName: user.display_name || 'Unknown' })
        break
      }
      case 'delete': {
        if (userId === currentUserId) { alert('Cannot delete yourself'); return }
        if (last) { alert('Cannot delete the last admin'); return }
        if (!confirm('Delete this user? This cannot be undone.')) return
        setActionInProgress(userId)
        try {
          await deleteUser(userId)
          await loadUsers()
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Failed to delete user')
        } finally {
          setActionInProgress(null)
        }
        break
      }
    }
  }

  const getRoleBadge = (user: UserListItem) => {
    if (user.is_admin) {
      return (
        <span style={{
          backgroundColor: '#dc3545',
          color: 'white',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
        }}>
          Admin
        </span>
      )
    }
    if (user.is_committee) {
      return (
        <span style={{
          backgroundColor: '#0d6efd',
          color: 'white',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 600,
        }}>
          Committee
        </span>
      )
    }
    return (
      <span style={{
        backgroundColor: '#6c757d',
        color: 'white',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 600,
      }}>
        User
      </span>
    )
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading users...</div>
  }

  const isLastAdmin = (user: UserListItem) => user.is_admin && adminCount <= 1

  return (
    <div>
      <h1 style={{ marginBottom: '20px' }}>User Management</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Manage user roles. Admins can promote/demote users and access the admin panel.
        Committee members can access the committee panel.
      </p>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'visible',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>User</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Role</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Joined</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                style={{
                  borderBottom: '1px solid #dee2e6',
                  backgroundColor: user.id === currentUserId ? '#f8f9fa' : 'white',
                }}
              >
                <td style={{ padding: '12px 16px' }}>
                  <div>
                    <strong>{user.display_name || 'Unknown'}</strong>
                    {user.id === currentUserId && (
                      <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>(you)</span>
                    )}
                  </div>
                  <div style={{ color: '#666', fontSize: '12px' }}>{user.id}</div>
                  {user.email && <div style={{ color: '#888', fontSize: '12px' }}>{user.email}</div>}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {getRoleBadge(user)}
                </td>
                <td style={{ padding: '12px 16px', color: '#666' }}>
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <ActionsDropdown
                    user={user}
                    currentUserId={currentUserId}
                    isLastAdmin={isLastAdmin(user)}
                    actionInProgress={actionInProgress}
                    onAction={handleAction}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '20px', color: '#666', fontSize: '14px' }}>
        Total: {users.length} users ({adminCount} admins, {users.filter(u => u.is_committee && !u.is_admin).length} committee, {users.filter(u => !u.is_committee && !u.is_admin).length} regular)
      </div>

      <ContractModal
        userId={contractModal?.userId ?? ''}
        userName={contractModal?.userName ?? ''}
        open={contractModal !== null}
        onOpenChange={(open) => {
          if (!open) setContractModal(null)
        }}
        onSaved={() => {
          setContractModal(null)
          loadUsers()
        }}
      />
    </div>
  )
}

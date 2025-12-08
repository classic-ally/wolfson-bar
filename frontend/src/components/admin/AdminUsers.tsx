import { useEffect, useState } from 'react'
import { getAllUsers, promoteUser, demoteUser, deleteUser, UserListItem, getUserId } from '../../lib/auth'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function AdminUsers() {
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
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

  const handlePromote = async (userId: string) => {
    if (!confirm('Are you sure you want to promote this user?')) return

    setActionInProgress(userId)
    try {
      await promoteUser(userId)
      await loadUsers()
    } catch (err) {
      console.error('Failed to promote user:', err)
      alert(err instanceof Error ? err.message : 'Failed to promote user')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleDemote = async (userId: string, isLastAdmin: boolean) => {
    if (isLastAdmin) {
      alert('Cannot demote the last admin')
      return
    }

    if (!confirm('Are you sure you want to demote this user?')) return

    setActionInProgress(userId)
    try {
      await demoteUser(userId)
      await loadUsers()
    } catch (err) {
      console.error('Failed to demote user:', err)
      alert(err instanceof Error ? err.message : 'Failed to demote user')
    } finally {
      setActionInProgress(null)
    }
  }

  const handleDelete = async (userId: string, isLastAdmin: boolean) => {
    if (userId === currentUserId) {
      alert('Cannot delete yourself')
      return
    }

    if (isLastAdmin) {
      alert('Cannot delete the last admin')
      return
    }

    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return

    setActionInProgress(userId)
    try {
      await deleteUser(userId)
      await loadUsers()
    } catch (err) {
      console.error('Failed to delete user:', err)
      alert(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setActionInProgress(null)
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

  const adminCount = users.filter(u => u.is_admin).length
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
        overflow: 'hidden',
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
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {getRoleBadge(user)}
                </td>
                <td style={{ padding: '12px 16px', color: '#666' }}>
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    {!user.is_admin && (
                      <button
                        onClick={() => handlePromote(user.id)}
                        disabled={actionInProgress === user.id}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: actionInProgress === user.id ? 'not-allowed' : 'pointer',
                          opacity: actionInProgress === user.id ? 0.7 : 1,
                        }}
                      >
                        Promote
                      </button>
                    )}
                    {(user.is_admin || user.is_committee) && (
                      <button
                        onClick={() => handleDemote(user.id, isLastAdmin(user))}
                        disabled={actionInProgress === user.id || isLastAdmin(user)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#ffc107',
                          color: '#000',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: actionInProgress === user.id || isLastAdmin(user) ? 'not-allowed' : 'pointer',
                          opacity: actionInProgress === user.id || isLastAdmin(user) ? 0.7 : 1,
                        }}
                        title={isLastAdmin(user) ? 'Cannot demote the last admin' : ''}
                      >
                        Demote
                      </button>
                    )}
                    {user.id !== currentUserId && (
                      <button
                        onClick={() => handleDelete(user.id, isLastAdmin(user))}
                        disabled={actionInProgress === user.id || isLastAdmin(user)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: actionInProgress === user.id || isLastAdmin(user) ? 'not-allowed' : 'pointer',
                          opacity: actionInProgress === user.id || isLastAdmin(user) ? 0.7 : 1,
                        }}
                        title={isLastAdmin(user) ? 'Cannot delete the last admin' : ''}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '20px', color: '#666', fontSize: '14px' }}>
        Total: {users.length} users ({adminCount} admins, {users.filter(u => u.is_committee && !u.is_admin).length} committee, {users.filter(u => !u.is_committee && !u.is_admin).length} regular)
      </div>
    </div>
  )
}

import type { Meta, StoryObj } from '@storybook/react-vite'
import { DataTable, type ColumnDef } from './DataTable'
import { Badge } from './badge'
import { Button } from './button'

interface User {
  id: string
  display_name: string
  email: string | null
  role: 'admin' | 'committee' | 'member'
  joined: string
}

const fixtureUsers: User[] = [
  { id: '1', display_name: 'Allison Bentley', email: 'allison@example.com', role: 'admin', joined: '2025-01-12' },
  { id: '2', display_name: 'Charlie Pickering', email: 'charlie@example.com', role: 'committee', joined: '2025-02-03' },
  { id: '3', display_name: 'Dani Lee', email: null, role: 'member', joined: '2026-03-22' },
  { id: '4', display_name: 'Eve Mason', email: 'eve@example.com', role: 'member', joined: '2026-04-08' },
  { id: '5', display_name: 'Finn Park', email: 'finn@example.com', role: 'committee', joined: '2026-04-21' },
]

const baseColumns: ColumnDef<User>[] = [
  { key: 'name', header: 'Name', cell: (u) => u.display_name },
  { key: 'email', header: 'Email', cell: (u) => u.email ?? <span className="text-muted-foreground">—</span> },
  {
    key: 'role',
    header: 'Role',
    cell: (u) => {
      const variant =
        u.role === 'admin' ? 'destructive' : u.role === 'committee' ? 'default' : 'secondary'
      return <Badge variant={variant}>{u.role[0].toUpperCase() + u.role.slice(1)}</Badge>
    },
  },
  { key: 'joined', header: 'Joined', cell: (u) => u.joined },
]

const meta = {
  title: 'UI/DataTable',
  component: DataTable<User>,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DataTable<User>>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={fixtureUsers}
      rowKey={(u) => u.id}
    />
  ),
  args: {
    columns: baseColumns,
    data: fixtureUsers,
    rowKey: (u: User) => u.id,
  },
}

export const WithRowActions: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={fixtureUsers}
      rowKey={(u) => u.id}
      rowActions={(u) => (
        <Button size="sm" variant="outline" onClick={() => alert(`Edit ${u.display_name}`)}>
          Edit
        </Button>
      )}
    />
  ),
  args: {
    columns: baseColumns,
    data: fixtureUsers,
    rowKey: (u: User) => u.id,
  },
}

export const WithMultiButtonActions: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={fixtureUsers}
      rowKey={(u) => u.id}
      rowActions={(u) => (
        <>
          <Button size="sm" variant="outline" onClick={() => alert(`View ${u.display_name}`)}>
            View
          </Button>
          <Button size="sm" onClick={() => alert(`Approve ${u.display_name}`)}>
            Approve
          </Button>
        </>
      )}
    />
  ),
  args: {
    columns: baseColumns,
    data: fixtureUsers,
    rowKey: (u: User) => u.id,
  },
}

export const Loading: Story = {
  render: () => (
    <DataTable columns={baseColumns} data={[]} rowKey={(u) => u.id} isLoading />
  ),
  args: {
    columns: baseColumns,
    data: [],
    rowKey: (u: User) => u.id,
    isLoading: true,
  },
}

export const Empty: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={[]}
      rowKey={(u) => u.id}
      emptyMessage="No users yet — invite someone to get started."
    />
  ),
  args: {
    columns: baseColumns,
    data: [],
    rowKey: (u: User) => u.id,
  },
}

export const WithRowClassName: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={fixtureUsers}
      rowKey={(u) => u.id}
      rowClassName={(u) => (u.role === 'admin' ? 'bg-destructive/5' : '')}
    />
  ),
  args: {
    columns: baseColumns,
    data: fixtureUsers,
    rowKey: (u: User) => u.id,
  },
}

export const MobilePortrait: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={fixtureUsers}
      rowKey={(u) => u.id}
      rowActions={(u) => (
        <Button size="sm" variant="outline" onClick={() => alert(`Edit ${u.display_name}`)}>
          Edit
        </Button>
      )}
    />
  ),
  globals: { viewport: { value: 'iphone14', isRotated: false } },
  args: {
    columns: baseColumns,
    data: fixtureUsers,
    rowKey: (u: User) => u.id,
  },
}

export const Tablet: Story = {
  render: () => (
    <DataTable
      columns={baseColumns}
      data={fixtureUsers}
      rowKey={(u) => u.id}
      rowActions={(u) => (
        <Button size="sm" variant="outline" onClick={() => alert(`Edit ${u.display_name}`)}>
          Edit
        </Button>
      )}
    />
  ),
  globals: { viewport: { value: 'ipad', isRotated: false } },
  args: {
    columns: baseColumns,
    data: fixtureUsers,
    rowKey: (u: User) => u.id,
  },
}

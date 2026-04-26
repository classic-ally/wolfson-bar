import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import ContractModal from './ContractModal'
import { Button } from '@/components/ui/button'

// Network calls (adminSetContract / adminClearContract) hit /api/admin/...
// In storybook those won't resolve; clicks log to the action panel via
// alerts in the underlying component. Stories focus on visual + interaction.
const meta = {
  title: 'Admin/ContractModal',
  component: ContractModal,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ContractModal>

export default meta
type Story = StoryObj<typeof meta>

function TriggerWrapper() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Contract Modal</Button>
      <ContractModal
        userId="story-user-123"
        userName="Allison Bentley"
        open={open}
        onOpenChange={setOpen}
        onSaved={() => setOpen(false)}
      />
    </>
  )
}

export const ClickToOpen: Story = {
  render: () => <TriggerWrapper />,
  args: {
    userId: 'story-user-123',
    userName: 'Allison Bentley',
    open: false,
    onOpenChange: () => {},
    onSaved: () => {},
  },
}

export const OpenByDefault: Story = {
  args: {
    userId: 'story-user-123',
    userName: 'Allison Bentley',
    open: true,
    onOpenChange: () => {},
    onSaved: () => {},
  },
}

export const UnknownUser: Story = {
  args: {
    userId: 'story-user-anon',
    userName: '',
    open: true,
    onOpenChange: () => {},
    onSaved: () => {},
  },
}

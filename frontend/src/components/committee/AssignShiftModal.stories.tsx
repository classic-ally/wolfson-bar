import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import AssignShiftModal from './AssignShiftModal'
import { Button } from '@/components/ui/button'
import { defaultHandlers } from '@/test/handlers'

const meta = {
  title: 'Committee/AssignShiftModal',
  component: AssignShiftModal,
  parameters: {
    layout: 'fullscreen',
    msw: { handlers: defaultHandlers },
  },
} satisfies Meta<typeof AssignShiftModal>

export default meta
type Story = StoryObj<typeof meta>

const fromDate = new Date('2026-05-01')
const toDate = new Date('2026-05-31')

function Wrapper({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="p-8 space-y-2">
      <Button onClick={() => setOpen(true)}>Open Assign Modal</Button>
      <AssignShiftModal
        open={open}
        onOpenChange={setOpen}
        userId="u-allison"
        userDisplayName="Allison Bentley"
        fromDate={fromDate}
        toDate={toDate}
        onAssigned={() => {
          alert('Assigned (mocked)')
          setOpen(false)
        }}
      />
    </div>
  )
}

export const Default: Story = {
  render: () => <Wrapper startOpen />,
  args: {
    open: true,
    onOpenChange: () => {},
    userId: 'u-allison',
    userDisplayName: 'Allison Bentley',
    fromDate,
    toDate,
    onAssigned: () => {},
  },
}

export const ClickToOpen: Story = {
  render: () => <Wrapper startOpen={false} />,
  args: {
    open: false,
    onOpenChange: () => {},
    userId: 'u-allison',
    userDisplayName: 'Allison Bentley',
    fromDate,
    toDate,
    onAssigned: () => {},
  },
}

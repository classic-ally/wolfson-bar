import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import RegisterModal from './RegisterModal'
import { Button } from '@/components/ui/button'

const meta = {
  title: 'Auth/RegisterModal',
  component: RegisterModal,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RegisterModal>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="p-8 space-y-2">
      <Button onClick={() => setOpen(true)}>Open Register</Button>
      <RegisterModal
        open={open}
        onOpenChange={setOpen}
        onRegistered={() => alert('Registered!')}
      />
    </div>
  )
}

export const Default: Story = {
  render: () => <Wrapper startOpen />,
  args: {
    open: true,
    onOpenChange: () => {},
    onRegistered: () => {},
  },
}

export const ClickToOpen: Story = {
  render: () => <Wrapper startOpen={false} />,
  args: {
    open: false,
    onOpenChange: () => {},
    onRegistered: () => {},
  },
}

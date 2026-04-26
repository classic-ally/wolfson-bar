import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import SignInModal from './SignInModal'
import { Button } from '@/components/ui/button'

// Real auth fns (loginWithPasskey, requestMagicLink) hit the API and the
// browser passkey UI. In storybook those won't resolve cleanly — clicking
// emits an alert via the underlying error handling. Stories cover layout
// and state transitions only.
const meta = {
  title: 'Auth/SignInModal',
  component: SignInModal,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SignInModal>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="p-8 space-y-2">
      <Button onClick={() => setOpen(true)}>Open Sign In</Button>
      <SignInModal
        open={open}
        onOpenChange={setOpen}
        onSignedIn={() => alert('Signed in!')}
      />
    </div>
  )
}

export const Default: Story = {
  render: () => <Wrapper startOpen />,
  args: {
    open: true,
    onOpenChange: () => {},
    onSignedIn: () => {},
  },
}

export const ClickToOpen: Story = {
  render: () => <Wrapper startOpen={false} />,
  args: {
    open: false,
    onOpenChange: () => {},
    onSignedIn: () => {},
  },
}

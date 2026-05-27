import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import CodeOfConduct from './CodeOfConduct'
import { Button } from '@/components/ui/button'

const meta = {
  title: 'Onboarding/CodeOfConduct',
  component: CodeOfConduct,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    onOpenChange: () => {},
  },
} satisfies Meta<typeof CodeOfConduct>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper({ readOnly = false, startOpen = true }: { readOnly?: boolean; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="p-8 space-y-2">
      <Button onClick={() => setOpen(true)}>Open Code of Conduct</Button>
      <CodeOfConduct
        open={open}
        onOpenChange={setOpen}
        readOnly={readOnly}
        onAccept={() => {
          alert('Accepted')
          setOpen(false)
        }}
        onDecline={() => {
          alert('Declined')
          setOpen(false)
        }}
      />
    </div>
  )
}

export const AcceptFlow: Story = {
  render: () => <Wrapper />,
}

export const ReadOnly: Story = {
  render: () => <Wrapper readOnly />,
}

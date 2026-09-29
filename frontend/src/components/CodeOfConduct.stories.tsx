import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import CodeOfConduct from './CodeOfConduct'
import { Button } from '@/components/ui/button'
import { http, HttpResponse } from 'msw'
import { cocHandlers } from '@/test/handlers'

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
        onAccept={() => setOpen(false)}
        onDecline={() => setOpen(false)}
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

/** A newer version was published while this one was open: accept returns 409. */
export const StaleVersion: Story = {
  render: () => <Wrapper />,
  parameters: {
    msw: {
      handlers: [
        http.post('*/api/users/me/accept-coc', () =>
          HttpResponse.json(
            { error: 'The Code of Conduct has been updated — please re-read it' },
            { status: 409 },
          ),
        ),
        ...cocHandlers,
      ],
    },
  },
}

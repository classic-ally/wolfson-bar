import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import CommitteeKioskPair from './CommitteeKioskPair'

// The approve screen reads ?code from the URL, so render under a router.
const withCode = (code: string): Decorator => (Story) => (
  <MemoryRouter initialEntries={[`/committee/kiosk/pair?code=${code}`]}>
    <Story />
  </MemoryRouter>
)

const meta = {
  title: 'Committee/CommitteeKioskPair',
  component: CommitteeKioskPair,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CommitteeKioskPair>

export default meta
type Story = StoryObj<typeof meta>

export const Approve: Story = {
  decorators: [withCode('pair-code-1')],
  parameters: {
    msw: {
      handlers: [
        http.post('*/api/kiosk/pair/approve', () => new HttpResponse(null, { status: 200 })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nameField = canvas.getByLabelText(/Device name/)
    expect(nameField).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /Approve kiosk/ }))
    await waitFor(() => {
      expect(canvas.getByText(/Kiosk enrolled/)).toBeInTheDocument()
    })
  },
}

// Reached without a pairing code → clear guidance instead of a dead form.
export const MissingCode: Story = {
  decorators: [withCode('')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/No pairing code/)).toBeInTheDocument()
  },
}

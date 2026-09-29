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

const pairingInfo = (activeDevices: number) =>
  http.get('*/api/kiosk/pair/info', () =>
    HttpResponse.json({
      status: 'pending',
      created_at: '2026-06-19 19:02:11',
      expires_at: '2026-06-19 19:12:11',
      client_ip: '203.0.113.7',
      user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
      active_devices: activeDevices,
    }),
  )

export const Approve: Story = {
  decorators: [withCode('pair-code-1')],
  parameters: {
    msw: {
      handlers: [
        pairingInfo(0),
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

// A kiosk is already enrolled → the approver sees where the request came from
// and that approving will take the current kiosk offline.
export const ReplacesExistingKiosk: Story = {
  decorators: [withCode('pair-code-2')],
  parameters: { msw: { handlers: [pairingInfo(1)] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('203.0.113.7')).toBeInTheDocument()
    expect(canvas.getByRole('alert')).toHaveTextContent(/replaces the current kiosk/)
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

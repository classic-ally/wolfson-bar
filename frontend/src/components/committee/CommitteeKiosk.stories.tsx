import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import CommitteeKiosk from './CommitteeKiosk'

const meta = {
  title: 'Committee/CommitteeKiosk',
  component: CommitteeKiosk,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CommitteeKiosk>

export default meta
type Story = StoryObj<typeof meta>

const device = {
  id: 'dev-1',
  name: 'Bar till PC',
  last_seen_at: '2026-06-14 20:00:00',
  revoked: false,
}

// Dashboard lists the enrolled device and shows the bar as open.
export const WithDevice: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/kiosk/devices', () => HttpResponse.json([device])),
        http.get('*/api/bar-status', () => HttpResponse.json({ is_open: true, opened_at: null })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Bar till PC')).toBeInTheDocument()
    // bar-status fetch resolves after the devices fetch — wait for it.
    await waitFor(() => expect(canvas.getByTestId('bar-status')).toHaveTextContent('Open'))
    expect(await canvas.findByRole('button', { name: /Close bar/ })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: /Revoke/ })).toBeInTheDocument()
  },
}

// Clicking Revoke posts to the revoke endpoint; the row then reads "Revoked".
export const RevokeDevice: Story = {
  parameters: {
    msw: {
      handlers: [
        (() => {
          let revoked = false
          return [
            http.get('*/api/kiosk/devices', () =>
              HttpResponse.json([{ ...device, revoked }]),
            ),
            http.get('*/api/bar-status', () =>
              HttpResponse.json({ is_open: false, opened_at: null }),
            ),
            http.post('*/api/kiosk/devices/:id/revoke', () => {
              revoked = true
              return new HttpResponse(null, { status: 200 })
            }),
          ]
        })(),
      ].flat(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const revokeBtn = await canvas.findByRole('button', { name: /Revoke/ })
    await userEvent.click(revokeBtn)
    await waitFor(() => {
      expect(canvas.getByText('Revoked')).toBeInTheDocument()
    })
  },
}

export const NoDevices: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/kiosk/devices', () => HttpResponse.json([])),
        http.get('*/api/bar-status', () => HttpResponse.json({ is_open: false, opened_at: null })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/No devices enrolled/)).toBeInTheDocument()
  },
}

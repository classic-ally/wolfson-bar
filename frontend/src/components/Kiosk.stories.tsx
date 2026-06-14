import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import Kiosk from './Kiosk'

// Set/clear the device token before the component mounts, so the boot effect
// sees the intended enrolment state.
const withKioskToken = (token: string | null): Decorator => (Story) => {
  if (token) localStorage.setItem('kiosk_token', token)
  else localStorage.removeItem('kiosk_token')
  return <Story />
}

const meta = {
  title: 'Kiosk/Kiosk',
  component: Kiosk,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Kiosk>

export default meta
type Story = StoryObj<typeof meta>

// No token yet → the device shows a pairing QR for a committee phone to scan.
export const Unenrolled: Story = {
  decorators: [withKioskToken(null)],
  parameters: {
    msw: {
      handlers: [
        http.post('*/api/kiosk/pair/start', () => HttpResponse.json({ code: 'pair-code-1' })),
        http.get('*/api/kiosk/pair/status', () => HttpResponse.json({ status: 'pending' })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const qr = await canvas.findByTestId('pairing-qr')
    expect(qr).toBeInTheDocument()
    expect(qr.getAttribute('src')).toMatch(/^data:image/)
  },
}

// Enrolled device → it polls and renders the rotating check-in QR.
export const Enrolled: Story = {
  decorators: [withKioskToken('dev-device-token')],
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/kiosk/checkin-code', () =>
          HttpResponse.json({
            code: 'ABCD1234',
            url: 'http://localhost/checkin?code=ABCD1234',
            period_seconds: 30,
          }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const qr = await canvas.findByTestId('checkin-qr')
    expect(qr).toBeInTheDocument()
    expect(qr.getAttribute('src')).toMatch(/^data:image/)
  },
}

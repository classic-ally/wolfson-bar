import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import CheckInPage from './CheckInPage'

// The page reads ?code from the URL, so render under a router.
const atCode = (code: string): Decorator => (Story) => (
  <MemoryRouter initialEntries={[`/checkin?code=${code}`]}>
    <Story />
  </MemoryRouter>
)

// preview.ts signs every story in; this one needs a signed-out visitor.
const signedOut: Decorator = (Story) => {
  localStorage.removeItem('auth_token')
  return <Story />
}

const meta = {
  title: 'Kiosk/CheckInPage',
  component: CheckInPage,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CheckInPage>

export default meta
type Story = StoryObj<typeof meta>

export const CheckedIn: Story = {
  decorators: [atCode('ABCD1234')],
  parameters: {
    msw: {
      handlers: [
        http.post('*/api/shifts/check-in', () =>
          HttpResponse.json({ shift_date: '2026-06-19', was_signed_up: true, bar_open: true }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/checked in/)).toBeInTheDocument()
    expect(canvas.getByText(/bar is marked open/)).toBeInTheDocument()
  },
}

// Returning from sign-in usually means the 30s code has rotated.
export const CodeExpired: Story = {
  decorators: [atCode('STALE000')],
  parameters: {
    msw: {
      handlers: [
        http.post('*/api/shifts/check-in', () =>
          HttpResponse.json({ error: 'Invalid or expired code' }, { status: 400 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('Code expired')).toBeInTheDocument()
  },
}

// Signed-out visitors can use a passkey or an email link, and come back here afterwards.
export const SignedOut: Story = {
  decorators: [atCode('ABCD1234'), signedOut],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('return_to') ?? '{}').path).toBe('/checkin?code=ABCD1234')
  },
}

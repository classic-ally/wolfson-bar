import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import UserInduction from './UserInduction'
import type { UserStatus } from '@/types/UserStatus'
import type { InductionDate } from '@/types/InductionDate'

function makeUser(overrides: Partial<UserStatus> = {}): UserStatus {
  return {
    user_id: 'u-agrima',
    display_name: 'Agrima',
    is_committee: false,
    code_of_conduct_signed: false,
    food_safety_completed: false,
    has_food_safety_certificate: false,
    induction_completed: false,
    has_contract: false,
    contract_expiry_date: null,
    email: 'agrima@example.com',
    email_notifications_enabled: false,
    privacy_consent_given: true,
    has_passkey: false,
    supervised_shift_completed: false,
    ...overrides,
  }
}

function makeDate(overrides: Partial<InductionDate> = {}): InductionDate {
  return {
    date: '2026-05-15',
    has_full_shift_committee: false,
    slots_remaining: 3,
    user_signed_up: false,
    user_signed_up_full_shift: false,
    inductees: [],
    ...overrides,
  }
}

function statusHandler(user: UserStatus) {
  return http.get('*/api/users/me', () => HttpResponse.json(user))
}

function datesHandler(dates: InductionDate[]) {
  return http.get('*/api/induction-dates', () => HttpResponse.json(dates))
}

// Returns a fake JWT-shaped token. The frontend QR encodes it as-is; nothing
// in the UI parses it, so any string with the "induction:" prefix works.
const tokenHandler = http.get('*/api/users/me/verification-token', () =>
  HttpResponse.json({
    token: 'induction:eyJhbGciOiJIUzI1NiJ9.STORYBOOK_FAKE_TOKEN.signature',
  })
)

const meta = {
  title: 'Onboarding/UserInduction',
  component: UserInduction,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof UserInduction>

export default meta
type Story = StoryObj<typeof meta>

// New member who has signed up for an induction date — primary case where the
// QR fallback button should be visible.
export const SignedUpForInduction: Story = {
  parameters: {
    msw: {
      handlers: [
        statusHandler(makeUser()),
        datesHandler([
          makeDate({ date: '2026-05-15', user_signed_up: true, slots_remaining: 2 }),
          makeDate({ date: '2026-05-22' }),
        ]),
        tokenHandler,
      ],
    },
  },
}

// Same member, but the verification-token endpoint fails — exercises the
// alert path so you can confirm the error handling is wired up.
export const QRTokenFailure: Story = {
  parameters: {
    msw: {
      handlers: [
        statusHandler(makeUser()),
        datesHandler([
          makeDate({ date: '2026-05-15', user_signed_up: true }),
        ]),
        http.get('*/api/users/me/verification-token', () =>
          HttpResponse.json({ error: 'Token service unavailable' }, { status: 500 })
        ),
      ],
    },
  },
}

// Pre-signup state — date picker is shown; no QR button yet because the
// member hasn't committed to a date.
export const NotYetSignedUp: Story = {
  parameters: {
    msw: {
      handlers: [
        statusHandler(makeUser()),
        datesHandler([
          makeDate({ date: '2026-05-15' }),
          makeDate({ date: '2026-05-22', has_full_shift_committee: true }),
        ]),
      ],
    },
  },
}

// Induction completed — full onboarding-progress view, QR section gone.
export const InductionCompleted: Story = {
  parameters: {
    msw: {
      handlers: [
        statusHandler(makeUser({
          induction_completed: true,
          code_of_conduct_signed: true,
          food_safety_completed: true,
          has_food_safety_certificate: true,
        })),
        datesHandler([]),
      ],
    },
  },
}

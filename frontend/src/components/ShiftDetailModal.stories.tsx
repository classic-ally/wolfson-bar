import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { http, HttpResponse } from 'msw'
import { within, userEvent, expect, waitFor } from 'storybook/test'
import ShiftDetailModal from './ShiftDetailModal'
import { Button } from '@/components/ui/button'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { UserStatus } from '@/types/UserStatus'

// Network handlers in ShiftDetailModal (signup, cancel, assign, induction)
// hit /api/* and will fail in storybook — clicks log alerts via the
// underlying error handling. Stories cover visual matrix only.

function makeShift(overrides: Partial<ShiftInfo> = {}): ShiftInfo {
  return {
    date: '2026-05-09',
    event_title: null,
    event_description: null,
    max_volunteers: 4,
    requires_contract: false,
    signups_count: 1,
    signups: [
      { user_id: 'u-allison', display_name: 'Allison Bentley', is_committee: false },
    ],
    open_time: '19:00',
    close_time: '23:00',
    has_induction_availability: false,
    induction_signups_count: 0,
    current_user_induction_available: false,
    ...overrides,
  }
}

function makeUser(overrides: Partial<UserStatus> = {}): UserStatus {
  return {
    user_id: 'u-current',
    display_name: 'Test User',
    is_committee: false,
    code_of_conduct_signed: true,
    food_safety_completed: true,
    has_food_safety_certificate: true,
    induction_completed: true,
    has_contract: false,
    contract_expiry_date: null,
    email: 'test@example.com',
    email_notifications_enabled: false,
    privacy_consent_given: true,
    has_passkey: true,
    supervised_shift_completed: true,
    ...overrides,
  }
}

const meta = {
  title: 'Shifts/ShiftDetailModal',
  component: ShiftDetailModal,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ShiftDetailModal>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper(props: {
  shift: ShiftInfo
  userStatus: UserStatus
  isCommittee?: boolean
}) {
  const [shift, setShift] = useState<ShiftInfo | null>(props.shift)
  return (
    <div className="p-8 space-y-2">
      <Button onClick={() => setShift(props.shift)}>Open Shift Detail</Button>
      <ShiftDetailModal
        shift={shift}
        userStatus={props.userStatus}
        isCommittee={props.isCommittee}
        onClose={() => setShift(null)}
        onUpdate={() => {}}
      />
    </div>
  )
}

export const RegularUserCanSignUp: Story = {
  render: () => <Wrapper shift={makeShift()} userStatus={makeUser()} />,
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

export const SignedUp: Story = {
  render: () => (
    <Wrapper
      shift={makeShift({
        signups_count: 2,
        signups: [
          { user_id: 'u-allison', display_name: 'Allison Bentley', is_committee: false },
          // The wrapper's user_id matches by default; align to mark as signed up.
          { user_id: 'u-current', display_name: 'Test User', is_committee: false },
        ],
      })}
      userStatus={makeUser()}
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

export const ShiftFull: Story = {
  render: () => (
    <Wrapper
      shift={makeShift({
        signups_count: 4,
        signups: [
          { user_id: 'a', display_name: 'Volunteer A', is_committee: false },
          { user_id: 'b', display_name: 'Volunteer B', is_committee: true },
          { user_id: 'c', display_name: 'Volunteer C', is_committee: false },
          { user_id: 'd', display_name: 'Volunteer D', is_committee: false },
        ],
      })}
      userStatus={makeUser()}
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

export const RequiresContractNoContract: Story = {
  render: () => (
    <Wrapper
      shift={makeShift({ requires_contract: true })}
      userStatus={makeUser({ has_contract: false })}
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

export const WithEvent: Story = {
  render: () => (
    <Wrapper
      shift={makeShift({
        event_title: 'College Quiz Night',
        event_description: 'Big crowd expected — book early.',
      })}
      userStatus={makeUser()}
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

export const NeedsInductionWithAvailability: Story = {
  render: () => (
    <Wrapper
      shift={makeShift({
        has_induction_availability: true,
        induction_signups_count: 1,
      })}
      userStatus={makeUser({
        induction_completed: false,
        supervised_shift_completed: false,
      })}
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

export const NeedsSupervisedShift: Story = {
  render: () => (
    <Wrapper
      shift={makeShift()}
      userStatus={makeUser({ supervised_shift_completed: false })}
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser(),
    onClose: () => {},
    onUpdate: () => {},
  },
}

// Regression guard for the Base-UI-Combobox-inside-Radix-modal bug:
// the popup is portaled into the dialog and must remain interactive.
// Before the fix, clicking an option did nothing (popup landed in the
// modal's inert/pointer-events:none zone) and Assign stayed disabled.
export const CommitteeAssignSelectsMember: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/api/admin/active-members', () =>
          HttpResponse.json([
            { user_id: 'u-grace', display_name: 'Grace Hopper', has_contract: true, contract_expiry_date: null, is_committee: false },
            { user_id: 'u-ada', display_name: 'Ada Lovelace', has_contract: true, contract_expiry_date: null, is_committee: false },
          ]),
        ),
      ],
    },
  },
  render: () => (
    <Wrapper
      shift={makeShift({
        signups_count: 1,
        signups: [
          { user_id: 'u-other', display_name: 'Other Volunteer', is_committee: false },
        ],
      })}
      userStatus={makeUser({ is_committee: true })}
      isCommittee
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser({ is_committee: true }),
    isCommittee: true,
    onClose: () => {},
    onUpdate: () => {},
  },
  play: async ({ canvasElement }) => {
    // Dialog + combobox popup are portaled to document.body, outside the
    // story canvas — query the whole document.
    void canvasElement
    const body = within(document.body)

    const input = await body.findByPlaceholderText('Select a member...')
    const assignBtn = body.getByRole('button', { name: /^Assign$/ })
    await expect(assignBtn).toBeDisabled()

    await userEvent.click(input)
    const option = await body.findByRole('option', { name: 'Grace Hopper' })
    await userEvent.click(option)

    // Selection registered → Assign enabled. Fails if the popup is inert.
    await waitFor(() => expect(assignBtn).toBeEnabled())
    await expect(input).toHaveValue('Grace Hopper')
  },
}

export const CommitteeView: Story = {
  render: () => (
    <Wrapper
      shift={makeShift({
        signups_count: 2,
        signups: [
          { user_id: 'u-other', display_name: 'Other Volunteer', is_committee: false },
          { user_id: 'u-comm', display_name: 'Committee Member', is_committee: true },
        ],
      })}
      userStatus={makeUser({ is_committee: true })}
      isCommittee
    />
  ),
  args: {
    shift: makeShift(),
    userStatus: makeUser({ is_committee: true }),
    isCommittee: true,
    onClose: () => {},
    onUpdate: () => {},
  },
}

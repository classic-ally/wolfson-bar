import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import ShiftSlotCalendar from './ShiftSlotCalendar'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { Event } from '@/types/Event'
import type { TermWeek } from '@/lib/auth'
import type { InductionDate } from '@/types/InductionDate'
import type { UserStatus } from '@/types/UserStatus'
import type { ViewerContext } from './ShiftSlotCalendar'

// Date window for the stories: 2026-05-01 to 2026-05-31.
const fromDate = new Date('2026-05-01')
const toDate = new Date('2026-05-31')

function shift(date: string, signups: number, max = 4): ShiftInfo {
  return {
    date,
    event_title: null,
    event_description: null,
    max_volunteers: max,
    requires_contract: false,
    signups_count: signups,
    signups: Array.from({ length: signups }).map((_, i) => ({
      user_id: `u-${date}-${i}`,
      display_name: `Volunteer ${i + 1}`,
      is_committee: false,
    })),
    open_time: '19:00',
    close_time: '23:00',
    has_induction_availability: false,
    induction_signups_count: 0,
    current_user_induction_available: false,
  }
}

const fixtureShifts: ShiftInfo[] = [
  shift('2026-05-04', 0), // empty
  shift('2026-05-05', 0), // empty
  shift('2026-05-06', 2), // partial
  shift('2026-05-07', 4), // full
  shift('2026-05-08', 1), // partial
  shift('2026-05-11', 0),
  shift('2026-05-12', 3),
  shift('2026-05-13', 4),
  shift('2026-05-14', 1),
  shift('2026-05-15', 2),
  shift('2026-05-18', 0),
  shift('2026-05-19', 0),
  shift('2026-05-20', 4),
  shift('2026-05-21', 2),
  shift('2026-05-22', 1),
  shift('2026-05-25', 0),
  shift('2026-05-26', 1),
  shift('2026-05-27', 4),
  shift('2026-05-28', 0),
  shift('2026-05-29', 3),
]

// Fictional Trinity Term mapping for May 2026.
const fixtureTermWeeks: TermWeek[] = [
  { summary: '0th Week, Trinity Term', start_date: '2026-04-26', end_date: '2026-05-03' },
  { summary: '1st Week, Trinity Term', start_date: '2026-05-03', end_date: '2026-05-10' },
  { summary: '2nd Week, Trinity Term', start_date: '2026-05-10', end_date: '2026-05-17' },
  { summary: '3rd Week, Trinity Term', start_date: '2026-05-17', end_date: '2026-05-24' },
  { summary: '4th Week, Trinity Term', start_date: '2026-05-24', end_date: '2026-05-31' },
  { summary: '5th Week, Trinity Term', start_date: '2026-05-31', end_date: '2026-06-07' },
]

const fixtureInductionDates: InductionDate[] = [
  {
    date: '2026-05-06',
    has_full_shift_committee: true,
    slots_remaining: 3,
    user_signed_up: false,
    user_signed_up_full_shift: false,
    inductees: [{ user_id: 'i1', display_name: 'New Member', full_shift: false }],
  },
  {
    date: '2026-05-14',
    has_full_shift_committee: false,
    slots_remaining: 4,
    user_signed_up: false,
    user_signed_up_full_shift: false,
    inductees: [],
  },
]

const fixtureEvents: Event[] = [
  {
    id: 'e1',
    title: 'Quiz Night',
    description: null,
    event_date: '2026-05-07',
    start_time: '19:30',
    end_time: '22:00',
    shift_max_volunteers: null,
    shift_requires_contract: null,
  },
  {
    id: 'e2',
    title: 'Live Music',
    description: null,
    event_date: '2026-05-15',
    start_time: '20:00',
    end_time: '23:00',
    shift_max_volunteers: null,
    shift_requires_contract: null,
  },
  {
    id: 'e3',
    title: 'Halfway Hall',
    description: null,
    event_date: '2026-05-22',
    start_time: '19:00',
    end_time: '23:30',
    shift_max_volunteers: null,
    shift_requires_contract: null,
  },
]

const meta = {
  title: 'Committee/ShiftSlotCalendar',
  component: ShiftSlotCalendar,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ShiftSlotCalendar>

export default meta
type Story = StoryObj<typeof meta>

function Wrapper(props: {
  shifts: ShiftInfo[]
  events: Event[]
  termWeeks?: TermWeek[]
  inductionDates?: InductionDate[]
  userExistingShifts?: string[]
  viewerContext?: ViewerContext
}) {
  const [selected, setSelected] = useState<Date | undefined>(undefined)
  return (
    <div className="space-y-4">
      <ShiftSlotCalendar
        shifts={props.shifts}
        events={props.events}
        termWeeks={props.termWeeks ?? fixtureTermWeeks}
        inductionDates={props.inductionDates}
        userExistingShifts={props.userExistingShifts}
        viewerContext={props.viewerContext}
        fromDate={fromDate}
        toDate={toDate}
        selected={selected}
        onSelect={setSelected}
      />
      <p className="text-sm text-muted-foreground">
        Selected:{' '}
        {selected
          ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`
          : '(none)'}
      </p>
    </div>
  )
}

export const Default: Story = {
  render: () => <Wrapper shifts={fixtureShifts} events={fixtureEvents} />,
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const UserAlreadyOnSomeShifts: Story = {
  render: () => (
    <Wrapper
      shifts={fixtureShifts}
      events={fixtureEvents}
      userExistingShifts={['2026-05-08', '2026-05-22']}
    />
  ),
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    userExistingShifts: ['2026-05-08', '2026-05-22'],
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const NoEvents: Story = {
  render: () => <Wrapper shifts={fixtureShifts} events={[]} />,
  args: {
    shifts: fixtureShifts,
    events: [],
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const InductionBadges: Story = {
  render: () => {
    // Mark one shift as the current committee member running induction
    // (drives filled-blue "I" variant).
    const shiftsWithOwnInduction = fixtureShifts.map((s) =>
      s.date === '2026-05-15'
        ? { ...s, has_induction_availability: true, current_user_induction_available: true, induction_signups_count: 2 }
        : s,
    )
    return (
      <Wrapper
        shifts={shiftsWithOwnInduction}
        events={fixtureEvents}
        inductionDates={fixtureInductionDates}
      />
    )
  },
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    inductionDates: fixtureInductionDates,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const SelfViewPreInduction: Story = {
  render: () => {
    const preInductionStatus: UserStatus = {
      user_id: 'u-self',
      display_name: 'New User',
      is_committee: false,
      code_of_conduct_signed: false,
      food_safety_completed: false,
      has_food_safety_certificate: false,
      induction_completed: false,
      has_contract: false,
      contract_expiry_date: null,
      email: null,
      email_notifications_enabled: false,
      privacy_consent_given: true,
      has_passkey: true,
      supervised_shift_completed: false,
    }
    // Mark a few shifts with a committee member present so they remain bookable.
    const shiftsWithCommittee = fixtureShifts.map((s) =>
      ['2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27'].includes(s.date)
        ? {
            ...s,
            signups: [
              ...s.signups,
              { user_id: `comm-${s.date}`, display_name: 'Committee', is_committee: true },
            ],
            signups_count: s.signups_count + 1,
          }
        : s,
    )
    return (
      <Wrapper
        shifts={shiftsWithCommittee}
        events={fixtureEvents}
        inductionDates={fixtureInductionDates}
        viewerContext={{ kind: 'self', userStatus: preInductionStatus }}
      />
    )
  },
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const SparseShifts: Story = {
  render: () => (
    <Wrapper
      shifts={[shift('2026-05-08', 0), shift('2026-05-15', 2), shift('2026-05-22', 4)]}
      events={fixtureEvents}
    />
  ),
  args: {
    shifts: [],
    events: fixtureEvents,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const MobilePortrait: Story = {
  render: () => <Wrapper shifts={fixtureShifts} events={fixtureEvents} />,
  globals: {
    viewport: { value: 'iphone14', isRotated: false },
  },
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const SmallPhone: Story = {
  render: () => <Wrapper shifts={fixtureShifts} events={fixtureEvents} />,
  globals: {
    viewport: { value: 'iphonese2', isRotated: false },
  },
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

export const Tablet: Story = {
  render: () => <Wrapper shifts={fixtureShifts} events={fixtureEvents} />,
  globals: {
    viewport: { value: 'ipad', isRotated: false },
  },
  args: {
    shifts: fixtureShifts,
    events: fixtureEvents,
    fromDate,
    toDate,
    onSelect: () => {},
  },
}

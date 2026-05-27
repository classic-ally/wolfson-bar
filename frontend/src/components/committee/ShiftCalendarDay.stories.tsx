import type { Meta, StoryObj } from '@storybook/react-vite'
import ShiftCalendarDay from './ShiftCalendarDay'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { Event } from '@/types/Event'
import type { InductionDate } from '@/types/InductionDate'

// Anchor "today" so stories render deterministically regardless of clock.
const today = new Date('2026-05-27T00:00:00')
const future = new Date('2026-06-01T00:00:00')

function shift(opts: Partial<ShiftInfo> = {}): ShiftInfo {
  return {
    date: '2026-06-01',
    event_title: null,
    event_description: null,
    max_volunteers: 4,
    requires_contract: false,
    signups_count: 0,
    signups: [],
    open_time: '19:00',
    close_time: '23:00',
    has_induction_availability: false,
    induction_signups_count: 0,
    current_user_induction_available: false,
    ...opts,
  }
}

function event(title: string, id = '1'): Event {
  return {
    id: `evt-${id}`,
    title,
    description: null,
    event_date: '2026-06-01',
    start_time: '20:00',
    end_time: '23:00',
    shift_max_volunteers: null,
    shift_requires_contract: null,
  }
}

const meta = {
  title: 'Committee/ShiftCalendarDay',
  component: ShiftCalendarDay,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div
        className="rounded-md border border-border bg-background"
        style={{ width: 88, height: 88 }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    day: { date: future } as never,
    modifiers: { selected: false, today: false, disabled: false } as never,
    buttonProps: {} as never,
    shift: undefined,
    events: [],
    termLabel: undefined,
    inductionDate: undefined,
    userAlreadyOn: false,
    viewerContext: { kind: 'manager' as const },
    today,
    onSelect: () => {},
  },
} satisfies Meta<typeof ShiftCalendarDay>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { shift: shift({ signups_count: 0 }) },
}

export const Partial: Story = {
  args: { shift: shift({ signups_count: 2 }) },
}

export const Full: Story = {
  args: {
    shift: shift({
      signups_count: 4,
      signups: Array.from({ length: 4 }).map((_, i) => ({
        user_id: `u${i}`,
        display_name: `V${i}`,
        is_committee: false,
      })),
    }),
  },
}

export const Paid: Story = {
  args: { shift: shift({ requires_contract: true, signups_count: 1 }) },
}

export const SingleEvent: Story = {
  args: {
    shift: shift({ signups_count: 1 }),
    events: [event('Quiz Night')],
  },
}

export const TwoEvents: Story = {
  args: {
    shift: shift({ signups_count: 1 }),
    events: [event('Quiz Night', '1'), event('Open Mic', '2')],
  },
}

export const ThreeEvents: Story = {
  args: {
    shift: shift({ signups_count: 1 }),
    events: [
      event('Quiz Night', '1'),
      event('Open Mic', '2'),
      event('Live Music', '3'),
    ],
  },
}

export const FourEvents: Story = {
  args: {
    shift: shift({ signups_count: 1 }),
    events: [
      event('Quiz Night', '1'),
      event('Open Mic', '2'),
      event('Live Music', '3'),
      event('Karaoke', '4'),
    ],
  },
}

export const WithInduction: Story = {
  args: {
    shift: shift({ has_induction_availability: true }),
    inductionDate: {
      date: '2026-06-01',
      has_full_shift_committee: true,
      slots_remaining: 3,
      user_signed_up: false,
      user_signed_up_full_shift: false,
      inductees: [],
    } as InductionDate,
  },
}

export const OwnInduction: Story = {
  args: {
    shift: shift({
      has_induction_availability: true,
      current_user_induction_available: true,
      induction_signups_count: 2,
    }),
  },
}

export const TermLabel: Story = {
  args: { shift: shift({ signups_count: 1 }), termLabel: 'TT2' },
}

export const Selected: Story = {
  args: {
    shift: shift({ signups_count: 2 }),
    modifiers: { selected: true, today: false, disabled: false } as never,
  },
}

export const Today: Story = {
  args: {
    day: { date: today } as never,
    shift: shift({ date: '2026-05-27', signups_count: 1 }),
    modifiers: { selected: false, today: true, disabled: false } as never,
  },
}

export const PastDate: Story = {
  args: {
    day: { date: new Date('2026-05-20T00:00:00') } as never,
    shift: shift({ date: '2026-05-20', signups_count: 0 }),
  },
}

export const UserBooked: Story = {
  args: {
    shift: shift({ signups_count: 2 }),
    userAlreadyOn: true,
  },
}

export const PublicView: Story = {
  args: {
    shift: shift({ signups_count: 0, requires_contract: true }),
    events: [event('Live Music')],
    viewerContext: { kind: 'public' as const },
  },
}

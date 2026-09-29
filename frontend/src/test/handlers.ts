import { http, HttpResponse } from 'msw'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { Event } from '@/types/Event'
import type { TermWeek, UnallocatedMember } from '@/lib/auth'

// Fixture date window: May 2026 — matches ShiftSlotCalendar story window.
export const fixtureRange = {
  start: '2026-05-01',
  end: '2026-05-31',
}

export const fixtureUnallocated: UnallocatedMember[] = [
  {
    user_id: 'u-allison',
    display_name: 'Allison Bentley',
    has_contract: true,
    contract_expiry_date: '2027-09-30',
    last_shift_date: '2026-03-12',
  },
  {
    user_id: 'u-charlie',
    display_name: 'Charlie Pickering',
    has_contract: false,
    contract_expiry_date: null,
    last_shift_date: '2026-04-02',
  },
  {
    user_id: 'u-dani',
    display_name: 'Dani Lee',
    has_contract: false,
    contract_expiry_date: null,
    last_shift_date: null,
  },
  {
    user_id: 'u-eve',
    display_name: 'Eve Mason',
    has_contract: true,
    contract_expiry_date: '2027-06-15',
    last_shift_date: '2026-04-19',
  },
  {
    user_id: 'u-finn',
    display_name: 'Finn Park',
    has_contract: true,
    contract_expiry_date: '2027-12-01',
    last_shift_date: '2026-02-08',
  },
]

function makeShift(date: string, signups: number, max = 4): ShiftInfo {
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

export const fixtureShifts: ShiftInfo[] = [
  makeShift('2026-05-04', 0),
  makeShift('2026-05-05', 0),
  makeShift('2026-05-06', 2),
  makeShift('2026-05-07', 4),
  makeShift('2026-05-08', 1),
  makeShift('2026-05-11', 0),
  makeShift('2026-05-12', 3),
  makeShift('2026-05-13', 4),
  makeShift('2026-05-14', 1),
  makeShift('2026-05-15', 2),
  makeShift('2026-05-18', 0),
  makeShift('2026-05-19', 0),
  makeShift('2026-05-20', 4),
  makeShift('2026-05-21', 2),
  makeShift('2026-05-22', 1),
  makeShift('2026-05-25', 0),
  makeShift('2026-05-26', 1),
  makeShift('2026-05-27', 4),
  makeShift('2026-05-28', 0),
  makeShift('2026-05-29', 3),
]

export const fixtureEvents: Event[] = [
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

export const fixtureTermWeeks: TermWeek[] = [
  { summary: '0th Week, Trinity Term', start_date: '2026-04-26', end_date: '2026-05-03' },
  { summary: '1st Week, Trinity Term', start_date: '2026-05-03', end_date: '2026-05-10' },
  { summary: '2nd Week, Trinity Term', start_date: '2026-05-10', end_date: '2026-05-17' },
  { summary: '3rd Week, Trinity Term', start_date: '2026-05-17', end_date: '2026-05-24' },
  { summary: '4th Week, Trinity Term', start_date: '2026-05-24', end_date: '2026-05-31' },
  { summary: '5th Week, Trinity Term', start_date: '2026-05-31', end_date: '2026-06-07' },
]

function overviewHandler(cocResignPending: number) {
  return http.get('*/api/admin/overview', () =>
    HttpResponse.json({
      active_members_count: 8,
      pending_certificates_count: 0,
      pending_contracts_count: 0,
      unstaffed_shifts_next_3_days: 0,
      understaffed_events_next_7_days: 0,
      expiring_contracts_next_30_days: 0,
      coc_resign_pending_count: cocResignPending,
    }),
  )
}

/** Default handler set covering the rota-manager flow. */
export const defaultHandlers = [
  overviewHandler(0),
  http.get('*/api/admin/unallocated-users', () =>
    HttpResponse.json(fixtureUnallocated),
  ),
  http.get('*/api/shifts', () => HttpResponse.json(fixtureShifts)),
  http.get('*/api/events', () => HttpResponse.json(fixtureEvents)),
  http.get('*/api/term-weeks', () => HttpResponse.json(fixtureTermWeeks)),
  http.post('*/api/admin/shifts/:date/:userId', () =>
    HttpResponse.json({}, { status: 200 }),
  ),
]

/** Empty unallocated list — for the "all sorted" story. */
export const emptyUnallocatedHandlers = [
  overviewHandler(0),
  http.get('*/api/admin/unallocated-users', () => HttpResponse.json([])),
  http.get('*/api/shifts', () => HttpResponse.json(fixtureShifts)),
  http.get('*/api/events', () => HttpResponse.json(fixtureEvents)),
  http.get('*/api/term-weeks', () => HttpResponse.json(fixtureTermWeeks)),
]

/** Nobody listed because a new CoC was just published and nobody has re-signed. */
export const cocResetHandlers = [
  overviewHandler(11),
  ...emptyUnallocatedHandlers.slice(1),
]

/** Hangs forever — for the loading-state story. */
export const loadingHandlers = [
  overviewHandler(0),
  http.get('*/api/admin/unallocated-users', () => new Promise(() => {})),
  http.get('*/api/shifts', () => HttpResponse.json(fixtureShifts)),
  http.get('*/api/events', () => HttpResponse.json(fixtureEvents)),
  http.get('*/api/term-weeks', () => HttpResponse.json(fixtureTermWeeks)),
]

const sampleCoc = [
  '# Wolfson Cellar Bar - Code of Conduct',
  '',
  'ALL trained Rota Members MUST read and accept the following Code of Conduct.',
  '',
  "## Members' Understanding",
  '',
  ...Array.from({ length: 30 }, (_, i) => `- Rule ${i + 1}: behave responsibly behind the bar.`),
  '',
  '---',
  '',
  '**I confirm that I have read, understood, and agree to abide by the above Code of Conduct.**',
].join('\n')

/** Current CoC + successful acceptance. Spread into stories that replace the default handlers. */
export const cocHandlers = [
  http.get('*/api/coc/current', () =>
    HttpResponse.json({ version: 2, body: sampleCoc, published_at: '2026-09-01 12:00:00' }),
  ),
  http.post('*/api/users/me/accept-coc', () => new HttpResponse(null, { status: 200 })),
]

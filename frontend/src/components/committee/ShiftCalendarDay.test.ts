import { describe, expect, it } from 'vitest'
import { fillStateFor, offersSupervisedShift } from './ShiftCalendarDay'
import type { ViewerContext } from './ShiftSlotCalendar'
import type { ShiftInfo } from '@/types/ShiftInfo'
import type { ShiftSignupUser } from '@/types/ShiftSignupUser'
import type { UserStatus } from '@/types/UserStatus'

function shift(signups: ShiftSignupUser[], max_volunteers = 4, requires_contract = false): ShiftInfo {
  return {
    date: '2026-06-01',
    event_title: null,
    event_description: null,
    max_volunteers,
    requires_contract,
    signups_count: signups.length,
    signups,
    open_time: '19:00',
    close_time: '23:00',
    has_induction_availability: false,
    induction_signups_count: 0,
    current_user_induction_available: false,
  }
}

function viewer(overrides: Partial<UserStatus> = {}): ViewerContext {
  return {
    kind: 'self',
    userStatus: {
      user_id: 'u-me',
      display_name: 'Me',
      is_committee: false,
      code_of_conduct_signed: true,
      code_of_conduct_version: 1,
      food_safety_completed: true,
      has_food_safety_certificate: true,
      induction_completed: true,
      has_contract: false,
      contract_expiry_date: null,
      email: null,
      email_shift_updates: false,
      email_membership: false,
      privacy_consent_given: true,
      has_passkey: true,
      supervised_shift_completed: true,
      ...overrides,
    },
  }
}

const committee = { user_id: 'u-committee', display_name: 'Committee', is_committee: true }
const volunteer = { user_id: 'u-other', display_name: 'Volunteer', is_committee: false }
const me = { user_id: 'u-me', display_name: 'Me', is_committee: false }
const unsupervised = viewer({ supervised_shift_completed: false })

describe('supervised shift calendar rules', () => {
  // Impact: inducted members can only book shifts with a committee member on
  // them, so other dates should read as unavailable rather than understaffed.
  // Should: grey out dates with no committee member for unsupervised members.
  it('blocks dates without a committee member until supervised', () => {
    expect(fillStateFor(shift([volunteer]), unsupervised, false)).toBe('blocked')
    expect(fillStateFor(shift([committee]), unsupervised, false)).toBe('partial')
    expect(fillStateFor(shift([volunteer]), viewer(), false)).toBe('partial')
  })

  // Should: leave a date the member is already booked on in its normal fill,
  // so a committee-assigned shift stays visible as theirs.
  it('does not block a date the viewer is already on', () => {
    expect(fillStateFor(shift([me]), unsupervised, false)).toBe('partial')
  })

  // Should: badge future dates with a committee member and room to join.
  // Should not: badge full, past, or already-booked dates.
  it('offers supervised shifts only where the member can book one', () => {
    expect(offersSupervisedShift(shift([committee]), unsupervised, false)).toBe(true)
    expect(offersSupervisedShift(shift([volunteer]), unsupervised, false)).toBe(false)
    expect(offersSupervisedShift(shift([committee, volunteer], 2), unsupervised, false)).toBe(false)
    expect(offersSupervisedShift(shift([committee]), unsupervised, true)).toBe(false)
    expect(offersSupervisedShift(shift([committee, me]), unsupervised, false)).toBe(false)
  })

  // Impact: regression guard: paid events showed the badge to members who
  // can't book them, sending trainees to a "Contract Required" dead end.
  // Should not: badge contract-only shifts for members without a contract.
  it('skips contract-only shifts for members without a contract', () => {
    const paid = shift([committee], 4, true)
    expect(offersSupervisedShift(paid, unsupervised, false)).toBe(false)
    expect(
      offersSupervisedShift(paid, viewer({ supervised_shift_completed: false, has_contract: true }), false),
    ).toBe(true)
  })

  // Should not: badge dates for supervised, pre-induction, or rota-manager viewers.
  it('only offers supervised shifts to inducted, unsupervised members', () => {
    const s = shift([committee])
    expect(offersSupervisedShift(s, viewer(), false)).toBe(false)
    expect(
      offersSupervisedShift(
        s,
        viewer({ induction_completed: false, supervised_shift_completed: false }),
        false,
      ),
    ).toBe(false)
    expect(offersSupervisedShift(s, { kind: 'manager' }, false)).toBe(false)
  })
})

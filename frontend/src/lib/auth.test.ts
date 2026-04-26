import { describe, expect, it } from 'vitest'
import { canSignupForShifts, isRotaMember } from './auth'

type PredicateInput = Parameters<typeof canSignupForShifts>[0]

function userWith(
  induction: boolean,
  coc: boolean,
  food: boolean,
  supervised: boolean,
): PredicateInput {
  return {
    induction_completed: induction,
    code_of_conduct_signed: coc,
    food_safety_completed: food,
    supervised_shift_completed: supervised,
  }
}

describe('canSignupForShifts', () => {
  it('passes when induction + coc + food are all true (supervised irrelevant)', () => {
    expect(canSignupForShifts(userWith(true, true, true, false))).toBe(true)
    expect(canSignupForShifts(userWith(true, true, true, true))).toBe(true)
  })

  it('blocks when induction is missing', () => {
    expect(canSignupForShifts(userWith(false, true, true, false))).toBe(false)
  })

  it('blocks when code of conduct is missing', () => {
    expect(canSignupForShifts(userWith(true, false, true, false))).toBe(false)
  })

  it('blocks when food safety is missing', () => {
    expect(canSignupForShifts(userWith(true, true, false, false))).toBe(false)
  })
})

describe('isRotaMember', () => {
  it('passes only when all four flags are true', () => {
    expect(isRotaMember(userWith(true, true, true, true))).toBe(true)
  })

  it('blocks when supervised shift not completed (the signup gate alone is not enough)', () => {
    expect(isRotaMember(userWith(true, true, true, false))).toBe(false)
  })

  it('blocks when induction missing even if supervised completed', () => {
    expect(isRotaMember(userWith(false, true, true, true))).toBe(false)
  })

  it('blocks when code of conduct missing', () => {
    expect(isRotaMember(userWith(true, false, true, true))).toBe(false)
  })

  it('blocks when food safety missing', () => {
    expect(isRotaMember(userWith(true, true, false, true))).toBe(false)
  })
})

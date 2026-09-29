import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptCodeOfConduct,
  canSignupForShifts,
  downloadExport,
  isRotaMember,
  needsCocResign,
  USER_STATUS_CHANGED,
} from './auth'

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

describe('needsCocResign', () => {
  // Should: ask members who signed an earlier version to re-sign.
  // Should not: treat members who never signed as re-signing.
  it('is true only for members whose earlier signature was reset', () => {
    expect(needsCocResign({ code_of_conduct_signed: false, code_of_conduct_version: 1 })).toBe(true)
    expect(needsCocResign({ code_of_conduct_signed: false, code_of_conduct_version: null })).toBe(false)
    expect(needsCocResign({ code_of_conduct_signed: true, code_of_conduct_version: 2 })).toBe(false)
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

describe('downloadExport', () => {
  let createdUrls: string[]
  let revokedUrls: string[]
  let clickedAnchors: HTMLAnchorElement[]
  let originalCreateElement: typeof document.createElement

  beforeEach(() => {
    // authenticatedFetch reads the auth token from localStorage and throws
    // AuthError if missing — seed one for every test.
    localStorage.setItem('auth_token', 'test-token')

    createdUrls = []
    revokedUrls = []
    clickedAnchors = []

    // JSDOM doesn't implement URL.createObjectURL — stub it and capture the
    // blob URL the helper passes around.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((_blob: Blob) => {
        const url = `blob:mock-${createdUrls.length}`
        createdUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url)
      }),
    })

    // Capture anchor.click() so we can assert the download was triggered
    // without JSDOM actually following the navigation.
    originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const el = originalCreateElement(tagName, options)
      if (tagName === 'a') {
        el.addEventListener('click', (e) => {
          e.preventDefault()
          clickedAnchors.push(el as HTMLAnchorElement)
        })
      }
      return el
    }) as typeof document.createElement)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('fetches the members endpoint and triggers a download', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('display_name,email\nAlice,alice@example.com\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await downloadExport('members')

    expect(fetchMock).toHaveBeenCalledOnce()
    const calledUrl = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('/api/admin/exports/members.csv')
    // Auth header must be present.
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers).toMatchObject({ Authorization: 'Bearer test-token' })

    // Object URL was created, anchor clicked, URL revoked.
    expect(createdUrls).toHaveLength(1)
    expect(clickedAnchors).toHaveLength(1)
    expect(revokedUrls).toEqual(createdUrls)
    // Anchor uses the blob URL — proves the download went through the helper.
    expect(clickedAnchors[0].href).toContain('blob:mock-0')
  })

  it('fetches the shift-history endpoint when asked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('shift_date,event_title\n2026-06-01,Quiz\n', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await downloadExport('shift-history')

    const calledUrl = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain('/api/admin/exports/shift-history.csv')
  })

  it('throws when the server returns a non-OK status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadExport('members')).rejects.toThrow('Forbidden')
    // No download artefacts should have been produced on failure.
    expect(createdUrls).toHaveLength(0)
    expect(clickedAnchors).toHaveLength(0)
  })

  it('cleans up the object URL even after a successful download', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('display_name\nAlice\n', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await downloadExport('members')

    // Every created URL was revoked — no leaks.
    expect(revokedUrls).toEqual(createdUrls)
  })
})

describe('acceptCodeOfConduct', () => {
  beforeEach(() => localStorage.setItem('auth_token', 'test-token'))
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  async function acceptWith(status: number) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(status === 200 ? null : '{}', { status })))
    const listener = vi.fn()
    window.addEventListener(USER_STATUS_CHANGED, listener)
    try {
      await acceptCodeOfConduct(2).catch(() => {})
    } finally {
      window.removeEventListener(USER_STATUS_CHANGED, listener)
    }
    return listener
  }

  // Impact: the onboarding nudge bar stays mounted across pages and only
  // refetches on this event or navigation, so a silent accept left it stale.
  // Should: tell listeners the user's status changed once the CoC is accepted.
  it('announces a status change after a successful accept', async () => {
    expect(await acceptWith(200)).toHaveBeenCalledTimes(1)
  })

  // Should not: announce a status change when the server rejects the acceptance.
  it('stays quiet when the accept is rejected', async () => {
    expect(await acceptWith(409)).not.toHaveBeenCalled()
  })
})

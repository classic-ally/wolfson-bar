import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React and the boundary both log caught errors; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // Should: render its children untouched when nothing throws.
  it('renders children when there is no error', () => {
    render(<ErrorBoundary><p>hello</p></ErrorBoundary>)

    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Impact: without a boundary, any render error unmounted the whole app to a white screen.
  // Should: replace a crashing subtree with a visible error message.
  it('shows the fallback when a child throws', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>)

    expect(screen.getByRole('alert').textContent).toContain('Something went wrong')
  })

  // Should: reload the page when the user asks to retry.
  it('reloads the page from the fallback', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    render(<ErrorBoundary><Boom /></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(reload).toHaveBeenCalledOnce()
  })

  // Should: recover and render new children once the reset key changes, e.g. on navigation.
  it('clears the error when resetKey changes', () => {
    const { rerender } = render(<ErrorBoundary resetKey="/broken"><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(<ErrorBoundary resetKey="/fine"><p>recovered</p></ErrorBoundary>)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('recovered')).toBeTruthy()
  })
})

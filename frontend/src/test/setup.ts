// Vitest setup for the unit project.
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees between tests so timers and effects don't leak across them.
afterEach(() => {
  cleanup()
})

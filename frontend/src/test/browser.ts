import { setupWorker } from 'msw/browser'
import { defaultHandlers } from './handlers'

/** MSW worker for the dev-mode mock harness. Started conditionally from
 *  main.tsx when `VITE_MSW=1` is set. Storybook uses its own initialize()
 *  via msw-storybook-addon — this file is dev-only. */
export const worker = setupWorker(...defaultHandlers)

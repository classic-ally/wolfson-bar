import type { Preview } from '@storybook/react-vite'
import { INITIAL_VIEWPORTS } from 'storybook/viewport'
import { initialize, mswLoader } from 'msw-storybook-addon'
import { http, HttpResponse } from 'msw'
import '../src/index.css'

// authenticatedFetch in src/lib/auth.ts throws AuthError("Not authenticated")
// when no JWT is present, before MSW can intercept. Plant a fake token so
// committee/admin-gated stories can run their data flow against MSW handlers.
if (typeof window !== 'undefined') {
  if (!window.localStorage.getItem('auth_token')) {
    window.localStorage.setItem('auth_token', 'storybook-fake-token')
    window.localStorage.setItem('user_id', 'storybook-user')
    window.localStorage.setItem('is_committee', 'true')
    window.localStorage.setItem('is_admin', 'true')
  }
}

// Initialize MSW. Service worker generated at public/mockServiceWorker.js
// via `npx msw init public/`. Stories register handlers via
// parameters.msw.handlers. Unhandled requests fall through to fetch and fail
// gracefully (most consumers catch and show an empty state).
initialize({
  onUnhandledRequest: 'bypass',
})

const preview: Preview = {
  loaders: [mswLoader],
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },

    viewport: {
      options: INITIAL_VIEWPORTS,
    },

    a11y: {
      test: 'error'
    },

    // Catch-all default handlers so stories that incidentally trigger fetches
    // (e.g. ShiftDetailModal's getActiveMembers in committee mode) don't fall
    // through to the network and cause iframe reloads. Per-story handlers
    // override these via `parameters.msw.handlers`.
    msw: {
      handlers: [
        http.get('*/api/admin/active-members', () => HttpResponse.json([])),
        http.get('*/api/admin/pending-certificates', () => HttpResponse.json([])),
        http.get('*/api/admin/pending-contracts', () => HttpResponse.json([])),
        http.get('*/api/induction-dates', () => HttpResponse.json([])),
      ],
    },
  },
};

export default preview;
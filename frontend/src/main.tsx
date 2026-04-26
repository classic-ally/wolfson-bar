import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function bootstrap() {
  // Opt-in dev mock harness: `VITE_MSW=1 pnpm dev` plants a fake auth token,
  // starts the MSW worker, and serves the same fixtures as storybook. Used to
  // exercise gated flows (rota manager, admin pages) without a backend.
  if (import.meta.env.DEV && import.meta.env.VITE_MSW === '1') {
    if (!localStorage.getItem('auth_token')) {
      localStorage.setItem('auth_token', 'dev-mock-token')
      localStorage.setItem('user_id', 'dev-mock-user')
      localStorage.setItem('is_committee', 'true')
      localStorage.setItem('is_admin', 'true')
    }
    const { worker } = await import('./test/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()

import { useState } from 'react'
import { Link } from 'react-router-dom'
import CodeOfConduct from './CodeOfConduct'

export default function Footer() {
  const [showCoc, setShowCoc] = useState(false)
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-border bg-muted/40">
      <div className="flex flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span>© {year} Wolfson Cellar Bar</span>
          <span className="text-xs">
            Licensed under{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground hover:underline"
            >
              AGPL-3.0
            </a>
            {' · '}
            <a
              href="https://github.com/classic-ally/wolfson-bar"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground hover:underline"
            >
              Source
            </a>
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/about" className="hover:text-foreground hover:underline">
            About
          </Link>
          <Link to="/privacy" className="hover:text-foreground hover:underline">
            Privacy
          </Link>
          <button
            type="button"
            onClick={() => setShowCoc(true)}
            className="hover:text-foreground hover:underline"
          >
            Code of Conduct
          </button>
        </nav>
      </div>

      <CodeOfConduct open={showCoc} onOpenChange={setShowCoc} readOnly />
    </footer>
  )
}

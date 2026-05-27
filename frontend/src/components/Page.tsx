import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type PageSize = 'narrow' | 'default' | 'wide' | 'full'

// Reading-width caps for narrow / default / wide. `full` is intentionally
// uncapped: the events calendar (and any page that opts in) stretches to
// match the header/footer at every viewport, no fixed max.
const sizeClass: Record<PageSize, string> = {
  narrow: 'max-w-lg',
  default: 'max-w-3xl',
  wide: 'max-w-6xl',
  full: 'max-w-none',
}

interface PageProps {
  size?: PageSize
  /** Optional page title. When set, renders an <h1> with a bottom rule. */
  title?: ReactNode
  /** Right-side affordance (button, link) shown beside the title. */
  titleAction?: ReactNode
  className?: string
  children: ReactNode
}

export default function Page({
  size = 'default',
  title,
  titleAction,
  className,
  children,
}: PageProps) {
  return (
    <main className={cn('mx-auto w-full px-5 py-10', sizeClass[size], className)}>
      {title !== undefined && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <h1 className="m-0 text-3xl font-medium">{title}</h1>
          {titleAction}
        </div>
      )}
      {children}
    </main>
  )
}

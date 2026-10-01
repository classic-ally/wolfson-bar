import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button'

interface Props {
  children: ReactNode
  /** Clears a caught error when it changes, e.g. the current pathname. */
  resetKey?: unknown
}

interface State {
  error: Error | null
}

/**
 * Catches render errors so a single broken page shows a message instead of
 * unmounting the whole app to a blank screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error caught by ErrorBoundary', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div role="alert" className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          This page hit an unexpected error. Reloading usually fixes it.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }
}

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'

interface WidgetErrorBoundaryState {
  hasError: boolean
}

export class WidgetErrorBoundary extends React.Component<
  React.PropsWithChildren,
  WidgetErrorBoundaryState
> {
  public override state: WidgetErrorBoundaryState = {
    hasError: false,
  }

  public static getDerivedStateFromError(): WidgetErrorBoundaryState {
    return { hasError: true }
  }

  public override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[WidgetErrorBoundary] widget render failed', error, errorInfo)
  }

  public override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Widget 渲染失败，已安全回退。</span>
        </div>
      </div>
    )
  }
}

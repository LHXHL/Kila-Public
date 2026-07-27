import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

interface WidgetErrorBoundaryState {
  hasError: boolean
}

/** 类组件无法使用 hook，降级 UI 拆成函数组件以接入 i18n */
function WidgetErrorFallback(): React.ReactElement {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span>{t('agent.widget.boundaryFallback')}</span>
      </div>
    </div>
  )
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

    return <WidgetErrorFallback />
  }
}

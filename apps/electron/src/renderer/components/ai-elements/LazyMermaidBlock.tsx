import * as React from 'react'
import { useTranslation } from 'react-i18next'

const MermaidBlock = React.lazy(() => import('@kila/ui').then((module) => ({ default: module.MermaidBlock })))

export function LazyMermaidBlock({ code }: { code: string }): React.ReactElement {
  const { t } = useTranslation()

  return (
    <React.Suspense fallback={(
      <div className="my-3 rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {t('shell.mermaidLoading')}
      </div>
    )}>
      <MermaidBlock code={code} />
    </React.Suspense>
  )
}

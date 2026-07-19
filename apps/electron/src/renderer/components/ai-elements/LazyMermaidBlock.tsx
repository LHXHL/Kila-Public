import * as React from 'react'

const MermaidBlock = React.lazy(() => import('@kila/ui').then((module) => ({ default: module.MermaidBlock })))

export function LazyMermaidBlock({ code }: { code: string }): React.ReactElement {
  return (
    <React.Suspense fallback={(
      <div className="my-3 rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        正在加载 Mermaid 图表…
      </div>
    )}>
      <MermaidBlock code={code} />
    </React.Suspense>
  )
}

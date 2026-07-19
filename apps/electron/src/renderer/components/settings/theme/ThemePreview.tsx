import * as React from 'react'
import { deriveThemeVars } from '@kila/shared'
import type { ThemeDefinition } from '@kila/shared'

export function ThemePreview({
  theme,
  mode,
}: {
  theme: ThemeDefinition
  mode: 'light' | 'dark'
}): React.ReactElement {
  const vars = React.useMemo(() => deriveThemeVars(theme, mode), [theme, mode])

  return (
    <div
      className="h-[86px] w-full overflow-hidden rounded-xl shadow-sm"
      style={{ backgroundColor: `hsl(${vars['--workspace']})` }}
    >
      <div className="flex h-full">
        <div
          className="w-9 shrink-0 px-2 py-2"
          style={{ backgroundColor: `hsl(${vars['--kila-rail']})` }}
        >
          <div className="mb-2 h-3 w-3 rounded-full" style={{ backgroundColor: `hsl(${vars['--kila-accent']})` }} />
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: `hsl(${vars['--muted']})` }} />
        </div>
        <div className="min-w-0 flex-1 p-2">
          <div className="mb-2 h-3 w-24 rounded-full" style={{ backgroundColor: `hsl(${vars['--kila-panel-surface-raised']})` }} />
          <div className="ml-auto mb-2 h-5 w-[58%] rounded-lg" style={{ backgroundColor: `hsl(${vars['--kila-user-bubble']})` }} />
          <div className="h-5 w-[68%] rounded-lg shadow-sm" style={{ backgroundColor: `hsl(${vars['--card']})` }} />
          <div className="mt-2 flex items-center gap-1.5">
            <div className="h-2 flex-1 rounded-full" style={{ backgroundColor: `hsl(${vars['--kila-accent-muted']})` }} />
            <div className="h-2 w-8 rounded-full" style={{ backgroundColor: `hsl(${vars['--primary']})` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

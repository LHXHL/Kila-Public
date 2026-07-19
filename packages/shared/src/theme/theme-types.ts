export interface ThemeCoreColors {
  base: string
  ink: string
  accent: string
  positive: string
  caution: string
  critical: string
  notice: string
}

export interface ThemeDefinition {
  id: string
  name: string
  description: string
  author?: string
  /** 大面积弱强调表面的色彩策略；默认使用强调色染色。 */
  accentSurfaces?: 'tinted' | 'neutral'
  colors: ThemeCoreColors
  dark?: {
    colors: Partial<ThemeCoreColors>
  }
}

export interface OklchColor {
  l: number
  c: number
  h: number
}

export interface OklabColor {
  l: number
  a: number
  b: number
}

export type DerivedThemeMode = 'light' | 'dark'

export const THEME_VAR_NAMES = [
  '--background',
  '--foreground',
  '--workspace',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--input',
  '--accent',
  '--accent-foreground',
  '--secondary',
  '--secondary-foreground',
  '--code-surface',
  '--primary',
  '--primary-foreground',
  '--ring',
  '--brand-strong',
  '--brand-strong-foreground',
  '--brand-soft',
  '--brand-soft-foreground',
  '--brand-soft-hover',
  '--process-tone',
  '--kila-canvas',
  '--kila-rail',
  '--kila-panel-surface',
  '--kila-panel-surface-raised',
  '--kila-accent',
  '--kila-accent-muted',
  '--kila-accent-foreground',
  '--kila-graphite-green',
  '--kila-graphite-green-muted',
  '--kila-user-bubble',
  '--kila-user-bubble-foreground',
  '--kila-user-bubble-border',
  '--status-success',
  '--status-success-soft',
  '--status-success-foreground',
  '--status-warning',
  '--status-warning-soft',
  '--status-warning-foreground',
  '--status-danger',
  '--status-danger-soft',
  '--status-danger-foreground',
  '--status-info',
  '--status-info-soft',
  '--status-info-foreground',
  '--destructive',
  '--destructive-foreground',
  '--kila-paper',
  '--kila-paper-subtle',
  '--kila-warm-gray-1',
  '--kila-warm-gray-2',
  '--kila-warm-gray-3',
  '--kila-border-subtle',
  '--kila-border-strong',
  '--kila-shadow-low',
  '--sidebar-shadow',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
] as const

export type ThemeVarName = typeof THEME_VAR_NAMES[number]

export type ThemeVarMap = Record<ThemeVarName, string>

export type ThemeColorMap = Record<ThemeVarName, OklchColor>

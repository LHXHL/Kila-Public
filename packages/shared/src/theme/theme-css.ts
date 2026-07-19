import { THEME_VAR_NAMES, type ThemeVarMap } from './theme-types'

export function buildThemeStyleText(vars: ThemeVarMap): string {
  const declarations = THEME_VAR_NAMES
    .map((name) => `  ${name}: ${vars[name]};`)
    .join('\n')

  return `:root {\n${declarations}\n}`
}

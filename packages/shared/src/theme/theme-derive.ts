import { DEFAULT_THEME_ID, getBuiltinTheme } from './builtin-themes'
import { clamp, clampColor, formatHslTriplet, mix, parseOklch, scaleC, setL, shiftL } from './oklch'
import { ensureContrast, pickOnColor } from './theme-validate'
import type {
  DerivedThemeMode,
  OklchColor,
  ThemeColorMap,
  ThemeCoreColors,
  ThemeDefinition,
  ThemeVarMap,
} from './theme-types'

function resolveCoreColors(theme: ThemeDefinition, mode: DerivedThemeMode): Record<keyof ThemeCoreColors, OklchColor> {
  const light = {
    base: parseOklch(theme.colors.base),
    ink: parseOklch(theme.colors.ink),
    accent: parseOklch(theme.colors.accent),
    positive: parseOklch(theme.colors.positive),
    caution: parseOklch(theme.colors.caution),
    critical: parseOklch(theme.colors.critical),
    notice: parseOklch(theme.colors.notice),
  }

  if (mode === 'light') {
    return light
  }

  const autoDark = {
    base: {
      l: clamp(0.08 + light.base.c * 0.05, 0.06, 0.11),
      c: clamp(light.base.c * 0.35, 0.004, 0.02),
      h: light.base.h,
    },
    ink: {
      l: 0.94,
      c: clamp(light.ink.c * 0.35, 0.002, 0.02),
      h: light.ink.h,
    },
    accent: {
      l: Math.max(light.accent.l, 0.70),
      c: clamp(light.accent.c * 1.05, 0.03, 0.18),
      h: light.accent.h,
    },
    positive: {
      l: Math.max(light.positive.l, 0.70),
      c: clamp(light.positive.c * 1.05, 0.03, 0.18),
      h: light.positive.h,
    },
    caution: {
      l: Math.max(light.caution.l, 0.76),
      c: clamp(light.caution.c, 0.03, 0.18),
      h: light.caution.h,
    },
    critical: {
      l: Math.max(light.critical.l, 0.72),
      c: clamp(light.critical.c * 1.05, 0.03, 0.18),
      h: light.critical.h,
    },
    notice: {
      l: Math.max(light.notice.l, 0.72),
      c: clamp(light.notice.c * 1.05, 0.03, 0.18),
      h: light.notice.h,
    },
  } satisfies Record<keyof ThemeCoreColors, OklchColor>

  const darkOverrides = theme.dark?.colors
  if (!darkOverrides) return autoDark

  return {
    base: darkOverrides.base ? parseOklch(darkOverrides.base) : autoDark.base,
    ink: darkOverrides.ink ? parseOklch(darkOverrides.ink) : autoDark.ink,
    accent: darkOverrides.accent ? parseOklch(darkOverrides.accent) : autoDark.accent,
    positive: darkOverrides.positive ? parseOklch(darkOverrides.positive) : autoDark.positive,
    caution: darkOverrides.caution ? parseOklch(darkOverrides.caution) : autoDark.caution,
    critical: darkOverrides.critical ? parseOklch(darkOverrides.critical) : autoDark.critical,
    notice: darkOverrides.notice ? parseOklch(darkOverrides.notice) : autoDark.notice,
  }
}

function createThemeColorMap(theme: ThemeDefinition, mode: DerivedThemeMode): ThemeColorMap {
  const core = resolveCoreColors(theme, mode)
  const isDark = mode === 'dark'
  const surfaceMix = isDark ? 0.08 : 0.03
  const mutedMix = isDark ? 0.12 : 0.08
  const borderMix = isDark ? 0.22 : 0.16
  const inputMix = isDark ? 0.24 : 0.18

  const darkText = isDark ? shiftL(core.base, -0.01) : shiftL(core.ink, -0.02)
  const lightText = isDark ? shiftL(core.ink, +0.01) : shiftL(core.base, +0.04)

  const background = core.base
  const foreground = core.ink
  const workspace = mix(core.base, core.ink, surfaceMix)
  const card = shiftL(core.base, +0.02)
  const popover = shiftL(core.base, isDark ? +0.03 : +0.03)
  const rail = mix(core.base, core.ink, isDark ? 0.07 : 0.055)
  const panelSurface = isDark ? mix(core.base, core.ink, 0.05) : card
  const panelSurfaceRaised = isDark ? mix(core.base, core.ink, 0.075) : shiftL(card, +0.012)
  const muted = mix(core.base, core.ink, mutedMix)
  const mutedForeground = ensureContrast(mix(core.ink, core.base, isDark ? 0.32 : 0.45), background, 3.0)
  const border = mix(core.base, core.ink, borderMix)
  const input = mix(core.base, core.ink, inputMix)
  const accentSurface = mix(core.base, core.ink, isDark ? 0.10 : 0.05)
  const secondary = mix(core.base, core.ink, isDark ? 0.10 : 0.08)
  const codeSurface = isDark ? mix(core.base, core.ink, 0.03) : mix(core.base, core.ink, 0.05)

  const primary = core.accent
  const primaryForeground = pickOnColor(primary, darkText, lightText, 4.5)
  const brandStrong = isDark ? shiftL(scaleC(core.accent, 0.72), -0.30) : mix(core.accent, core.ink, 0.08)
  const brandStrongForeground = pickOnColor(brandStrong, darkText, lightText, 4.5)
  const brandSoft = mix(core.base, core.accent, isDark ? 0.18 : 0.15)
  const brandSoftForeground = ensureContrast(mix(core.accent, core.ink, isDark ? 0.18 : 0.35), brandSoft, 4.5)
  const brandSoftHover = mix(core.base, core.accent, isDark ? 0.24 : 0.22)
  const processTone = ensureContrast(mix(core.accent, core.ink, isDark ? 0.15 : 0.25), background, 3.0)
  const ring = ensureContrast(scaleC(core.accent, 1.05), background, 3.0)
  const userBubble = isDark
    ? setL(scaleC(core.accent, 0.72), 0.32)
    : setL(scaleC(mix(core.accent, core.ink, 0.10), 0.92), 0.42)
  const userBubbleForeground = { l: 0.98, c: 0.004, h: core.base.h }
  const userBubbleBorder = mix(userBubble, core.ink, isDark ? 0.26 : 0.18)

  const successSoft = mix(core.base, core.positive, isDark ? 0.16 : 0.12)
  const warningSoft = mix(core.base, core.caution, isDark ? 0.16 : 0.12)
  const dangerSoft = mix(core.base, core.critical, isDark ? 0.16 : 0.12)
  const infoSoft = mix(core.base, core.notice, isDark ? 0.16 : 0.12)

  const chart1 = ensureContrast(core.accent, background, isDark ? 2.8 : 1.8)
  const chart2 = ensureContrast(core.positive, background, isDark ? 2.8 : 1.8)
  const chart3 = ensureContrast(core.caution, background, isDark ? 2.8 : 1.8)
  const chart4 = ensureContrast(core.notice, background, isDark ? 2.8 : 1.8)
  const chart5 = ensureContrast(core.critical, background, isDark ? 2.8 : 1.8)

  const themeColors: ThemeColorMap = {
    '--background': background,
    '--foreground': foreground,
    '--workspace': workspace,
    '--card': card,
    '--card-foreground': foreground,
    '--popover': popover,
    '--popover-foreground': foreground,
    '--muted': muted,
    '--muted-foreground': mutedForeground,
    '--border': border,
    '--input': input,
    '--accent': accentSurface,
    '--accent-foreground': foreground,
    '--secondary': secondary,
    '--secondary-foreground': foreground,
    '--code-surface': codeSurface,
    '--primary': primary,
    '--primary-foreground': primaryForeground,
    '--ring': ring,
    '--brand-strong': brandStrong,
    '--brand-strong-foreground': brandStrongForeground,
    '--brand-soft': brandSoft,
    '--brand-soft-foreground': brandSoftForeground,
    '--brand-soft-hover': brandSoftHover,
    '--process-tone': processTone,
    '--kila-canvas': background,
    '--kila-rail': rail,
    '--kila-panel-surface': panelSurface,
    '--kila-panel-surface-raised': panelSurfaceRaised,
    '--kila-accent': brandStrong,
    '--kila-accent-muted': brandSoft,
    '--kila-accent-foreground': brandSoftForeground,
    '--kila-graphite-green': brandStrong,
    '--kila-graphite-green-muted': brandSoft,
    '--kila-user-bubble': userBubble,
    '--kila-user-bubble-foreground': userBubbleForeground,
    '--kila-user-bubble-border': userBubbleBorder,
    '--status-success': core.positive,
    '--status-success-soft': successSoft,
    '--status-success-foreground': ensureContrast(mix(core.positive, core.ink, 0.30), successSoft, 4.5),
    '--status-warning': core.caution,
    '--status-warning-soft': warningSoft,
    '--status-warning-foreground': ensureContrast(mix(core.caution, core.ink, 0.30), warningSoft, 4.5),
    '--status-danger': core.critical,
    '--status-danger-soft': dangerSoft,
    '--status-danger-foreground': ensureContrast(mix(core.critical, core.ink, 0.30), dangerSoft, 4.5),
    '--status-info': core.notice,
    '--status-info-soft': infoSoft,
    '--status-info-foreground': ensureContrast(mix(core.notice, core.ink, 0.30), infoSoft, 4.5),
    '--destructive': core.critical,
    '--destructive-foreground': pickOnColor(core.critical, darkText, lightText, 4.5),
    '--kila-paper': card,
    '--kila-paper-subtle': shiftL(card, +0.01),
    '--kila-warm-gray-1': muted,
    '--kila-warm-gray-2': mix(core.base, core.ink, isDark ? 0.18 : 0.12),
    '--kila-warm-gray-3': ensureContrast(mix(core.ink, core.base, isDark ? 0.38 : 0.52), background, 3.0),
    '--kila-border-subtle': border,
    '--kila-border-strong': mix(core.base, core.ink, isDark ? 0.28 : 0.24),
    '--kila-shadow-low': isDark ? mix(core.base, core.ink, 0.06) : mix(core.ink, core.base, 0.20),
    '--sidebar-shadow': mix(core.base, core.ink, isDark ? 0.06 : 0.10),
    '--chart-1': chart1,
    '--chart-2': chart2,
    '--chart-3': chart3,
    '--chart-4': chart4,
    '--chart-5': chart5,
  }

  return validateThemeColorMap(themeColors)
}

function validateThemeColorMap(colors: ThemeColorMap): ThemeColorMap {
  const validated = { ...colors }

  validated['--foreground'] = ensureContrast(validated['--foreground'], validated['--background'], 4.5)
  validated['--muted-foreground'] = ensureContrast(validated['--muted-foreground'], validated['--background'], 3.0)
  validated['--card-foreground'] = ensureContrast(validated['--card-foreground'], validated['--card'], 4.5)
  validated['--popover-foreground'] = ensureContrast(validated['--popover-foreground'], validated['--popover'], 4.5)
  validated['--primary-foreground'] = ensureContrast(validated['--primary-foreground'], validated['--primary'], 4.5)
  validated['--brand-strong-foreground'] = ensureContrast(validated['--brand-strong-foreground'], validated['--brand-strong'], 4.5)
  validated['--brand-soft-foreground'] = ensureContrast(validated['--brand-soft-foreground'], validated['--brand-soft'], 4.5)
  validated['--kila-accent-foreground'] = ensureContrast(validated['--kila-accent-foreground'], validated['--kila-accent-muted'], 4.5)
  validated['--status-success-foreground'] = ensureContrast(validated['--status-success-foreground'], validated['--status-success-soft'], 4.5)
  validated['--status-warning-foreground'] = ensureContrast(validated['--status-warning-foreground'], validated['--status-warning-soft'], 4.5)
  validated['--status-danger-foreground'] = ensureContrast(validated['--status-danger-foreground'], validated['--status-danger-soft'], 4.5)
  validated['--status-info-foreground'] = ensureContrast(validated['--status-info-foreground'], validated['--status-info-soft'], 4.5)
  validated['--kila-user-bubble-foreground'] = ensureContrast(
    validated['--kila-user-bubble-foreground'],
    validated['--kila-user-bubble'],
    4.5,
  )

  return Object.fromEntries(
    Object.entries(validated).map(([name, color]) => [name, clampColor(color)]),
  ) as ThemeColorMap
}

export function deriveThemeColorMap(theme: ThemeDefinition, mode: DerivedThemeMode): ThemeColorMap {
  return createThemeColorMap(theme, mode)
}

export function deriveThemeVars(theme: ThemeDefinition, mode: DerivedThemeMode): ThemeVarMap {
  const colors = deriveThemeColorMap(theme, mode)
  return Object.fromEntries(
    Object.entries(colors).map(([name, color]) => [name, formatHslTriplet(color)]),
  ) as ThemeVarMap
}

export function deriveThemeVarsForThemeId(themeId: string | null | undefined, mode: DerivedThemeMode): ThemeVarMap {
  return deriveThemeVars(getBuiltinTheme(themeId ?? DEFAULT_THEME_ID), mode)
}

import type { ThemeDefinition } from './theme-types'

export const DEFAULT_THEME_ID = 'porcelain'

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    description: 'Codex 原生浅色与深色预设，纯净中性色搭配高识别度蓝色强调',
    author: 'OpenAI',
    accentSurfaces: 'neutral',
    colors: {
      base: 'oklch(1.000 0.000 89.9)',
      ink: 'oklch(0.159 0.000 89.9)',
      accent: 'oklch(0.529 0.173 255.0)',
      positive: 'oklch(0.621 0.180 148.0)',
      caution: 'oklch(0.666 0.157 58.3)',
      critical: 'oklch(0.590 0.213 27.7)',
      notice: 'oklch(0.492 0.249 296.3)',
    },
    dark: {
      colors: {
        base: 'oklch(0.178 0.000 89.9)',
        ink: 'oklch(0.991 0.000 89.9)',
        accent: 'oklch(0.529 0.173 255.0)',
        positive: 'oklch(0.621 0.180 148.0)',
        caution: 'oklch(0.769 0.165 70.1)',
        critical: 'oklch(0.590 0.213 27.7)',
        notice: 'oklch(0.672 0.211 302.2)',
      },
    },
  },
  {
    id: 'porcelain',
    name: '雾瓷石墨',
    description: '冷白雾灰 + 深钢青气泡，现代浅色工作台',
    author: 'Kila',
    colors: {
      base: 'oklch(0.985 0.004 215)',
      ink: 'oklch(0.240 0.010 230)',
      accent: 'oklch(0.470 0.050 205)',
      positive: 'oklch(0.560 0.100 155)',
      caution: 'oklch(0.700 0.120 70)',
      critical: 'oklch(0.560 0.150 25)',
      notice: 'oklch(0.560 0.080 235)',
    },
    dark: {
      colors: {
        base: 'oklch(0.225 0.012 230)',
        ink: 'oklch(0.920 0.010 230)',
        accent: 'oklch(0.700 0.050 205)',
        positive: 'oklch(0.720 0.090 155)',
        caution: 'oklch(0.780 0.105 70)',
        critical: 'oklch(0.730 0.125 25)',
        notice: 'oklch(0.740 0.075 235)',
      },
    },
  },
  {
    id: 'white-steel',
    name: '纯白钢青',
    description: '纯白画布 + 钢青气泡，清爽高对比',
    author: 'Kila',
    colors: {
      base: 'oklch(1.000 0.000 0)',
      ink: 'oklch(0.220 0.006 230)',
      accent: 'oklch(0.455 0.060 205)',
      positive: 'oklch(0.540 0.100 155)',
      caution: 'oklch(0.700 0.120 70)',
      critical: 'oklch(0.560 0.150 25)',
      notice: 'oklch(0.540 0.085 225)',
    },
    dark: {
      colors: {
        base: 'oklch(0.215 0.010 230)',
        ink: 'oklch(0.940 0.004 230)',
        accent: 'oklch(0.680 0.060 205)',
        positive: 'oklch(0.720 0.090 155)',
        caution: 'oklch(0.780 0.105 70)',
        critical: 'oklch(0.730 0.125 25)',
        notice: 'oklch(0.740 0.075 225)',
      },
    },
  },
  {
    id: 'graphite',
    name: '柔石墨',
    description: 'Kami 纸感：暖米纸 + 油墨蓝',
    author: 'Kila',
    colors: {
      base: 'oklch(0.966 0.009 100)',
      ink: 'oklch(0.191 0.002 106.6)',
      accent: 'oklch(0.333 0.077 257.7)',
      positive: 'oklch(0.540 0.090 145)',
      caution: 'oklch(0.690 0.110 70)',
      critical: 'oklch(0.519 0.167 25.1)',
      notice: 'oklch(0.459 0.093 251.8)',
    },
    dark: {
      colors: {
        base: 'oklch(0.191 0.002 106.6)',
        ink: 'oklch(0.966 0.009 100)',
        accent: 'oklch(0.620 0.090 251.8)',
        positive: 'oklch(0.720 0.085 145)',
        caution: 'oklch(0.780 0.100 70)',
        critical: 'oklch(0.720 0.120 25.1)',
        notice: 'oklch(0.720 0.085 251.8)',
      },
    },
  },
  {
    id: 'mist',
    name: '雾灰',
    description: '冷中性 zinc 灰，低干扰工作台',
    author: 'Kila',
    colors: {
      base: 'oklch(0.965 0.003 230)',
      ink: 'oklch(0.220 0.004 250)',
      accent: 'oklch(0.580 0.035 220)',
      positive: 'oklch(0.540 0.080 155)',
      caution: 'oklch(0.680 0.090 75)',
      critical: 'oklch(0.540 0.120 25)',
      notice: 'oklch(0.560 0.070 235)',
    },
    dark: {
      colors: {
        base: 'oklch(0.230 0.006 245)',
        ink: 'oklch(0.920 0.006 250)',
        accent: 'oklch(0.690 0.045 220)',
        positive: 'oklch(0.710 0.075 155)',
        caution: 'oklch(0.770 0.085 75)',
        critical: 'oklch(0.720 0.105 25)',
        notice: 'oklch(0.730 0.070 235)',
      },
    },
  },
  {
    id: 'fjord',
    name: '峡湾',
    description: '灰蓝冷调，清冷克制',
    author: 'Kila',
    colors: {
      base: 'oklch(0.94 0.008 250)',
      ink: 'oklch(0.18 0.008 250)',
      accent: 'oklch(0.55 0.060 230)',
      positive: 'oklch(0.55 0.110 170)',
      caution: 'oklch(0.70 0.120 80)',
      critical: 'oklch(0.55 0.160 20)',
      notice: 'oklch(0.55 0.100 240)',
    },
    dark: {
      colors: {
        base: 'oklch(0.220 0.016 245)',
        ink: 'oklch(0.92 0.018 245)',
        accent: 'oklch(0.72 0.075 230)',
        positive: 'oklch(0.72 0.090 170)',
        caution: 'oklch(0.76 0.095 80)',
        critical: 'oklch(0.72 0.125 20)',
        notice: 'oklch(0.74 0.085 240)',
      },
    },
  },
  {
    id: 'inkstone',
    name: '砚石',
    description: '极简灰黑白，长时间阅读更克制',
    author: 'Kila',
    colors: {
      base: 'oklch(0.94 0.003 70)',
      ink: 'oklch(0.18 0.002 60)',
      accent: 'oklch(0.55 0.015 260)',
      positive: 'oklch(0.50 0.040 160)',
      caution: 'oklch(0.65 0.050 70)',
      critical: 'oklch(0.50 0.080 20)',
      notice: 'oklch(0.50 0.050 240)',
    },
    dark: {
      colors: {
        base: 'oklch(0.215 0.004 260)',
        ink: 'oklch(0.92 0.004 80)',
        accent: 'oklch(0.70 0.030 250)',
        positive: 'oklch(0.70 0.045 160)',
        caution: 'oklch(0.75 0.060 75)',
        critical: 'oklch(0.71 0.090 25)',
        notice: 'oklch(0.72 0.060 245)',
      },
    },
  },
  {
    id: 'duskwood',
    name: '暮木',
    description: '复古实验：暖棕与琥珀的书房感',
    author: 'Kila',
    colors: {
      base: 'oklch(0.95 0.015 75)',
      ink: 'oklch(0.22 0.015 55)',
      accent: 'oklch(0.55 0.080 55)',
      positive: 'oklch(0.50 0.100 150)',
      caution: 'oklch(0.72 0.160 70)',
      critical: 'oklch(0.55 0.180 25)',
      notice: 'oklch(0.50 0.100 240)',
    },
    dark: {
      colors: {
        base: 'oklch(0.225 0.016 55)',
        ink: 'oklch(0.92 0.018 78)',
        accent: 'oklch(0.72 0.090 55)',
        positive: 'oklch(0.70 0.095 150)',
        caution: 'oklch(0.77 0.130 70)',
        critical: 'oklch(0.72 0.130 25)',
        notice: 'oklch(0.72 0.080 240)',
      },
    },
  },
  {
    id: 'laterite',
    name: '红土',
    description: '复古实验：赤陶沙黄，大地色系',
    author: 'Kila',
    colors: {
      base: 'oklch(0.94 0.018 70)',
      ink: 'oklch(0.22 0.015 40)',
      accent: 'oklch(0.58 0.120 30)',
      positive: 'oklch(0.55 0.120 150)',
      caution: 'oklch(0.72 0.140 75)',
      critical: 'oklch(0.55 0.200 15)',
      notice: 'oklch(0.55 0.100 240)',
    },
    dark: {
      colors: {
        base: 'oklch(0.230 0.018 40)',
        ink: 'oklch(0.93 0.018 70)',
        accent: 'oklch(0.70 0.115 28)',
        positive: 'oklch(0.72 0.105 150)',
        caution: 'oklch(0.77 0.115 75)',
        critical: 'oklch(0.70 0.150 355)',
        notice: 'oklch(0.72 0.080 240)',
      },
    },
  },
] as const

export function getBuiltinThemes(): ThemeDefinition[] {
  return [...BUILTIN_THEMES]
}

export function getBuiltinTheme(themeId?: string | null): ThemeDefinition {
  return BUILTIN_THEMES.find((theme) => theme.id === themeId) ?? BUILTIN_THEMES[0]!
}

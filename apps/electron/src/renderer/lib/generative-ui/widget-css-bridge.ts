export const DEFAULT_WIDGET_CHART_COLORS = [
  'hsl(154 22% 56%)',
  'hsl(84 20% 58%)',
  'hsl(28 45% 62%)',
  'hsl(210 22% 64%)',
  'hsl(320 18% 66%)',
] as const

const THEME_VAR_NAMES = [
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--brand-strong',
  '--brand-strong-foreground',
  '--brand-soft',
  '--brand-soft-foreground',
  '--code-surface',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
] as const

function serializeThemeVars(resolvedVars: Record<string, string>): string {
  const entries = new Map<string, string>(Object.entries(resolvedVars))

  DEFAULT_WIDGET_CHART_COLORS.forEach((color, index) => {
    const key = `--chart-${index + 1}`
    if (!entries.has(key)) {
      entries.set(key, color)
    }
  })

  return [...entries.entries()]
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
}

export function resolveThemeVars(): Record<string, string> {
  if (typeof document === 'undefined') return {}

  const computed = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}

  for (const name of THEME_VAR_NAMES) {
    const value = computed.getPropertyValue(name).trim()
    if (value) {
      vars[name] = value
    }
  }

  return vars
}

export function getWidgetIframeStyleBlock(resolvedVars: Record<string, string>): string {
  const serializedVars = serializeThemeVars(resolvedVars)

  return `
:root {
${serializedVars}
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  --color-background-primary: hsl(var(--background, 0 0% 100%));
  --color-background-secondary: hsl(var(--muted, 48 33% 97%));
  --color-background-tertiary: hsl(var(--card, var(--background, 0 0% 100%)));
  --color-text-primary: hsl(var(--foreground, 240 4% 11%));
  --color-text-secondary: hsl(var(--muted-foreground, 240 2% 50%));
  --color-border-tertiary: hsl(var(--border, 39 25% 89%));
  --color-brand-primary: hsl(var(--brand-strong, var(--primary, 158 10% 44%)));
  --color-brand-foreground: hsl(var(--brand-strong-foreground, var(--primary-foreground, 0 0% 100%)));
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
}

.dark {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
}

body {
  overflow: hidden;
}

a {
  color: var(--color-brand-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  border: 1px solid var(--color-border-tertiary);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-background-secondary) 92%, transparent);
  color: var(--color-text-primary);
  padding: 6px 12px;
  cursor: default;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--color-border-tertiary);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-background-primary) 94%, transparent);
  color: var(--color-text-primary);
  padding: 8px 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border: 1px solid var(--color-border-tertiary);
  padding: 6px 8px;
}

pre,
code {
  font-family: var(--font-mono);
}

canvas,
svg,
img {
  max-width: 100%;
}
`
}

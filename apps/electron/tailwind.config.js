/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'Inter', 'sans-serif'],
        mono: ['"Fira Code"', '"Cascadia Code"', '"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      borderRadius: {
        'anthropic': '24px',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        // 语义/主题 token：此前以 arbitrary class（bg-[hsl(var(--x))]）散落使用，
        // 统一注册进主题后可用 bg-status-success-soft / text-brand-soft-foreground 等具名 class，
        // 生成的 CSS 与原 arbitrary 写法完全一致，仅提升可读性、补全与换主题一致性。
        'brand-soft': 'hsl(var(--brand-soft))',
        'brand-soft-hover': 'hsl(var(--brand-soft-hover))',
        'brand-soft-foreground': 'hsl(var(--brand-soft-foreground))',
        'chart-1': 'hsl(var(--chart-1))',
        'code-surface': 'hsl(var(--code-surface))',
        'process-tone': 'hsl(var(--process-tone))',
        'workspace': 'hsl(var(--workspace))',
        'kila-accent': 'hsl(var(--kila-accent))',
        'kila-accent-muted': 'hsl(var(--kila-accent-muted))',
        'kila-link-chip-background': 'hsl(var(--kila-link-chip-background))',
        'kila-link-chip-hover': 'hsl(var(--kila-link-chip-hover))',
        'kila-link-chip-foreground': 'hsl(var(--kila-link-chip-foreground))',
        'kila-user-bubble': 'hsl(var(--kila-user-bubble))',
        'kila-user-bubble-foreground': 'hsl(var(--kila-user-bubble-foreground))',
        'status-success': 'hsl(var(--status-success))',
        'status-success-soft': 'hsl(var(--status-success-soft))',
        'status-success-foreground': 'hsl(var(--status-success-foreground))',
        'status-warning': 'hsl(var(--status-warning))',
        'status-warning-soft': 'hsl(var(--status-warning-soft))',
        'status-warning-foreground': 'hsl(var(--status-warning-foreground))',
        'status-danger': 'hsl(var(--status-danger))',
        'status-danger-soft': 'hsl(var(--status-danger-soft))',
        'status-danger-foreground': 'hsl(var(--status-danger-foreground))',
        'status-info': 'hsl(var(--status-info))',
        'status-info-soft': 'hsl(var(--status-info-soft))',
        'status-info-foreground': 'hsl(var(--status-info-foreground))',
      },
      keyframes: {
        'slide-in-from-top': {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-out-to-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'in': 'slide-in-from-top 0.3s ease-out',
        'out': 'slide-out-to-right 0.2s ease-in',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
}

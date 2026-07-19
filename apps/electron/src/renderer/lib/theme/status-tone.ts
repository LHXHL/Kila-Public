export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusToneClasses {
  icon: string
  text: string
  softText: string
  surface: string
  subtleSurface: string
  solid: string
  border: string
  progress: string
}

const STATUS_TONE_CLASSES: Record<StatusTone, StatusToneClasses> = {
  success: {
    icon: 'text-[hsl(var(--status-success))]',
    text: 'text-[hsl(var(--status-success-foreground))]',
    softText: 'text-[hsl(var(--status-success))]',
    surface: 'border-[hsl(var(--status-success)/0.28)] bg-[hsl(var(--status-success-soft))] text-[hsl(var(--status-success-foreground))]',
    subtleSurface: 'bg-[hsl(var(--status-success-soft))] text-[hsl(var(--status-success-foreground))]',
    solid: 'bg-[hsl(var(--status-success))] text-[hsl(var(--primary-foreground))]',
    border: 'border-l-[hsl(var(--status-success))]',
    progress: 'bg-[hsl(var(--status-success)/0.72)]',
  },
  warning: {
    icon: 'text-[hsl(var(--status-warning))]',
    text: 'text-[hsl(var(--status-warning-foreground))]',
    softText: 'text-[hsl(var(--status-warning))]',
    surface: 'border-[hsl(var(--status-warning)/0.28)] bg-[hsl(var(--status-warning-soft))] text-[hsl(var(--status-warning-foreground))]',
    subtleSurface: 'bg-[hsl(var(--status-warning-soft))] text-[hsl(var(--status-warning-foreground))]',
    solid: 'bg-[hsl(var(--status-warning))] text-[hsl(var(--primary-foreground))]',
    border: 'border-l-[hsl(var(--status-warning))]',
    progress: 'bg-[hsl(var(--status-warning)/0.72)]',
  },
  danger: {
    icon: 'text-[hsl(var(--status-danger))]',
    text: 'text-[hsl(var(--status-danger-foreground))]',
    softText: 'text-[hsl(var(--status-danger))]',
    surface: 'border-[hsl(var(--status-danger)/0.28)] bg-[hsl(var(--status-danger-soft))] text-[hsl(var(--status-danger-foreground))]',
    subtleSurface: 'bg-[hsl(var(--status-danger-soft))] text-[hsl(var(--status-danger-foreground))]',
    solid: 'bg-[hsl(var(--status-danger))] text-[hsl(var(--primary-foreground))]',
    border: 'border-l-[hsl(var(--status-danger))]',
    progress: 'bg-[hsl(var(--status-danger)/0.72)]',
  },
  info: {
    icon: 'text-[hsl(var(--status-info))]',
    text: 'text-[hsl(var(--status-info-foreground))]',
    softText: 'text-[hsl(var(--status-info))]',
    surface: 'border-[hsl(var(--status-info)/0.28)] bg-[hsl(var(--status-info-soft))] text-[hsl(var(--status-info-foreground))]',
    subtleSurface: 'bg-[hsl(var(--status-info-soft))] text-[hsl(var(--status-info-foreground))]',
    solid: 'bg-[hsl(var(--status-info))] text-[hsl(var(--primary-foreground))]',
    border: 'border-l-[hsl(var(--status-info))]',
    progress: 'bg-[hsl(var(--status-info)/0.72)]',
  },
  neutral: {
    icon: 'text-muted-foreground',
    text: 'text-muted-foreground',
    softText: 'text-muted-foreground',
    surface: 'border-border/60 bg-background/80 text-muted-foreground',
    subtleSurface: 'bg-muted/40 text-muted-foreground',
    solid: 'bg-accent text-accent-foreground',
    border: 'border-l-border/50',
    progress: 'bg-foreground/18',
  },
}

export function getStatusToneClasses(tone: StatusTone): StatusToneClasses {
  return STATUS_TONE_CLASSES[tone]
}

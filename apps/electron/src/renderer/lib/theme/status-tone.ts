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
    icon: 'text-status-success',
    text: 'text-status-success-foreground',
    softText: 'text-status-success',
    surface: 'border-[hsl(var(--status-success)/0.28)] bg-status-success-soft text-status-success-foreground',
    subtleSurface: 'bg-status-success-soft text-status-success-foreground',
    solid: 'bg-status-success text-primary-foreground',
    border: 'border-l-status-success',
    progress: 'bg-[hsl(var(--status-success)/0.72)]',
  },
  warning: {
    icon: 'text-status-warning',
    text: 'text-status-warning-foreground',
    softText: 'text-status-warning',
    surface: 'border-[hsl(var(--status-warning)/0.28)] bg-status-warning-soft text-status-warning-foreground',
    subtleSurface: 'bg-status-warning-soft text-status-warning-foreground',
    solid: 'bg-status-warning text-primary-foreground',
    border: 'border-l-status-warning',
    progress: 'bg-[hsl(var(--status-warning)/0.72)]',
  },
  danger: {
    icon: 'text-status-danger',
    text: 'text-status-danger-foreground',
    softText: 'text-status-danger',
    surface: 'border-[hsl(var(--status-danger)/0.28)] bg-status-danger-soft text-status-danger-foreground',
    subtleSurface: 'bg-status-danger-soft text-status-danger-foreground',
    solid: 'bg-status-danger text-primary-foreground',
    border: 'border-l-status-danger',
    progress: 'bg-[hsl(var(--status-danger)/0.72)]',
  },
  info: {
    icon: 'text-status-info',
    text: 'text-status-info-foreground',
    softText: 'text-status-info',
    surface: 'border-[hsl(var(--status-info)/0.28)] bg-status-info-soft text-status-info-foreground',
    subtleSurface: 'bg-status-info-soft text-status-info-foreground',
    solid: 'bg-status-info text-primary-foreground',
    border: 'border-l-status-info',
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

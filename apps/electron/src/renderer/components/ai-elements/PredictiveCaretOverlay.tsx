import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { CaretVisualState } from './use-predictive-caret'

interface PredictiveCaretOverlayProps {
  state: CaretVisualState
  className?: string
}

export function PredictiveCaretOverlay({
  state,
  className,
}: PredictiveCaretOverlayProps): React.ReactElement {
  const caretWidth = 2
  const tailWidth = Math.max(6, Math.round(14 * state.tailScale))
  const tailHeight = Math.max(4, Math.round(state.height * 0.42))
  const barX = state.x - caretWidth / 2
  const barY = state.y

  let tailLeft = barX - tailWidth + caretWidth
  if (state.tailDirection < 0) {
    tailLeft = barX + caretWidth
  } else if (state.tailDirection === 0) {
    tailLeft = barX - tailWidth / 2 + caretWidth / 2
  }

  const tailTop = state.y + state.height / 2 - tailHeight / 2
  const tailGradient = state.tailDirection < 0
    ? 'linear-gradient(90deg, hsl(var(--primary) / 0.26), hsl(var(--primary) / 0))'
    : state.tailDirection > 0
      ? 'linear-gradient(270deg, hsl(var(--primary) / 0.26), hsl(var(--primary) / 0))'
      : 'linear-gradient(90deg, hsl(var(--primary) / 0), hsl(var(--primary) / 0.22), hsl(var(--primary) / 0))'
  const tailTransformOrigin = state.tailDirection < 0
    ? 'left center'
    : state.tailDirection > 0
      ? 'right center'
      : 'center center'

  const transitionDuration = `${state.durationMs}ms`
  const sharedTransition = 'cubic-bezier(0.22, 1, 0.36, 1)'

  const tailStyle: CSSProperties = {
    width: `${tailWidth}px`,
    height: `${tailHeight}px`,
    opacity: state.visible ? state.tailOpacity : 0,
    background: tailGradient,
    filter: 'blur(4px)',
    transform: `translate3d(${tailLeft}px, ${tailTop}px, 0) scaleX(${state.tailScale})`,
    transformOrigin: tailTransformOrigin,
    transitionDuration,
    transitionTimingFunction: sharedTransition,
    transitionProperty: 'transform, opacity, width, height',
  }

  const barStyle: CSSProperties = {
    width: `${caretWidth}px`,
    height: `${state.height}px`,
    opacity: state.visible ? undefined : 0,
    backgroundColor: 'hsl(var(--primary))',
    boxShadow: '0 0 10px hsl(var(--primary) / 0.35)',
    transform: `translate3d(${barX}px, ${barY}px, 0)`,
    transitionDuration,
    transitionTimingFunction: sharedTransition,
    transitionProperty: 'transform, height',
  }

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <div className="absolute rounded-full" style={tailStyle} />
      <div
        className={cn('absolute rounded-full', state.visible && 'predictive-caret-bar')}
        style={barStyle}
      />
      <style>{`
        .predictive-caret-bar {
          animation: kila-predictive-caret-breathe 1.28s ease-in-out infinite;
        }

        @keyframes kila-predictive-caret-breathe {
          0%, 100% {
            opacity: 0.36;
            background-color: hsl(var(--primary) / 0.62);
            box-shadow: 0 0 2px hsl(var(--primary) / 0.10);
          }
          50% {
            opacity: 1;
            background-color: hsl(var(--primary));
            box-shadow: 0 0 13px hsl(var(--primary) / 0.46);
          }
        }
      `}</style>
    </div>
  )
}

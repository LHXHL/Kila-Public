export interface CaretSample {
  x: number
  y: number
  height: number
  ts: number
}

export interface CaretTarget {
  x: number
  y: number
  height: number
}

export interface PredictiveCaretMotionResult {
  currentTarget: CaretTarget
  predictedTarget: CaretTarget
  durationMs: number
  shouldSnap: boolean
  tailScale: number
  tailOpacity: number
  tailDirection: -1 | 0 | 1
}

interface ComputePredictiveCaretMotionInput {
  previousSample: CaretSample | null
  currentSample: CaretSample
  forceSnap?: boolean
  maxLeadPx?: number
  snapDistancePx?: number
}

const DEFAULT_MAX_LEAD_PX = 12
const DEFAULT_SNAP_DISTANCE_PX = 48
const MIN_DT_MS = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function computePredictiveCaretMotion({
  previousSample,
  currentSample,
  forceSnap = false,
  maxLeadPx = DEFAULT_MAX_LEAD_PX,
  snapDistancePx = DEFAULT_SNAP_DISTANCE_PX,
}: ComputePredictiveCaretMotionInput): PredictiveCaretMotionResult {
  const currentTarget: CaretTarget = {
    x: currentSample.x,
    y: currentSample.y,
    height: currentSample.height,
  }

  if (!previousSample || forceSnap) {
    return {
      currentTarget,
      predictedTarget: currentTarget,
      durationMs: 0,
      shouldSnap: true,
      tailScale: 0.2,
      tailOpacity: 0.08,
      tailDirection: 0,
    }
  }

  const dx = currentSample.x - previousSample.x
  const dy = currentSample.y - previousSample.y
  const dt = Math.max(MIN_DT_MS, currentSample.ts - previousSample.ts)
  const distance = Math.hypot(dx, dy)
  const horizontalDistance = Math.abs(dx)
  const horizontalSpeed = horizontalDistance / dt
  const overallSpeed = distance / dt
  const isVerticalJump = Math.abs(dy) > 0.5
  const isLargeJump = distance > snapDistancePx

  if (isVerticalJump || isLargeJump) {
    return {
      currentTarget,
      predictedTarget: currentTarget,
      durationMs: 0,
      shouldSnap: true,
      tailScale: isVerticalJump ? 0.18 : 0.24,
      tailOpacity: isVerticalJump ? 0.08 : 0.12,
      tailDirection: 0,
    }
  }

  let durationMs = 140
  let leadPx = clamp(horizontalSpeed * 2, 0, 0.75)

  if (dt < 40 || overallSpeed >= 0.55) {
    durationMs = 40
    leadPx = clamp(horizontalSpeed * 12, 0, maxLeadPx)
  } else if (dt < 120 || overallSpeed >= 0.12) {
    durationMs = 88
    leadPx = clamp(horizontalSpeed * 6, 0, maxLeadPx * 0.6)
  }

  const tailDirection = dx === 0 ? 0 : dx > 0 ? 1 : -1
  const predictedTarget: CaretTarget = {
    x: currentTarget.x + leadPx * tailDirection,
    y: currentTarget.y,
    height: currentTarget.height,
  }

  return {
    currentTarget,
    predictedTarget,
    durationMs,
    shouldSnap: false,
    tailScale: clamp(horizontalDistance / 14, 0.2, 1),
    tailOpacity: clamp(0.08 + horizontalSpeed * 0.18, 0.08, 0.34),
    tailDirection,
  }
}

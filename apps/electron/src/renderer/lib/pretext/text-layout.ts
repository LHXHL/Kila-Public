import { clearCache, layout, prepare } from '@chenglou/pretext'
import { PRETEXT_DEBUG, PRETEXT_ENABLED } from './config'

export interface MeasuredTextBlock {
  lineCount: number
  height: number
  didFallback: boolean
}

type WhiteSpaceMode = 'normal' | 'pre-wrap'

const preparedCache = new Map<string, ReturnType<typeof prepare>>()

function fallbackMeasureText(
  text: string,
  widthPx: number,
  lineHeightPx: number,
  whiteSpace: WhiteSpaceMode,
): MeasuredTextBlock {
  if (!text) {
    return { lineCount: 0, height: 0, didFallback: true }
  }

  const effectiveWidth = Math.max(1, widthPx)
  const charsPerLine = Math.max(8, Math.floor(effectiveWidth / 8))
  const normalized = whiteSpace === 'pre-wrap'
    ? text
    : text.replace(/\s+/g, ' ').trim()
  const explicitLines = (whiteSpace === 'pre-wrap' ? normalized : normalized || text).split('\n')

  const lineCount = explicitLines.reduce((sum, line) => {
    if (!line) return sum + 1
    return sum + Math.max(1, Math.ceil(line.length / charsPerLine))
  }, 0)

  return {
    lineCount,
    height: lineCount * Math.max(1, lineHeightPx),
    didFallback: true,
  }
}

function getPreparedText(text: string, font: string, whiteSpace: WhiteSpaceMode): ReturnType<typeof prepare> {
  const key = `${whiteSpace}:${font}:${text}`
  const existing = preparedCache.get(key)
  if (existing) return existing

  const preparedText = whiteSpace === 'pre-wrap'
    ? prepare(text, font, { whiteSpace: 'pre-wrap' })
    : prepare(text, font)

  preparedCache.set(key, preparedText)
  return preparedText
}

function measureTextBlock(
  text: string,
  widthPx: number,
  font: string,
  lineHeightPx: number,
  whiteSpace: WhiteSpaceMode,
): MeasuredTextBlock {
  if (!text) return { lineCount: 0, height: 0, didFallback: false }
  if (!PRETEXT_ENABLED || widthPx <= 0 || !font || lineHeightPx <= 0 || typeof document === 'undefined') {
    return fallbackMeasureText(text, widthPx, lineHeightPx, whiteSpace)
  }

  try {
    const preparedText = getPreparedText(text, font, whiteSpace)
    const result = layout(preparedText, widthPx, lineHeightPx)
    if (!Number.isFinite(result.height) || !Number.isFinite(result.lineCount)) {
      return fallbackMeasureText(text, widthPx, lineHeightPx, whiteSpace)
    }

    return {
      lineCount: result.lineCount,
      height: result.height,
      didFallback: false,
    }
  } catch (error) {
    if (PRETEXT_DEBUG) {
      console.warn('[pretext] measurement failed, using fallback', error)
    }
    return fallbackMeasureText(text, widthPx, lineHeightPx, whiteSpace)
  }
}

export function measurePreWrapText(input: {
  text: string
  widthPx: number
  font: string
  lineHeightPx: number
}): MeasuredTextBlock {
  return measureTextBlock(input.text, input.widthPx, input.font, input.lineHeightPx, 'pre-wrap')
}

export function measureNormalText(input: {
  text: string
  widthPx: number
  font: string
  lineHeightPx: number
}): MeasuredTextBlock {
  return measureTextBlock(input.text, input.widthPx, input.font, input.lineHeightPx, 'normal')
}

export function clearPretextMeasurementCache(): void {
  preparedCache.clear()
  clearCache()
}

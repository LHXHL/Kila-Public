/**
 * OverlayScrollbarArea — OverlayScrollbars 封装组件
 *
 * 替代原生滚动条，提供 overlay 样式的自定义滚动条。
 * 自动适配 light/dark 主题（通过 .dark class 检测）。
 */

import * as React from 'react'
import { useOverlayScrollbars } from 'overlayscrollbars-react'
import type { PartialOptions } from 'overlayscrollbars'
import { cn } from '@/lib/utils'

const defaultOptions: PartialOptions = {
  scrollbars: {
    autoHide: 'move',
    autoHideDelay: 500,
    autoHideSuspend: true,
  },
  overflow: {
    x: 'hidden',
    y: 'scroll',
  },
  paddingAbsolute: false,
}

export interface OverlayScrollbarAreaProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  options?: PartialOptions
  defer?: boolean
}

function mergeOptions(options?: PartialOptions): PartialOptions {
  return {
    ...defaultOptions,
    ...options,
    scrollbars: {
      ...defaultOptions.scrollbars,
      ...options?.scrollbars,
    },
    overflow: {
      ...defaultOptions.overflow,
      ...options?.overflow,
    },
  }
}

function resolveFallbackOverflow(
  axis: 'x' | 'y',
  value: NonNullable<PartialOptions['overflow']>[typeof axis] | undefined,
): React.CSSProperties['overflowX' | 'overflowY'] {
  if (value === 'visible') return 'visible'
  if (value === 'scroll') return 'auto'
  return 'hidden'
}

/**
 * OverlayScrollbarArea — 通用 overlay 滚动容器
 *
 * 默认隐藏横向滚动，鼠标移动时显示纵向滚动条。
 * `defer` 为 true 时延迟初始化（用于 StickToBottom 等需要先 mount 的场景）。
 */
export function OverlayScrollbarArea({
  children,
  className,
  style,
  options,
  defer,
}: OverlayScrollbarAreaProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const mergedOptions = React.useMemo(() => mergeOptions(options), [options])
  const [initialize, osInstance] = useOverlayScrollbars({
    options: mergedOptions,
    defer,
  })

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let frameId: number | null = null
    let resizeObserver: ResizeObserver | null = null

    const tryInitialize = (): boolean => {
      if (osInstance()) return true
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return false
      initialize(host)
      return true
    }

    if (tryInitialize()) {
      return
    }

    frameId = window.requestAnimationFrame(() => {
      if (tryInitialize()) {
        resizeObserver?.disconnect()
      }
    })

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (tryInitialize()) {
          resizeObserver?.disconnect()
        }
      })
      resizeObserver.observe(host)
    }

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId)
      }
      resizeObserver?.disconnect()
    }
  }, [initialize, osInstance])

  const fallbackOverflowStyle = React.useMemo<React.CSSProperties>(() => ({
    overflowX: resolveFallbackOverflow('x', mergedOptions.overflow?.x),
    overflowY: resolveFallbackOverflow('y', mergedOptions.overflow?.y),
  }), [mergedOptions])

  return (
    <div
      ref={hostRef}
      className={cn('os-kila min-h-0 min-w-0', className)}
      style={{
        ...fallbackOverflowStyle,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

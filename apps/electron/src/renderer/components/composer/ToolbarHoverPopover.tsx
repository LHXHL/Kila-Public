import * as React from 'react'
import type { PopoverContentProps } from '@radix-ui/react-popover'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

type OpenReason = 'hover' | 'click' | null
type TriggerButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ref: React.Ref<HTMLButtonElement>
}

interface ToolbarHoverPopoverProps {
  trigger: (props: {
    open: boolean
    triggerProps: TriggerButtonProps
  }) => React.ReactElement
  children: (props: { open: boolean; close: () => void }) => React.ReactNode
  contentClassName?: string
  side?: PopoverContentProps['side']
  align?: PopoverContentProps['align']
  sideOffset?: number
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}

export function ToolbarHoverPopover({
  trigger,
  children,
  contentClassName,
  side = 'top',
  align = 'center',
  sideOffset = 8,
  onOpenChange,
  disabled = false,
}: ToolbarHoverPopoverProps): React.ReactElement {
  const closeDelayMs = 100
  const [openReason, setOpenReason] = React.useState<OpenReason>(null)
  const closeTimerRef = React.useRef<number | null>(null)
  const onOpenChangeRef = React.useRef(onOpenChange)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const open = openReason !== null

  onOpenChangeRef.current = onOpenChange

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const close = React.useCallback(() => {
    clearCloseTimer()
    setOpenReason(null)
  }, [clearCloseTimer])

  React.useEffect(() => {
    onOpenChangeRef.current?.(open)
  }, [open])

  React.useEffect(() => () => {
    clearCloseTimer()
  }, [clearCloseTimer])

  const isMovingWithinHoverLayer = React.useCallback((relatedTarget: EventTarget | null) => {
    if (!(relatedTarget instanceof Node)) return false
    return Boolean(
      triggerRef.current?.contains(relatedTarget)
      || contentRef.current?.contains(relatedTarget),
    )
  }, [])

  const scheduleClose = React.useCallback(() => {
    if (openReason !== 'hover') return
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      setOpenReason((current) => (current === 'hover' ? null : current))
      closeTimerRef.current = null
    }, closeDelayMs)
  }, [clearCloseTimer, openReason])

  const handlePointerEnter = React.useCallback(() => {
    if (disabled) return
    clearCloseTimer()
    if (!openReason) {
      setOpenReason('hover')
    }
  }, [clearCloseTimer, disabled, openReason])

  const handleTriggerPointerLeave = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (isMovingWithinHoverLayer(event.relatedTarget)) {
      clearCloseTimer()
      return
    }
    scheduleClose()
  }, [clearCloseTimer, isMovingWithinHoverLayer, scheduleClose])

  const handleContentPointerEnter = React.useCallback(() => {
    clearCloseTimer()
  }, [clearCloseTimer])

  const handleContentPointerLeave = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isMovingWithinHoverLayer(event.relatedTarget)) {
      clearCloseTimer()
      return
    }
    scheduleClose()
  }, [clearCloseTimer, isMovingWithinHoverLayer, scheduleClose])

  const handleTriggerClick = React.useCallback(() => {
    if (disabled) return
    clearCloseTimer()
    if (!openReason) {
      setOpenReason('click')
      return
    }
    if (openReason === 'click') {
      setOpenReason(null)
      return
    }
    setOpenReason('click')
  }, [clearCloseTimer, disabled, openReason])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      close()
    }
  }, [close])

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverAnchor asChild>
        {trigger({
          open,
          triggerProps: {
            ref: triggerRef,
            onPointerEnter: handlePointerEnter,
            onPointerLeave: handleTriggerPointerLeave,
            onClick: handleTriggerClick,
            'aria-expanded': open,
            disabled,
          },
        })}
      </PopoverAnchor>

      {!disabled && (
        <PopoverContent
          ref={contentRef}
          side={side}
          align={align}
          sideOffset={sideOffset}
          className={contentClassName}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={handleContentPointerEnter}
          onPointerLeave={handleContentPointerLeave}
        >
          {children({ open, close })}
        </PopoverContent>
      )}
    </Popover>
  )
}

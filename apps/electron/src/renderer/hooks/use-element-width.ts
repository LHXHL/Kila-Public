import * as React from 'react'

export function useElementWidth<T extends HTMLElement>(): {
  element: T | null
  width: number
  setElement: (node: T | null) => void
} {
  const [element, setElement] = React.useState<T | null>(null)
  const [width, setWidth] = React.useState(0)

  React.useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') {
      setWidth(0)
      return
    }

    const update = (): void => {
      const nextWidth = element.clientWidth || element.getBoundingClientRect().width || 0
      setWidth(nextWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [element])

  return { element, width, setElement }
}

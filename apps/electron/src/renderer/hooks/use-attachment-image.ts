import * as React from 'react'

export type AttachmentImageLoadState = 'loading' | 'loaded' | 'error'

/**
 * 从主进程读取附件图片，并统一处理卸载竞态、解码失败和手动重试。
 */
export function useAttachmentImage(localPath: string, mediaType: string, enabled = true): {
  imageSrc: string | null
  loadState: AttachmentImageLoadState
  retry: () => void
  markError: () => void
} {
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [loadState, setLoadState] = React.useState<AttachmentImageLoadState>('loading')
  const [retryVersion, setRetryVersion] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    setImageSrc(null)
    if (!enabled) {
      setLoadState('loaded')
      return () => {
        cancelled = true
      }
    }
    setLoadState('loading')

    window.electronAPI.readAttachment(localPath)
      .then((base64) => {
        if (cancelled) return
        setImageSrc(`data:${mediaType};base64,${base64}`)
        setLoadState('loaded')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[AttachmentImage] 读取附件失败:', error)
        setLoadState('error')
      })

    return () => {
      cancelled = true
    }
  }, [enabled, localPath, mediaType, retryVersion])

  return {
    imageSrc,
    loadState,
    retry: React.useCallback(() => setRetryVersion((value) => value + 1), []),
    markError: React.useCallback(() => setLoadState('error'), []),
  }
}

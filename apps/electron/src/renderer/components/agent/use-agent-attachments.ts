import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { AgentPendingFile } from '@kila/shared'
import { fileToBase64 } from '@/lib/file-utils'

interface UseAgentAttachmentsInput {
  sessionId: string
  pendingFiles: AgentPendingFile[]
  setPendingFiles: React.Dispatch<React.SetStateAction<AgentPendingFile[]>>
  attachedDirectories: string[]
  onAttachedDirectoriesChange: (directories: string[]) => void
}

interface UseAgentAttachmentsResult {
  pendingFilesRef: React.MutableRefObject<AgentPendingFile[]>
  isDragOver: boolean
  dragFolderNotice: string | null
  dismissDragFolderNotice: () => void
  handleOpenFileDialog: () => Promise<void>
  handleRemoveFile: (id: string) => void
  handlePasteFiles: (files: File[]) => void
  handleDragOver: (event: React.DragEvent) => void
  handleDragLeave: (event: React.DragEvent) => void
  handleDrop: (event: React.DragEvent) => Promise<void>
}

/** 为附件生成会话内唯一文件名，避免保存到 Session 目录时相互覆盖。 */
export function makeUniqueAttachmentFilename(originalName: string, existingNames: string[]): string {
  if (!existingNames.includes(originalName)) return originalName
  const dotIndex = originalName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? originalName.slice(0, dotIndex) : originalName
  const extension = dotIndex > 0 ? originalName.slice(dotIndex) : ''
  let counter = 1
  while (existingNames.includes(`${baseName}-${counter}${extension}`)) {
    counter += 1
  }
  return `${baseName}-${counter}${extension}`
}

function createPendingFile(input: {
  filename: string
  mediaType: string
  size: number
  previewUrl?: string
}): AgentPendingFile {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filename: input.filename,
    mediaType: input.mediaType || 'application/octet-stream',
    size: input.size,
    previewUrl: input.previewUrl,
  }
}

export function useAgentAttachments(input: UseAgentAttachmentsInput): UseAgentAttachmentsResult {
  const { t } = useTranslation()
  const {
    sessionId,
    pendingFiles,
    setPendingFiles,
    attachedDirectories,
    onAttachedDirectoriesChange,
  } = input
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [dragFolderNotice, setDragFolderNotice] = React.useState<string | null>(null)
  const pendingFilesRef = React.useRef(pendingFiles)
  const noticeTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  React.useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const appendPendingFile = React.useCallback((pending: AgentPendingFile, data: string): void => {
    if (!window.__pendingAgentFileData) {
      window.__pendingAgentFileData = new Map<string, string>()
    }
    window.__pendingAgentFileData.set(pending.id, data)
    setPendingFiles((previous) => {
      const next = [...previous, pending]
      pendingFilesRef.current = next
      return next
    })
  }, [setPendingFiles])

  const showFolderNotice = React.useCallback((message: string): void => {
    setDragFolderNotice(message)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => {
      setDragFolderNotice(null)
      noticeTimerRef.current = null
    }, 4_000)
  }, [])

  const addFilesAsAttachments = React.useCallback(async (files: File[]): Promise<void> => {
    const usedNames = pendingFilesRef.current.map((file) => file.filename)
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)
        const filename = makeUniqueAttachmentFilename(file.name, usedNames)
        usedNames.push(filename)
        appendPendingFile(createPendingFile({
          filename,
          mediaType: file.type,
          size: file.size,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        }), base64)
      } catch (cause) {
        console.error('[Agent 附件] 添加失败:', cause)
        toast.error(t('agent.attachment.addFailed', { filename: file.name }))
      }
    }
  }, [appendPendingFile, t])

  const handleOpenFileDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      const usedNames = pendingFilesRef.current.map((file) => file.filename)
      for (const fileInfo of result.files) {
        const filename = makeUniqueAttachmentFilename(fileInfo.filename, usedNames)
        usedNames.push(filename)
        appendPendingFile(createPendingFile({
          filename,
          mediaType: fileInfo.mediaType,
          size: fileInfo.size,
          previewUrl: fileInfo.mediaType.startsWith('image/')
            ? `data:${fileInfo.mediaType};base64,${fileInfo.data}`
            : undefined,
        }), fileInfo.data)
      }
    } catch (cause) {
      console.error('[Agent 附件] 文件选择失败:', cause)
      toast.error(t('agent.attachment.openDialogFailed'))
    }
  }, [appendPendingFile, t])

  const handleRemoveFile = React.useCallback((id: string): void => {
    setPendingFiles((previous) => {
      const file = previous.find((candidate) => candidate.id === id)
      if (file?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl)
      window.__pendingAgentFileData?.delete(id)
      const next = previous.filter((candidate) => candidate.id !== id)
      pendingFilesRef.current = next
      return next
    })
  }, [setPendingFiles])

  const handlePasteFiles = React.useCallback((files: File[]): void => {
    void addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  const handleDragOver = React.useCallback((event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback(async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)

    const regularFiles: File[] = []
    const directoryPaths: string[] = []
    for (const item of Array.from(event.dataTransfer.items)) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      const file = item.getAsFile()
      if (entry?.isDirectory) {
        const directoryPath = (file as (File & { path?: string }) | null)?.path
        if (directoryPath) directoryPaths.push(directoryPath)
      } else if (file) {
        regularFiles.push(file)
      }
    }

    if (directoryPaths.length > 0) {
      try {
        let nextDirectories = attachedDirectories
        for (const directoryPath of directoryPaths) {
          nextDirectories = await window.electronAPI.attachDirectory({ sessionId, directoryPath })
        }
        onAttachedDirectoriesChange(nextDirectories)
        showFolderNotice(t('agent.attachment.folderAttached', { count: directoryPaths.length }))
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        console.error('[Agent 附件] 拖拽附加文件夹失败:', cause)
        showFolderNotice(t('agent.attachment.folderAttachFailed', { message }))
      }
    }

    if (regularFiles.length > 0) {
      await addFilesAsAttachments(regularFiles)
    }
  }, [addFilesAsAttachments, attachedDirectories, onAttachedDirectoriesChange, sessionId, showFolderNotice, t])

  const dismissDragFolderNotice = React.useCallback((): void => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = null
    }
    setDragFolderNotice(null)
  }, [])

  return {
    pendingFilesRef,
    isDragOver,
    dragFolderNotice,
    dismissDragFolderNotice,
    handleOpenFileDialog,
    handleRemoveFile,
    handlePasteFiles,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}

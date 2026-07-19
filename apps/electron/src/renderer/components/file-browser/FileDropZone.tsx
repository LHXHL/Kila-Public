/**
 * FileDropZone — 文件拖拽上传区域
 *
 * 引导用户通过拖拽或点击将文件添加到当前 session.project 目录。
 * 文件上传后直接保存到项目目录，FileBrowser 通过版本号自动刷新。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Upload, File, FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fileToBase64 } from '@/lib/file-utils'

interface FileDropZoneProps {
  /** 当前会话 ID */
  sessionId: string
  /** 上传成功后的回调（触发文件浏览器刷新） */
  onFilesUploaded: () => void
  /** 附加文件夹回调 */
  onAttachFolder?: () => void
  /** 拖拽区说明文案 */
  descriptionText?: string
  /** 选择文件 tooltip 文案 */
  selectTooltipText?: string
  /** 附加文件夹 tooltip 文案 */
  attachTooltipText?: string
}

export function FileDropZone({
  sessionId,
  onFilesUploaded,
  onAttachFolder,
  descriptionText,
  selectTooltipText,
  attachTooltipText,
}: FileDropZoneProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState<{ completed: number; total: number; phase: 'reading' | 'saving' } | null>(null)

  const resolvedDescriptionText = descriptionText ?? '当前会话项目文件夹内可访问'
  const resolvedSelectTooltipText = selectTooltipText ?? '添加文件到当前会话项目文件夹'
  const resolvedAttachTooltipText = attachTooltipText ?? '切换当前会话的项目文件夹'

  /** 保存文件到目标目录 */
  const saveFiles = React.useCallback(async (files: globalThis.File[]): Promise<void> => {
    if (files.length === 0) return

    setIsUploading(true)
    setUploadProgress({ completed: 0, total: files.length, phase: 'reading' })
    try {
      const fileEntries: Array<{ filename: string; data: string }> = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!
        const base64 = await fileToBase64(file)
        fileEntries.push({ filename: file.name, data: base64 })
        setUploadProgress({ completed: index + 1, total: files.length, phase: 'reading' })
      }

      setUploadProgress({ completed: files.length, total: files.length, phase: 'saving' })
      await window.electronAPI.saveFilesToSessionProject({
        sessionId,
        files: fileEntries,
      })

      onFilesUploaded()
      toast.success(`已添加 ${files.length} 个文件`)
    } catch (error) {
      console.error('[FileDropZone] 文件上传失败:', error)
      toast.error('文件上传失败')
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
    }
  }, [onFilesUploaded, sessionId])

  // ===== 拖拽处理 =====

  const handleDragOver = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const items = Array.from(e.dataTransfer.items)
    const regularFiles: globalThis.File[] = []
    let hasFolders = false

    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        hasFolders = true
      } else {
        const file = item.getAsFile()
        if (file) regularFiles.push(file)
      }
    }

    if (hasFolders) {
      toast.info('不支持拖拽文件夹', { description: '请使用「附加文件夹」按钮' })
    }

    if (regularFiles.length > 0) {
      await saveFiles(regularFiles)
    }
  }, [saveFiles])

  // ===== 按钮点击处理 =====

  const handleSelectFiles = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      setIsUploading(true)
      setUploadProgress({ completed: result.files.length, total: result.files.length, phase: 'saving' })
      const fileEntries = result.files.map((f) => ({
        filename: f.filename,
        data: f.data,
      }))

      await window.electronAPI.saveFilesToSessionProject({
        sessionId,
        files: fileEntries,
      })

      onFilesUploaded()
      toast.success(`已添加 ${result.files.length} 个文件`)
    } catch (error) {
      console.error('[FileDropZone] 选择文件失败:', error)
      toast.error('文件上传失败')
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
    }
  }, [onFilesUploaded, sessionId])

  return (
    <div className="flex-shrink-0 px-3 pt-3 pb-1">
      <div
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-4',
          'transition-colors duration-200 cursor-default',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/20 hover:border-muted-foreground/40',
          isUploading && 'pointer-events-none opacity-60',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <>
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
            <span role="status" className="text-xs text-muted-foreground">
              {uploadProgress?.phase === 'reading'
                ? `正在读取 ${uploadProgress.completed}/${uploadProgress.total}`
                : `正在保存 ${uploadProgress?.total ?? 0} 个文件…`}
            </span>
          </>
        ) : (
          <>
            <Upload className={cn(
              'size-5 transition-colors',
              isDragOver ? 'text-primary' : 'text-muted-foreground/60',
            )} />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              拖拽文件到此处
              <br />
              <span className="text-[10px] text-muted-foreground/60">
                {resolvedDescriptionText}
              </span>
            </p>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 gap-1"
                    onClick={handleSelectFiles}
                  >
                    <File className="size-3" />
                    选择文件
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{resolvedSelectTooltipText}</p>
                </TooltipContent>
              </Tooltip>
              {onAttachFolder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[11px] px-2 gap-1"
                      onClick={onAttachFolder}
                    >
                      <FolderPlus className="size-3" />
                      附加文件夹
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{resolvedAttachTooltipText}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * AttachmentPreviewItem - 附件预览卡片
 *
 * 图片：较大缩略图 + 文件名 + 文件大小
 * 非图片：图标 + 文件名 + 文件大小
 * hover 显示关闭按钮
 */

import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X, Paperclip, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AttachmentPreviewItemProps {
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** 文件大小（字节） */
  size?: number
  /** 本地预览 URL（blob URL / data URL，图片用） */
  previewUrl?: string
  /** 删除回调 */
  onRemove: () => void
  className?: string
}

/** 判断是否为图片类型 */
function isImage(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

/** 格式化文件大小 */
function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentPreviewItem({
  filename,
  mediaType,
  size,
  previewUrl,
  onRemove,
  className,
}: AttachmentPreviewItemProps): React.ReactElement {
  const { t } = useTranslation()
  const fileSizeStr = formatFileSize(size)

  if (isImage(mediaType) && previewUrl) {
    return (
      <div
        className={cn(
          'group/attachment relative rounded-xl overflow-hidden',
          'border border-border/40 bg-muted/30',
          'transition-all duration-200 hover:border-border/80 hover:shadow-sm',
          className,
        )}
      >
        {/* 图片缩略图 */}
        <div className="relative size-[100px]">
          <img
            src={previewUrl}
            alt={filename}
            className="size-full object-cover"
          />
          {/* 底部渐变遮罩 */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/50 to-transparent" />
          {/* 文件名 + 大小 */}
          <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5">
            <p className="text-[11px] text-white/90 truncate leading-tight">{filename}</p>
            {fileSizeStr && (
              <p className="text-[10px] text-white/60 leading-tight">{fileSizeStr}</p>
            )}
          </div>
          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('common.remove')}
            className={cn(
              'absolute top-1.5 right-1.5 size-[20px] rounded-full',
              'bg-black/50 text-white backdrop-blur-sm',
              'flex items-center justify-center',
              'opacity-0 group-hover/attachment:opacity-100 transition-opacity duration-200',
              'hover:bg-black/70',
            )}
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    )
  }

  // 文件预览
  return (
    <div
      className={cn(
        'group/attachment relative flex items-center gap-2.5 shrink-0',
        'rounded-lg border border-border/40 bg-muted/30',
        'pl-2.5 pr-8 py-2 text-[13px]',
        'transition-all duration-200 hover:border-border/80 hover:bg-muted/50',
        className,
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileText className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-foreground/90 leading-tight max-w-[160px]">{filename}</p>
        {fileSizeStr && (
          <p className="text-[11px] text-muted-foreground leading-tight">{fileSizeStr}</p>
        )}
      </div>
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('common.remove')}
        className={cn(
          'absolute top-1/2 right-2 -translate-y-1/2 size-[20px] rounded-full',
          'flex items-center justify-center',
          'text-muted-foreground/60 hover:bg-background hover:text-foreground',
          'opacity-0 group-hover/attachment:opacity-100 transition-all duration-200',
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

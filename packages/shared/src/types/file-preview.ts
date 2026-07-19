/**
 * Inline file preview types
 *
 * 供渲染进程右侧预览面板使用。
 */

export type InlineFilePreviewKind =
  | 'text'
  | 'code'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'unsupported'
  | 'too_large'
  | 'error'

export interface InlineFilePreview {
  filePath: string
  filename: string
  extension: string
  size: number
  kind: InlineFilePreviewKind
  mimeType?: string
  textContent?: string
  dataUrl?: string
  errorMessage?: string
}

export interface SessionWebPreviewServerInfo {
  sessionId: string
  rootPath: string
  baseUrl: string
}

export interface SessionHtmlPreviewResolution extends SessionWebPreviewServerInfo {
  filePath: string
  url: string
}

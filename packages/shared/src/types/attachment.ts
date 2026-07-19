/**
 * Session attachment types.
 */

/** 文件附件 */
export interface FileAttachment {
  /** 附件唯一标识 */
  id: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** 存储路径：兼容旧相对路径或新的 session working directory 绝对路径 */
  localPath: string
  /** 文件大小（字节） */
  size: number
  /** base64 内联数据（粘贴图片等场景，直接传递给 AI 避免磁盘读取失败） */
  inlineData?: string
}

/** 保存附件输入 */
export interface AttachmentSaveInput {
  /** 旧字段名，运行时传入 sessionId */
  conversationId: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** base64 编码的文件数据 */
  data: string
}

/** 保存附件结果 */
export interface AttachmentSaveResult {
  /** 保存后的附件信息 */
  attachment: FileAttachment
}

/** 文件选择对话框结果 */
export interface FileDialogResult {
  /** 选择的文件列表 */
  files: Array<{
    filename: string
    mediaType: string
    data: string
    size: number
  }>
}

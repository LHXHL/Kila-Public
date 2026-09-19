/** Runtime transfer bundle 文件协议（主进程与 Utility Runtime 共用）。 */

export type RuntimeTransferFileKind = 'bootstrap' | 'tools' | 'image' | 'attachment' | 'tool-result'

export interface RuntimeTransferManifestFileV1 {
  relativePath: string
  size: number
  sha256: string
  kind: RuntimeTransferFileKind
}

export interface RuntimeTransferManifestV1 {
  version: 1
  appBootId: string
  sessionId: string
  runId: string
  generation: number
  createdAt: number
  expiresAt: number
  files: RuntimeTransferManifestFileV1[]
  totalSize: number
}

export interface RuntimeTransferBundleReferenceV1 {
  bundlePath: string
  manifestSha256: string
  configRevision: number
}

/** Runtime 在 bundle 内读取图片后，才在 Utility 进程中编码为 Pi ImageContent。 */
export interface RuntimePromptImageReferenceV1 {
  relativePath: string
  filename: string
  mediaType: string
}

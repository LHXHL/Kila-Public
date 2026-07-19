/// <reference types="vite/client" />

// CSS 模块类型声明
declare module '*.css' {
  const content: Record<string, string>
  export default content
}

/** 更新状态（与 updater-types.ts 保持一致） */
interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
  version?: string
  releaseNotes?: string
  error?: string
}

/** 更新 API（仅版本检测，不自动下载/安装） */
interface UpdaterAPI {
  checkForUpdates: () => Promise<void>
  getStatus: () => Promise<UpdateStatus>
  onStatusChanged: (callback: (status: UpdateStatus) => void) => () => void
}

// 附件临时 base64 缓存（用于发送前暂存数据）
interface Window {
  __pendingAttachmentData?: Map<string, string>
  __pendingAgentFileData?: Map<string, string>
}

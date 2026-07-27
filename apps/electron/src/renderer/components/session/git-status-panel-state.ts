/** Git 面板错误提示的翻译函数签名（由调用方注入，保持本模块纯函数可测） */
export type GitPanelErrorTranslator = (key: string) => string

/** 清理 Electron invoke 包装，并将常见 Git 故障转换为可操作的用户提示。 */
export function formatGitPanelError(caught: unknown, translate: GitPanelErrorTranslator): string {
  const raw = caught instanceof Error ? caught.message : String(caught)
  const withoutInvokeWrapper = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  const normalized = withoutInvokeWrapper.replace(/^(?:Error:\s*)+/i, '').trim()

  if (!normalized) return translate('session.git.error.readFailed')
  if (/not a git repository/i.test(normalized)) return translate('session.git.error.notRepository')
  if (/ENOENT|not recognized as an internal or external command/i.test(normalized)) {
    return translate('session.git.error.gitNotFound')
  }
  return normalized
}

/** 清理 Electron invoke 包装，并将常见 Git 故障转换为可操作的用户提示。 */
export function formatGitPanelError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught)
  const withoutInvokeWrapper = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  const normalized = withoutInvokeWrapper.replace(/^(?:Error:\s*)+/i, '').trim()

  if (!normalized) return '读取 Git 状态失败，请稍后重试。'
  if (/not a git repository/i.test(normalized)) return '当前目录不是 Git 仓库，请重新检测或初始化仓库。'
  if (/ENOENT|not recognized as an internal or external command/i.test(normalized)) return '未找到 Git，请先安装 Git 并重新启动 Kila。'
  return normalized
}

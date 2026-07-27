/**
 * 文件预览窗口安全回归测试
 *
 * 覆盖两处历史问题：
 * 1. 页面脚本把路径拼进 document.title，主进程解析后直接 shell.openPath，
 *    被预览的 HTML/Markdown 可诱导主进程用系统默认应用打开任意本地文件
 * 2. 预览页面无 CSP，注入的内联事件处理器可以执行
 */

import { describe, expect, mock, test } from 'bun:test'

mock.module('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp' },
  BrowserWindow: Object.assign(class {}, { getFocusedWindow: () => null, fromWebContents: () => null }),
  shell: { openPath: () => {}, showItemInFolder: () => {}, openExternal: () => {} },
  nativeTheme: { shouldUseDarkColors: false },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
  ipcMain: { handle: () => {}, on: () => {} },
  session: { fromPartition: () => ({}) },
  clipboard: { writeText: () => {} },
}))

/** 延迟到用例内导入，确保 electron mock 已注册 */
async function loadPreviewService() {
  return import('./file-preview-service')
}

describe('预览窗口 title 动作通道', () => {
  test('Given 无参动作 title，When 主进程解析，Then 识别为对当前预览文件的操作', async () => {
    const { parsePreviewTitleAction } = await loadPreviewService()

    expect(parsePreviewTitleAction('__preview_action__:open')).toBe('open')
    expect(parsePreviewTitleAction('__preview_action__:folder')).toBe('folder')
  })

  test('Given title 中携带任意路径，When 主进程解析，Then 一律忽略', async () => {
    const { parsePreviewTitleAction } = await loadPreviewService()

    expect(parsePreviewTitleAction('__preview_action__:open:/Users/x/.ssh/id_rsa')).toBeNull()
    expect(parsePreviewTitleAction('__preview_action__:folder:/etc')).toBeNull()
    expect(parsePreviewTitleAction('__preview_action__:open:C:\\Windows\\System32\\calc.exe')).toBeNull()
    expect(parsePreviewTitleAction('__preview_action__:exec:/bin/sh')).toBeNull()
  })

  test('Given 普通页面标题，When 主进程解析，Then 不触发任何动作', async () => {
    const { parsePreviewTitleAction } = await loadPreviewService()

    expect(parsePreviewTitleAction('report.md')).toBeNull()
    expect(parsePreviewTitleAction('')).toBeNull()
  })

  test('Given 工具栏脚本，When 检查其发出的 title，Then 不含任何文件路径', async () => {
    const { __previewInternals } = await loadPreviewService()

    const script = __previewInternals.TOOLBAR_SCRIPT
    expect(script).toContain("document.title='__preview_action__:open'")
    expect(script).toContain("document.title='__preview_action__:folder'")
    // 旧实现形如 `'__preview_action__:open:' + filePath`
    expect(script).not.toContain('filePath')
    expect(script).not.toContain("open:' +")
  })
})

describe('预览页面 CSP', () => {
  test('Given 仅内联脚本的页面，When 构建 CSP，Then 只允许对应哈希且禁止其它一切来源', async () => {
    const { buildPreviewCsp, __previewInternals } = await loadPreviewService()

    const hash = __previewInternals.scriptHash(__previewInternals.TOOLBAR_SCRIPT)
    const csp = buildPreviewCsp({ scriptHashes: [hash] })

    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain(`script-src 'sha256-${hash}'`)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    // 没有 'unsafe-inline' 才能拦下注入内容里的 onerror / onclick
    expect(csp).not.toContain("script-src 'unsafe-inline'")
    expect(csp).not.toContain('script-src * ')
    // 未开启 CDN 时不得出现任何外部源
    expect(csp).not.toContain('https://cdn.jsdelivr.net')
  })

  test('Given 需要外部库的页面，When 构建 CSP，Then 只放行 jsDelivr 且脚本仍禁用内联', async () => {
    const { buildPreviewCsp } = await loadPreviewService()
    const csp = buildPreviewCsp({ scriptHashes: ['abc'], allowCdn: true })

    expect(csp).toContain("script-src 'sha256-abc' https://cdn.jsdelivr.net")
    expect(csp).not.toContain("script-src 'unsafe-inline'")
  })

  test('Given 没有内联脚本的页面，When 构建 CSP，Then script-src 为 none', async () => {
    const { buildPreviewCsp } = await loadPreviewService()
    expect(buildPreviewCsp({ scriptHashes: [] })).toContain("script-src 'none'")
  })

  test('Given PDF 页面，When 构建 CSP，Then 额外放行本地 fetch 与 worker', async () => {
    const { buildPreviewCsp } = await loadPreviewService()
    const csp = buildPreviewCsp({ scriptHashes: ['abc'], allowCdn: true, allowFileFetch: true })

    expect(csp).toContain('connect-src file: data: blob: https://cdn.jsdelivr.net')
    expect(csp).toContain('worker-src blob: https://cdn.jsdelivr.net')
  })
})

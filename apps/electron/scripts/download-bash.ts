#!/usr/bin/env bun
/**
 * Windows bash 二进制下载脚本
 *
 * 下载 busybox-w32 作为 Windows 平台的轻量 bash runtime。
 * busybox-w32 是单个可执行文件（~3MB），提供 bash、sh 和常用 Unix 工具。
 * 放入 vendor/bash/win32-x64/ 目录，打包时分发。
 *
 * 使用：
 * bun run scripts/download-bash.ts [--force]
 */

import { existsSync, mkdirSync, chmodSync, rmSync } from 'fs'
import { join, dirname } from 'path'

const SCRIPT_DIR = dirname(Bun.main)
const VENDOR_DIR = join(SCRIPT_DIR, '..', 'vendor', 'bash', 'win32-x64')

// busybox-w32 稳定版
const BUSYBOX_VERSION = '1.36.1-5'
const BUSYBOX_URL = `https://frippery.org/files/busybox/busybox.exe`
const BUSYBOX_SHA256_URL = `https://frippery.org/files/busybox/busybox.exe.sha256`

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`  下载中: ${url}`)

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Kila-Build-Script/1.0' },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }

  const dir = dirname(destPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const arrayBuffer = await response.arrayBuffer()
  await Bun.write(destPath, arrayBuffer)
  console.log(`  已保存到: ${destPath} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`)
}

async function main(): Promise<void> {
  console.log('='.repeat(50))
  console.log('Kila Windows bash (busybox-w32) 下载脚本')
  console.log('='.repeat(50))

  const destPath = join(VENDOR_DIR, 'bash.exe')
  const force = process.argv.includes('--force')

  if (!force && existsSync(destPath)) {
    console.log('\n  bash.exe 已存在，跳过下载（使用 --force 重新下载）')
    return
  }

  if (!existsSync(VENDOR_DIR)) {
    mkdirSync(VENDOR_DIR, { recursive: true })
  }

  try {
    await downloadFile(BUSYBOX_URL, destPath)

    // 验证可执行
    try {
      const proc = Bun.spawn([destPath, ['--help']], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const code = await proc.exited
      if (code !== 0 && code !== 1) {
        // busybox --help 返回 1 是正常的
        console.warn('  ⚠️ bash.exe 验证返回非预期退出码，但不影响使用')
      }
    } catch (err) {
      console.warn('  ⚠️ 无法在本地验证（当前平台可能不是 Windows）:', err)
    }

    console.log('\n  ✅ bash.exe 下载完成')
  } catch (error) {
    console.error('\n  ❌ 下载失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()

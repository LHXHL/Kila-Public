#!/usr/bin/env bun
/**
 * Windows bash 二进制下载脚本
 *
 * 下载 busybox-w32 的 64 位 Unicode 构建（busybox-w64u）作为 Windows 内置 shell：
 * - 单文件 ~660KB，提供 ash（bash 兼容子集）与常用 Unix 工具
 * - Unicode 构建以 UTF-8 作为活动代码页，正确处理中文路径与中文输出
 *   （需要 Win10 1903+；更旧系统会自动回退系统代码页，仍可运行）
 * - 重命名为 bash.exe 分发：busybox 按 argv[0] 分派 applet，bash 名称会启用 ash 的 bash 兼容模式
 *
 * 供应链锁定：版本与 SHA256 固定在本文件中（等价 lockfile）。
 * 升级时必须同时更新 BUSYBOX_RELEASE 与 BUSYBOX_SHA256，
 * 新哈希需与官方 https://frippery.org/files/busybox/SHA256SUM（附 GPG 签名）交叉核对。
 *
 * 使用：
 * bun run scripts/download-bash.ts [--force]
 */

import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'

const SCRIPT_DIR = dirname(Bun.main)
const VENDOR_DIR = join(SCRIPT_DIR, '..', 'vendor', 'bash', 'win32-x64')

// busybox-w32 发布号（版本化 URL，保证构建可复现；不使用无版本号的滚动 busybox.exe）
const BUSYBOX_RELEASE = 'FRP-6075-g169694ebd'
const BUSYBOX_FILENAME = `busybox-w64u-${BUSYBOX_RELEASE}.exe`
const BUSYBOX_URL = `https://frippery.org/files/busybox/${BUSYBOX_FILENAME}`
// 固定校验和：独立下载计算，并与官方 SHA256SUM 一致（2026-07 核对）
const BUSYBOX_SHA256 = '6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c'

async function sha256OfFile(path: string): Promise<string> {
  const data = await Bun.file(path).arrayBuffer()
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  return hasher.digest('hex')
}

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
  console.log(`  已保存到: ${destPath} (${(arrayBuffer.byteLength / 1024).toFixed(0)} KB)`)
}

async function verifyChecksum(destPath: string): Promise<void> {
  const actual = await sha256OfFile(destPath)
  if (actual === BUSYBOX_SHA256) {
    console.log('  SHA256 校验通过')
    return
  }

  // 校验失败必须删除半成品，避免残留文件被后续 existsSync 检查误认为可用
  rmSync(destPath, { force: true })
  throw new Error(
    `SHA256 校验失败，已删除下载文件:\n`
    + `    期望 ${BUSYBOX_SHA256}\n`
    + `    实际 ${actual}\n`
    + `  如需升级 busybox，请同时更新脚本中的 BUSYBOX_RELEASE 与 BUSYBOX_SHA256，`
    + `并与官方 SHA256SUM 交叉核对。`,
  )
}

async function main(): Promise<void> {
  console.log('='.repeat(50))
  console.log(`Kila Windows bash (busybox-w32 ${BUSYBOX_RELEASE}) 下载脚本`)
  console.log('='.repeat(50))

  const destPath = join(VENDOR_DIR, 'bash.exe')
  const force = process.argv.includes('--force')

  // 已存在时先做哈希校验：命中则跳过；不匹配（旧版本/损坏）则自动重新下载
  if (!force && existsSync(destPath)) {
    const actual = await sha256OfFile(destPath)
    if (actual === BUSYBOX_SHA256) {
      console.log('\n  bash.exe 已存在且 SHA256 校验通过，跳过下载（使用 --force 重新下载）')
      return
    }
    console.warn('\n  ⚠️ 已存在的 bash.exe 校验不匹配（可能是旧版本或已损坏），重新下载...')
  }

  if (!existsSync(VENDOR_DIR)) {
    mkdirSync(VENDOR_DIR, { recursive: true })
  }

  try {
    await downloadFile(BUSYBOX_URL, destPath)
    await verifyChecksum(destPath)

    // 冒烟验证：仅 Windows 上可执行 .exe，其他平台跳过（SHA256 已保证完整性）
    if (process.platform === 'win32') {
      try {
        const proc = Bun.spawn([destPath, '--help'], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const code = await proc.exited
        if (code !== 0 && code !== 1) {
          // busybox --help 返回 1 是正常的
          console.warn('  ⚠️ bash.exe 冒烟验证返回非预期退出码，但不影响使用')
        }
      } catch (err) {
        console.warn('  ⚠️ bash.exe 冒烟验证执行失败:', err)
      }
    }

    console.log('\n  ✅ bash.exe 下载并校验完成')
  } catch (error) {
    console.error('\n  ❌ 下载失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()

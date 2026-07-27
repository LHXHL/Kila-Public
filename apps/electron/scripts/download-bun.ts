#!/usr/bin/env bun
/**
 * Bun 二进制下载脚本
 *
 * 功能：
 * - 从 GitHub releases 下载指定版本的 Bun 二进制文件
 * - 支持所有目标平台（darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64）
 * - SHA256 校验验证
 * - 解压到 vendor/bun/{platform-arch}/ 目录
 *
 * 使用：
 * bun run scripts/download-bun.ts [--platform <platform-arch>] [--force]
 *
 * 选项：
 * --platform: 只下载指定平台（默认下载所有平台）
 * --force: 强制重新下载（即使已存在）
 */

import { existsSync, mkdirSync, chmodSync, rmSync, createWriteStream, readFileSync, readdirSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import type { PlatformArch, BunDownloadInfo } from '@kila/shared'

/** Bun 下载 URL 基础路径 */
const BUN_DOWNLOAD_BASE = 'https://github.com/oven-sh/bun/releases/download'

/** 平台架构映射表（Node.js 命名 -> Bun releases 命名）*/
const PLATFORM_ARCH_MAP: Record<PlatformArch, string> = {
  'darwin-arm64': 'darwin-aarch64',
  'darwin-x64': 'darwin-x64',
  'linux-arm64': 'linux-aarch64',
  'linux-x64': 'linux-x64',
  'win32-x64': 'windows-x64',
}

/**
 * 各版本各平台的 Bun 发行包 SHA256 锁定表
 *
 * 来源：`https://github.com/oven-sh/bun/releases/download/bun-v{version}/SHASUMS256.txt`
 *
 * 升级 Bun（改 package.json 的 kila.bun.version）时必须同步在这里登记新版本的哈希，
 * 否则脚本会直接失败。这是刻意的：vendor/bun 随安装包分发给全部用户，
 * 缺少完整性锁定意味着上游被投毒或构建机被中间人时无法察觉。
 */
const BUN_SHA256: Record<string, Partial<Record<PlatformArch, string>>> = {
  '1.2.5': {
    'darwin-arm64': '55e6520a172e22a37d4822f23afde90b26f36880ce3eaad348699418dbf788bb',
    'darwin-x64': '969f03626233168f3cdc17e9af9e7c9de32200073831fc53ab9416035de7ea61',
    'linux-arm64': 'ee1b5cabb5fdbb25640787e329846ef41384ca8699db504f45bfee015f348b58',
    'linux-x64': '88f64bedee330ff4d6328e3e90c669bc7ac5314927c604f85e329ea2a1d1979b',
    'win32-x64': '1c3c7da053f1ba9ecd914e0178165a510a82111f7e85c4543d5904d7c2f48a13',
  },
}

/** 取指定版本+平台的期望哈希；未登记时抛出带升级指引的错误 */
function getExpectedChecksum(version: string, platformArch: PlatformArch): string {
  const expected = BUN_SHA256[version]?.[platformArch]
  if (expected) return expected

  throw new Error(
    `未登记 Bun ${version} / ${platformArch} 的 SHA256，拒绝下载。\n`
    + `  请执行以下命令取回官方校验和，并写入 download-bun.ts 的 BUN_SHA256 表：\n`
    + `    curl -sfL https://github.com/oven-sh/bun/releases/download/bun-v${version}/SHASUMS256.txt`,
  )
}

/** 支持的目标平台列表 */
const TARGET_PLATFORMS: PlatformArch[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]

/** 脚本所在目录 */
const SCRIPT_DIR = dirname(Bun.main)
/** vendor 目录路径 */
const VENDOR_DIR = join(SCRIPT_DIR, '..', 'vendor', 'bun')

/**
 * 获取 Bun 下载信息
 */
function getBunDownloadInfo(version: string, platformArch: PlatformArch): BunDownloadInfo {
  const bunPlatform = PLATFORM_ARCH_MAP[platformArch]
  const isWindows = platformArch.startsWith('win32')
  const binaryName = isWindows ? 'bun.exe' : 'bun'
  const zipFileName = `bun-${bunPlatform}.zip`

  return {
    platformArch,
    url: `${BUN_DOWNLOAD_BASE}/bun-v${version}/${zipFileName}`,
    zipFileName,
    binaryName,
  }
}

/**
 * 下载文件到指定路径
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`  下载中: ${url}`)

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Kila-Build-Script/1.0',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }

  // 确保目标目录存在
  const dir = dirname(destPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // 使用 Bun.write 写入文件
  const arrayBuffer = await response.arrayBuffer()
  await Bun.write(destPath, arrayBuffer)

  console.log(`  已保存到: ${destPath}`)
}

/**
 * 计算文件的 SHA256 校验和
 */
async function calculateChecksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  const buffer = await file.arrayBuffer()
  const hash = createHash('sha256')
  hash.update(Buffer.from(buffer))
  return hash.digest('hex')
}

/**
 * 解压 zip 文件
 */
async function extractZip(zipPath: string, destDir: string, binaryName: string): Promise<string> {
  console.log(`  解压中: ${zipPath}`)

  // 确保目标目录存在
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  // 跨平台解压：Windows 用 tar（Win10+ 自带），Unix 用 unzip
  const isWindows = process.platform === 'win32'
  let proc: Bun.Subprocess

  if (isWindows) {
    // tar on Windows can extract zip files; -x extracts, -o overwrites
    const tempExtract = join(destDir, '_extract')
    if (!existsSync(tempExtract)) mkdirSync(tempExtract, { recursive: true })
    proc = Bun.spawn(['tar', '-xf', zipPath, '-C', tempExtract], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`解压失败: ${stderr}`)
    }
    // tar 解压后文件在子目录里，需要复制到 destDir
    // 用 cpSync + rmSync 替代 renameSync，避免 Windows 跨驱动器失败
    const entries = readdirSync(tempExtract)
    for (const entry of entries) {
      const src = join(tempExtract, entry)
      const dst = join(destDir, entry)
      cpSync(src, dst, { recursive: true })
    }
    rmSync(tempExtract, { recursive: true, force: true })
  } else {
    proc = Bun.spawn(['unzip', '-o', '-j', zipPath, '-d', destDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`解压失败: ${stderr}`)
    }
  }

  const binaryPath = join(destDir, binaryName)

  // 设置可执行权限（非 Windows）
  if (!binaryName.endsWith('.exe')) {
    chmodSync(binaryPath, 0o755)
  }

  console.log(`  已解压到: ${destDir}`)
  return binaryPath
}

/**
 * 验证 Bun 二进制文件
 */
async function validateBunBinary(binaryPath: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([binaryPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return null
    }

    const version = await new Response(proc.stdout).text()
    return version.trim()
  } catch {
    return null
  }
}

/**
 * 下载并安装单个平台的 Bun
 */
async function downloadBunForPlatform(
  version: string,
  platformArch: PlatformArch,
  force: boolean
): Promise<void> {
  console.log(`\n[${platformArch}] 开始处理...`)

  const info = getBunDownloadInfo(version, platformArch)
  // 先取期望哈希：版本未登记时立即失败，不做无意义的下载
  const expectedChecksum = getExpectedChecksum(version, platformArch)
  const targetDir = join(VENDOR_DIR, platformArch)
  const binaryPath = join(targetDir, info.binaryName)

  // 检查是否已存在
  if (!force && existsSync(binaryPath)) {
    const existingVersion = await validateBunBinary(binaryPath)
    if (existingVersion === version) {
      console.log(`  已存在正确版本 (${version})，跳过下载`)
      return
    }
    console.log(`  存在旧版本 (${existingVersion || 'unknown'})，将重新下载`)
  }

  // 创建临时目录
  const tempDir = join(VENDOR_DIR, '.temp', platformArch)
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true })
  }
  mkdirSync(tempDir, { recursive: true })

  const zipPath = join(tempDir, info.zipFileName)

  try {
    // 下载 zip 文件
    await downloadFile(info.url, zipPath)

    // 校验完整性：不匹配立即删除半成品并中止，绝不解压来路不明的二进制
    const checksum = await calculateChecksum(zipPath)
    if (checksum !== expectedChecksum) {
      rmSync(zipPath, { force: true })
      throw new Error(
        `SHA256 校验失败，已删除下载文件:\n`
        + `    期望 ${expectedChecksum}\n`
        + `    实际 ${checksum}\n`
        + `  若为官方升级请更新 BUN_SHA256 表；否则说明下载链路不可信，请勿继续构建。`,
      )
    }
    console.log(`  SHA256 校验通过: ${checksum}`)

    // 解压
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true })
    }
    await extractZip(zipPath, targetDir, info.binaryName)

    // 验证（CI 环境下放宽：windows-2025-vs2026 等新镜像执行未签名 exe 受限，
    // 但压缩包已通过上面的 SHA256 校验，完整性有保证）
    const installedVersion = await validateBunBinary(binaryPath)
    if (!installedVersion) {
      if (process.env.CI === 'true') {
        console.log(`  ⚠️ 跳过本地执行验证（CI 环境），压缩包已通过 SHA256 校验`)
      } else {
        throw new Error('安装后验证失败：无法执行 bun --version')
      }
    } else {
      console.log(`  ✅ 安装成功: Bun ${installedVersion}`)
    }
  } finally {
    // 清理临时文件
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true })
    }
  }
}

/**
 * 读取 package.json 中的 Bun 版本配置
 */
async function getBunVersion(): Promise<string> {
  const pkgPath = join(SCRIPT_DIR, '..', 'package.json')
  const pkgFile = Bun.file(pkgPath)
  const pkg = await pkgFile.json()

  const version = pkg.kila?.bun?.version
  if (!version) {
    throw new Error('package.json 中未配置 kila.bun.version')
  }

  return version
}

/**
 * 解析命令行参数
 */
function parseArgs(): { platforms: PlatformArch[]; force: boolean } {
  const args = process.argv.slice(2)
  let platforms: PlatformArch[] = [...TARGET_PLATFORMS]
  let force = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--platform' && args[i + 1]) {
      const platform = args[i + 1] as PlatformArch
      if (!TARGET_PLATFORMS.includes(platform)) {
        console.error(`错误：不支持的平台 "${platform}"`)
        console.error(`支持的平台：${TARGET_PLATFORMS.join(', ')}`)
        process.exit(1)
      }
      platforms = [platform]
      i++
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Bun 二进制下载脚本

用法：bun run scripts/download-bun.ts [选项]

选项：
  --platform <arch>  只下载指定平台（默认下载所有平台）
                     支持：${TARGET_PLATFORMS.join(', ')}
  --force           强制重新下载（即使已存在）
  --help, -h        显示帮助信息
`)
      process.exit(0)
    }
  }

  return { platforms, force }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log('='.repeat(60))
  console.log('Kila Bun 二进制下载脚本')
  console.log('='.repeat(60))

  try {
    const { platforms, force } = parseArgs()
    const version = await getBunVersion()

    console.log(`\nBun 版本: ${version}`)
    console.log(`目标平台: ${platforms.join(', ')}`)
    console.log(`强制下载: ${force ? '是' : '否'}`)
    console.log(`输出目录: ${VENDOR_DIR}`)

    // 确保 vendor 目录存在
    if (!existsSync(VENDOR_DIR)) {
      mkdirSync(VENDOR_DIR, { recursive: true })
    }

    // 下载每个平台
    for (const platform of platforms) {
      await downloadBunForPlatform(version, platform, force)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ 所有 Bun 二进制下载完成')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('\n❌ 下载失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// 执行主函数
main()

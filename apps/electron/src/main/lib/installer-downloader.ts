/**
 * 安装包下载器
 *
 * 流式下载安装包到本地临时目录，支持进度推送和取消。
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, promises as fsp } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import path from 'node:path'
import { URL } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'
import type { InstallerDownloadResult, InstallerProgressPayload, InstallerSource } from '@kila/shared'
import { INSTALLER_IPC_CHANNELS } from '@kila/shared'

const activeDownloads = new Map<string, () => void>()

function getInstallerDir(): string {
  return path.join(app.getPath('temp'), 'kila-installers')
}

function emitProgress(sender: BrowserWindow, payload: InstallerProgressPayload): void {
  if (sender.isDestroyed()) return
  sender.webContents.send(INSTALLER_IPC_CHANNELS.PROGRESS, payload)
}

function downloadToFile(
  url: string,
  filePath: string,
  source: InstallerSource,
  key: string,
  sender: BrowserWindow,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cancelled = false
    let requestToAbort: { destroy: (err?: Error) => void } | null = null

    const cancel = () => {
      cancelled = true
      requestToAbort?.destroy(new Error('cancelled'))
    }
    activeDownloads.set(key, cancel)

    const cleanup = () => { activeDownloads.delete(key) }
    const fileStream = createWriteStream(filePath)

    const getModule = (u: URL) => (u.protocol === 'http:' ? httpGet : httpsGet)

    const doGet = (targetUrl: string, redirectsLeft: number) => {
      const parsed = new URL(targetUrl)
      const request = getModule(parsed)(targetUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) { fileStream.close(); cleanup(); reject(new Error('重定向次数过多')); return }
          doGet(new URL(res.headers.location, parsed).toString(), redirectsLeft - 1)
          return
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          fileStream.close(); cleanup(); reject(new Error(`HTTP ${res.statusCode ?? '?'}`)); res.resume(); return
        }

        const totalFromHeader = Number(res.headers['content-length'] ?? 0)
        const total = totalFromHeader > 0 ? totalFromHeader : source.sizeBytes
        let downloaded = 0
        let lastEmit = 0
        let lastEmitBytes = 0

        res.on('data', (chunk: Buffer) => {
          if (cancelled) return
          downloaded += chunk.length
          const now = Date.now()
          if (now - lastEmit >= 250 || downloaded === total) {
            const elapsed = (now - lastEmit) / 1000 || 1
            const speed = Math.round((downloaded - lastEmitBytes) / elapsed)
            lastEmit = now
            lastEmitBytes = downloaded
            emitProgress(sender, { key, downloaded, total, speed })
          }
        })

        res.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close()
          cleanup()
          if (cancelled) { reject(new Error('cancelled')); return }
          emitProgress(sender, { key, downloaded: total, total, speed: 0 })
          resolve()
        })

        fileStream.on('error', (err) => { fileStream.close(); cleanup(); reject(err) })
        res.on('error', (err) => { fileStream.close(); cleanup(); reject(err) })
      })

      requestToAbort = request
      request.on('error', (err) => { fileStream.close(); cleanup(); reject(err) })
    }

    doGet(url, 5)
  })
}

export async function downloadInstaller(
  source: InstallerSource,
  key: string,
  sender: BrowserWindow,
): Promise<InstallerDownloadResult> {
  const dir = getInstallerDir()
  await fsp.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, source.filename)

  const urls = [source.downloadUrl, source.fallbackUrl].filter((u): u is string => typeof u === 'string' && u.length > 0)
  if (urls.length === 0) throw new Error('安装包清单缺少有效 URL')

  let lastError: unknown = null
  for (const url of urls) {
    try {
      await downloadToFile(url, filePath, source, key, sender)
      const sha256 = await computeSha256(filePath)
      if (source.sha256 && sha256.toLowerCase() !== source.sha256.toLowerCase()) {
        await fsp.unlink(filePath).catch(() => {})
        throw new Error(`sha256 校验失败：期望 ${source.sha256}，实际 ${sha256}`)
      }
      if (!source.sha256) {
        console.warn(`[Installer] ${source.filename} 清单未提供 sha256，跳过校验`)
      }
      return { filePath, sha256 }
    } catch (error) {
      lastError = error
      if (error instanceof Error && error.message === 'cancelled') throw error
      console.warn(`[Installer] 从 ${url} 下载失败:`, error)
      if (existsSync(filePath)) await fsp.unlink(filePath).catch(() => {})
    }
  }

  throw (lastError as Error) ?? new Error('所有下载源均失败')
}

function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export function cancelInstallerDownload(key: string): boolean {
  const cancel = activeDownloads.get(key)
  if (cancel) { cancel(); return true }
  return false
}

export async function launchInstaller(filePath: string): Promise<void> {
  const installerDir = path.resolve(getInstallerDir())
  const resolvedPath = path.resolve(filePath)
  const allowedPrefix = `${installerDir}${path.sep}`
  if (!resolvedPath.startsWith(allowedPrefix)) {
    throw new Error('只能打开 Kila 下载目录中的安装程序')
  }

  const ext = path.extname(resolvedPath).toLowerCase()
  if (ext !== '.exe' && ext !== '.msi') {
    throw new Error('安装程序类型不受支持')
  }

  const errorMsg = await shell.openPath(resolvedPath)
  if (errorMsg) throw new Error(`无法拉起安装程序：${errorMsg}`)
}

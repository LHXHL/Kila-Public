import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function fsyncFile(filePath: string): void {
  const fd = openSync(filePath, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function fsyncDir(dirPath: string): void {
  try {
    const fd = openSync(dirPath, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Some platforms/filesystems do not allow fsync on directories.
  }
}

function tmpPathFor(filePath: string): string {
  const dir = dirname(filePath)
  const name = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`
  return join(dir, `.${name}.tmp`)
}

/**
 * 跨平台原子写入
 * Windows 上 renameSync 在目标文件被占用时会抛 EPERM / EBUSY，
 * 此时降级为 copyFileSync + unlinkSync
 */
function renameOrFallback(tmpPath: string, filePath: string): void {
  try {
    renameSync(tmpPath, filePath)
  } catch (renameError) {
    if (process.platform !== 'win32') throw renameError
    const code = (renameError as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw renameError
    // Windows 降级：复制内容后删除临时文件
    copyFileSync(tmpPath, filePath)
    try {
      unlinkSync(tmpPath)
    } catch {
      // 临时文件清理失败不阻塞
    }
  }
}

export function writeTextAtomic(filePath: string, content: string): void {
  ensureParentDir(filePath)
  const tmpPath = tmpPathFor(filePath)
  writeFileSync(tmpPath, content, 'utf-8')
  if (process.platform !== 'win32') {
    fsyncFile(tmpPath)
  }
  renameOrFallback(tmpPath, filePath)
  if (process.platform !== 'win32') {
    fsyncDir(dirname(filePath))
  }
}

export function writeTextAtomicWithBackup(filePath: string, content: string): void {
  writeTextAtomic(filePath, content)
  writeTextAtomic(`${filePath}.bak`, content)
}

export function appendTextDurably(filePath: string, content: string): void {
  ensureParentDir(filePath)
  const fd = openSync(filePath, 'a')
  try {
    writeFileSync(fd, content, 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

export function readJsonWithBackup<T>(
  filePath: string,
  parse: (raw: string, sourcePath: string) => T,
): T {
  try {
    return parse(readFileSync(filePath, 'utf-8'), filePath)
  } catch (primaryError) {
    const backupPath = `${filePath}.bak`
    if (!existsSync(backupPath)) {
      throw primaryError
    }

    const value = parse(readFileSync(backupPath, 'utf-8'), backupPath)
    copyFileSync(backupPath, filePath)
    if (process.platform !== 'win32') {
      fsyncFile(filePath)
      fsyncDir(dirname(filePath))
    }
    return value
  }
}

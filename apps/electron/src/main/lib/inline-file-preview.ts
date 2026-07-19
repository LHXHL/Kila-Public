import { basename, extname, resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import type { InlineFilePreview } from '@kila/shared'

const MAX_TEXT_PREVIEW_SIZE = 512 * 1024
const MAX_BINARY_PREVIEW_SIZE = 8 * 1024 * 1024

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.htm',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.sh',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.sql',
  '.log',
])

const CODE_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.htm',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.sh',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.sql',
])

function buildBasePreview(filePath: string, size: number): Omit<InlineFilePreview, 'kind'> {
  const resolvedPath = resolve(filePath)
  const extension = extname(resolvedPath).toLowerCase()

  return {
    filePath: resolvedPath,
    filename: basename(resolvedPath),
    extension,
    size,
  }
}

function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512))
  for (const byte of sample) {
    if (byte === 0) return false
  }
  return true
}

export async function readInlineFilePreview(filePath: string): Promise<InlineFilePreview> {
  try {
    const resolvedPath = resolve(filePath)
    const stat = statSync(resolvedPath)
    const base = buildBasePreview(resolvedPath, stat.size)
    const extension = base.extension

    if (extension in IMAGE_MIME_TYPES) {
      if (stat.size > MAX_BINARY_PREVIEW_SIZE) {
        return { ...base, kind: 'too_large', errorMessage: '图片过大，无法内联预览' }
      }

      const data = readFileSync(resolvedPath)
      return {
        ...base,
        kind: 'image',
        mimeType: IMAGE_MIME_TYPES[extension],
        dataUrl: `data:${IMAGE_MIME_TYPES[extension]};base64,${data.toString('base64')}`,
      }
    }

    if (extension === '.pdf') {
      if (stat.size > MAX_BINARY_PREVIEW_SIZE) {
        return { ...base, kind: 'too_large', errorMessage: 'PDF 过大，无法内联预览' }
      }

      const data = readFileSync(resolvedPath)
      return {
        ...base,
        kind: 'pdf',
        mimeType: 'application/pdf',
        dataUrl: `data:application/pdf;base64,${data.toString('base64')}`,
      }
    }

    if (stat.size > MAX_TEXT_PREVIEW_SIZE) {
      return { ...base, kind: 'too_large', errorMessage: '文件过大，无法内联预览' }
    }

    const data = readFileSync(resolvedPath)
    if (!TEXT_EXTENSIONS.has(extension) && !isProbablyText(data)) {
      return { ...base, kind: 'unsupported' }
    }

    const textContent = data.toString('utf-8')
    if (extension === '.md' || extension === '.markdown') {
      return {
        ...base,
        kind: 'markdown',
        mimeType: 'text/markdown',
        textContent,
      }
    }

    if (CODE_EXTENSIONS.has(extension)) {
      return {
        ...base,
        kind: 'code',
        mimeType: 'text/plain',
        textContent,
      }
    }

    return {
      ...base,
      kind: 'text',
      mimeType: 'text/plain',
      textContent,
    }
  } catch (error) {
    return {
      filePath: resolve(filePath),
      filename: basename(filePath),
      extension: extname(filePath).toLowerCase(),
      size: 0,
      kind: 'error',
      errorMessage: error instanceof Error ? error.message : '预览读取失败',
    }
  }
}

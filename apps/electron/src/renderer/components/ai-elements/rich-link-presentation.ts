import { defaultUrlTransform } from 'react-markdown'

export type RichLinkKind =
  | 'github'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'video'
  | 'code'
  | 'local-file'
  | 'web'

export interface RichLinkPresentation {
  kind: RichLinkKind
  label: string
  meta: string | null
  /** 需要本地化的 meta 文案 key；有值时由渲染层用 t() 解析，优先于 meta */
  metaKey?: string
  isExternal: boolean
  isLocalFile: boolean
  filePath: string | null
}

const DOCUMENT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt',
])
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx', 'ods', 'tsv'])
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'odp', 'key'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'])
const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'json', 'jsonl', 'html', 'htm', 'css', 'scss', 'less',
  'xml', 'yaml', 'yml', 'toml', 'py', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h',
  'hpp', 'sh', 'bash', 'zsh', 'sql', 'vue', 'svelte',
])
const LOCAL_FILE_EXTENSIONS = new Set([
  ...DOCUMENT_EXTENSIONS,
  ...SPREADSHEET_EXTENSIONS,
  ...PRESENTATION_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...CODE_EXTENSIONS,
  'zip', 'tar', 'gz', 'tgz', '7z',
])

const ONLINE_DOCUMENT_HOSTS = new Map<string, string>([
  ['docs.google.com', 'Google Docs'],
  ['drive.google.com', 'Google Drive'],
  ['notion.so', 'Notion'],
  ['www.notion.so', 'Notion'],
  ['notion.site', 'Notion'],
  ['www.notion.site', 'Notion'],
  ['feishu.cn', '飞书文档'],
  ['www.feishu.cn', '飞书文档'],
  ['larksuite.com', 'Lark Docs'],
  ['www.larksuite.com', 'Lark Docs'],
  ['yuque.com', '语雀文档'],
  ['www.yuque.com', '语雀文档'],
  ['docs.qq.com', '腾讯文档'],
])

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf('?')
  const hashIndex = value.indexOf('#')
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0)
  const cutAt = indexes.length > 0 ? Math.min(...indexes) : value.length
  return value.slice(0, cutAt)
}

function getPathExtension(value: string): string {
  const clean = stripQueryAndHash(value).replace(/\\/g, '/')
  const filename = clean.slice(clean.lastIndexOf('/') + 1)
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : ''
}

function getFileName(value: string): string {
  const clean = stripQueryAndHash(value).replace(/\\/g, '/').replace(/\/+$/, '')
  return safeDecode(clean.slice(clean.lastIndexOf('/') + 1)) || safeDecode(clean)
}

function isMeaningfulLabel(label: string, href: string): boolean {
  const clean = label.trim()
  if (!clean) return false
  if (clean === href || clean === safeDecode(href)) return false
  return !/^(?:https?:\/\/|file:|sandbox:)/i.test(clean)
}

function normalizePathSegments(value: string): string {
  const slashPath = value.replace(/\\/g, '/')
  const driveMatch = slashPath.match(/^([A-Za-z]:)(\/.*)?$/)
  const drive = driveMatch?.[1] ?? ''
  const isAbsolute = slashPath.startsWith('/') || Boolean(drive)
  const pathPart = drive ? (driveMatch?.[2] ?? '/') : slashPath
  const segments: string[] = []

  for (const segment of pathPart.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop()
      else if (!isAbsolute) segments.push(segment)
      continue
    }
    segments.push(segment)
  }

  const prefix = drive ? `${drive}/` : isAbsolute ? '/' : ''
  return `${prefix}${segments.join('/')}` || (isAbsolute ? prefix : '.')
}

function joinLocalPath(basePath: string, relativePath: string): string {
  const base = basePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizePathSegments(`${base}/${relativePath}`)
}

function isRelativeFileHref(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('?') || href.startsWith('//')) return false
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return false
  return LOCAL_FILE_EXTENSIONS.has(getPathExtension(href))
}

/**
 * 将 Markdown 中的本地文件地址解析为 IPC 可消费的绝对路径。
 * 真正的工作区访问边界仍由主进程 `assertAgentFileAccess()` 强制校验。
 */
export function resolveLocalLinkPath(href: string, basePath?: string): string | null {
  const cleanHref = href.trim()
  if (!cleanHref) return null

  if (/^file:\/\//i.test(cleanHref)) {
    try {
      const url = new URL(cleanHref)
      const pathname = safeDecode(url.pathname)
      const windowsPath = /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname
      return normalizePathSegments(windowsPath)
    } catch {
      return null
    }
  }

  if (/^sandbox:/i.test(cleanHref)) {
    const sandboxPath = safeDecode(stripQueryAndHash(cleanHref.slice('sandbox:'.length)))
    if (!sandboxPath) return null
    if (sandboxPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(sandboxPath)) {
      return normalizePathSegments(sandboxPath)
    }
    return basePath ? joinLocalPath(basePath, sandboxPath) : null
  }

  const pathWithoutSuffix = safeDecode(stripQueryAndHash(cleanHref))
  if (pathWithoutSuffix.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pathWithoutSuffix)) {
    return normalizePathSegments(pathWithoutSuffix)
  }

  if (basePath && isRelativeFileHref(pathWithoutSuffix)) {
    return joinLocalPath(basePath, pathWithoutSuffix)
  }

  return null
}

function getKindFromExtension(extension: string, fallback: RichLinkKind): RichLinkKind {
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  if (SPREADSHEET_EXTENSIONS.has(extension)) return 'spreadsheet'
  if (PRESENTATION_EXTENSIONS.has(extension)) return 'presentation'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  return fallback
}

function deriveGithubLabel(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode)
  if (segments.length < 2) return null
  return `${segments[0] ?? ''}/${(segments[1] ?? '').replace(/\.git$/i, '')}`
}

function deriveWebLabel(url: URL): string {
  const filename = getFileName(url.pathname)
  if (filename && filename !== url.hostname) return filename
  return url.hostname.replace(/^www\./, '')
}

export function createRichLinkPresentation(
  href: string,
  text: string,
  basePath?: string,
): RichLinkPresentation {
  const filePath = resolveLocalLinkPath(href, basePath)
  if (filePath) {
    const extension = getPathExtension(filePath)
    return {
      kind: getKindFromExtension(extension, 'local-file'),
      label: isMeaningfulLabel(text, href) ? text.trim() : getFileName(filePath),
      meta: extension ? extension.toUpperCase() : null,
      metaKey: extension ? undefined : 'shell.richLink.localFile',
      isExternal: false,
      isLocalFile: true,
      filePath,
    }
  }

  if (isRelativeFileHref(href)) {
    const extension = getPathExtension(href)
    return {
      kind: getKindFromExtension(extension, 'local-file'),
      label: isMeaningfulLabel(text, href) ? text.trim() : getFileName(href),
      meta: extension ? extension.toUpperCase() : null,
      metaKey: extension ? undefined : 'shell.richLink.localFile',
      isExternal: false,
      isLocalFile: false,
      filePath: null,
    }
  }

  try {
    const url = new URL(href)
    const extension = getPathExtension(url.pathname)
    const hostname = url.hostname.toLowerCase()
    const meaningfulLabel = isMeaningfulLabel(text, href)

    if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
      return {
        kind: 'github',
        label: meaningfulLabel ? text.trim() : deriveGithubLabel(url) ?? deriveWebLabel(url),
        meta: 'GitHub',
        isExternal: true,
        isLocalFile: false,
        filePath: null,
      }
    }

    const onlineDocumentLabel = ONLINE_DOCUMENT_HOSTS.get(hostname)
    const kind = onlineDocumentLabel
      ? 'document'
      : getKindFromExtension(extension, 'web')

    return {
      kind,
      label: meaningfulLabel ? text.trim() : onlineDocumentLabel ?? deriveWebLabel(url),
      meta: hostname.replace(/^www\./, ''),
      isExternal: true,
      isLocalFile: false,
      filePath: null,
    }
  } catch {
    return {
      kind: 'web',
      label: text.trim() || href,
      meta: null,
      isExternal: false,
      isLocalFile: false,
      filePath: null,
    }
  }
}

/**
 * react-markdown 默认会移除 file/sandbox 协议。这里只对链接 href 开放，
 * 图片 src 等资源仍沿用默认安全策略，点击后的文件访问继续交给主进程校验。
 */
export function transformMarkdownUrl(url: string, key: string): string {
  if (key === 'href' && /^(?:file:\/\/|sandbox:)/i.test(url)) return url
  return defaultUrlTransform(url)
}

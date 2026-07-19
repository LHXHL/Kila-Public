import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import type { SessionHtmlPreviewResolution, SessionWebPreviewServerInfo } from '@kila/shared'

interface PreviewServerInstance extends SessionWebPreviewServerInfo {
  server: Server
  port: number
}

const previewServerRegistry = new Map<string, PreviewServerInstance>()

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath)
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizeRootPath(rootPath)
  const normalizedTarget = resolve(targetPath)
  const rel = relative(normalizedRoot, normalizedTarget)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !rel.includes(`..${sep}`))
}

function buildBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/`
}

function buildLandingPage(rootPath: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kila Preview Server</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f9f6f1;
        --card: rgba(255,255,255,0.82);
        --fg: #221f1b;
        --muted: #6d675f;
        --border: rgba(34,31,27,0.12);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #111110;
          --card: rgba(28,28,26,0.92);
          --fg: #f3efe8;
          --muted: #b7afa3;
          --border: rgba(243,239,232,0.1);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: var(--bg);
        color: var(--fg);
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        width: min(680px, 100%);
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--card);
        padding: 28px 30px;
      }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 10px; line-height: 1.7; color: var(--muted); }
      code {
        display: block;
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        font-size: 12px;
        overflow-wrap: anywhere;
        color: var(--fg);
      }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>Preview server is running</h1>
      <p>服务已启动，可打开 HTML 文件或在地址栏输入 URL。</p>
      <p>当前根目录固定为当前会话项目目录。</p>
      <code>${escapeHtml(rootPath)}</code>
    </section>
  </body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function sendHtml(response: ServerResponse, html: string, method: string): void {
  response.writeHead(200, {
    'Content-Type': MIME_TYPES['.html'],
    'Cache-Control': 'no-store',
  })
  if (method === 'HEAD') {
    response.end()
    return
  }
  response.end(html)
}

function sendFile(response: ServerResponse, filePath: string, method: string): void {
  const extension = extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[extension] ?? 'application/octet-stream'
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  })
  if (method === 'HEAD') {
    response.end()
    return
  }
  response.end(readFileSync(filePath))
}

function sendStatus(response: ServerResponse, statusCode: number, method: string, message: string): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  if (method === 'HEAD') {
    response.end()
    return
  }
  response.end(message)
}

function resolveRequestPath(rootPath: string, requestUrl: string): string {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const decodedPathname = decodeURIComponent(url.pathname)
  const relativePath = decodedPathname === '/' ? '' : decodedPathname.replace(/^\/+/, '')
  const resolvedPath = resolve(rootPath, relativePath)

  if (!isPathWithinRoot(rootPath, resolvedPath)) {
    throw new Error('forbidden')
  }

  return resolvedPath
}

function maybeResolveIndex(pathname: string): string | null {
  if (!existsSync(pathname)) return null
  const stat = statSync(pathname)
  if (!stat.isDirectory()) return pathname

  const indexPath = resolve(pathname, 'index.html')
  return existsSync(indexPath) ? indexPath : null
}

function handlePreviewRequest(rootPath: string, request: IncomingMessage, response: ServerResponse): void {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    sendStatus(response, 405, method, 'Method Not Allowed')
    return
  }

  try {
    const resolvedPath = resolveRequestPath(rootPath, request.url ?? '/')

    if (resolvedPath === normalizeRootPath(rootPath)) {
      const rootIndex = resolve(rootPath, 'index.html')
      if (existsSync(rootIndex)) {
        sendFile(response, rootIndex, method)
        return
      }

      sendHtml(response, buildLandingPage(rootPath), method)
      return
    }

    const targetFile = maybeResolveIndex(resolvedPath)
    if (!targetFile || !existsSync(targetFile)) {
      sendStatus(response, 404, method, 'Not Found')
      return
    }

    sendFile(response, targetFile, method)
  } catch (error) {
    if (error instanceof Error && error.message === 'forbidden') {
      sendStatus(response, 403, method, 'Forbidden')
      return
    }

    sendStatus(response, 500, method, 'Preview Server Error')
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error)
        return
      }
      resolveClose()
    })
  })
}

async function startServer(sessionId: string, rootPath: string, previousPort?: number): Promise<PreviewServerInstance> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const server = createServer((request, response) => {
      handlePreviewRequest(rootPath, request, response)
    })

    const port = await new Promise<number>((resolvePort, rejectPort) => {
      server.once('error', rejectPort)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          rejectPort(new Error('无法解析 preview server 端口'))
          return
        }
        resolvePort(address.port)
      })
    })

    if (previousPort && port === previousPort) {
      await closeServer(server)
      continue
    }

    return {
      sessionId,
      rootPath,
      baseUrl: buildBaseUrl(port),
      port,
      server,
    }
  }

  throw new Error('无法为 preview server 分配新的监听端口')
}

export async function ensureSessionWebPreviewServer(
  sessionId: string,
  rootPath: string,
): Promise<SessionWebPreviewServerInfo> {
  const normalizedRootPath = normalizeRootPath(rootPath)
  const existing = previewServerRegistry.get(sessionId)

  if (existing && existing.rootPath === normalizedRootPath) {
    return {
      sessionId: existing.sessionId,
      rootPath: existing.rootPath,
      baseUrl: existing.baseUrl,
    }
  }

  const previousPort = existing?.port
  if (existing) {
    await stopSessionWebPreviewServer(sessionId)
  }

  const next = await startServer(sessionId, normalizedRootPath, previousPort)
  previewServerRegistry.set(sessionId, next)

  return {
    sessionId: next.sessionId,
    rootPath: next.rootPath,
    baseUrl: next.baseUrl,
  }
}

export async function stopSessionWebPreviewServer(sessionId: string): Promise<void> {
  const existing = previewServerRegistry.get(sessionId)
  if (!existing) return

  previewServerRegistry.delete(sessionId)
  await closeServer(existing.server)
}

export async function resolveSessionHtmlPreview(
  sessionId: string,
  rootPath: string,
  filePath: string,
): Promise<SessionHtmlPreviewResolution> {
  const normalizedRootPath = normalizeRootPath(rootPath)
  const normalizedFilePath = resolve(filePath)
  const extension = extname(normalizedFilePath).toLowerCase()

  if (extension !== '.html' && extension !== '.htm') {
    throw new Error('Only html / htm files can be resolved by the preview server')
  }

  if (!isPathWithinRoot(normalizedRootPath, normalizedFilePath)) {
    throw new Error('HTML file path must remain within the project root')
  }

  const server = await ensureSessionWebPreviewServer(sessionId, normalizedRootPath)
  const relativePath = relative(normalizedRootPath, normalizedFilePath)
    .split(sep)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return {
    ...server,
    filePath: normalizedFilePath,
    url: `${server.baseUrl}${relativePath}`,
  }
}

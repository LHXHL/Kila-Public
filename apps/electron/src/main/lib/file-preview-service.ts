/**
 * 文件预览服务 — 在新 Electron 窗口中预览文件
 *
 * 支持预览类型：
 * - 图片 (png, jpg, gif, webp, svg, bmp)
 * - 视频 (mp4, webm, mov)
 * - Markdown (md)
 * - JSON (json)
 * - XML/HTML (xml, html, htm)
 * - PDF (pdf) — 使用 PDF.js 渲染
 * - DOCX (docx) — 使用 mammoth.js 转 HTML
 * - 其他类型自动调用系统默认应用打开
 *
 * 所有预览窗口自动跟随应用解析后的主题（light/dark）。
 *
 * 安全边界（预览页面注入的是「用户本地文件内容」，必须按不可信内容对待）：
 * - 页面强制 CSP：内联脚本走 sha256 白名单，不含 'unsafe-inline'，
 *   因此 Markdown/DOCX 经 innerHTML 注入的 `<img onerror=...>` 无法执行
 * - 窗口开启 sandbox，禁用 Node、禁止页面自行导航与新开窗口
 * - 工具栏经 document.title 传递的动作**不带任何路径**，主进程只对当前预览文件生效
 * - 临时 HTML 写入 mkdtemp 随机目录，窗口关闭即删除
 *
 * TODO(供应链)：marked / highlight.js / pdfjs-dist / mammoth 仍从 jsDelivr 加载，
 * 已在 CSP 中限定为唯一允许的外部源，但离线不可用且仍依赖 CDN 完整性。
 * 后续应改为随包分发的本地资源（需新增依赖并调整 electron-builder extraResources）。
 */

import { BrowserWindow, shell, nativeTheme } from 'electron'
import { deriveThemeVars, type ThemeVarMap } from '@kila/shared'
import { resolveTheme } from './theme-service'
import { resolve, basename, extname, join } from 'node:path'
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createLogger } from './logger'

const log = createLogger('文件预览')
import { getSettings } from './settings-service'

/** 文件大小限制：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 唯一允许的外部资源源（见文件头 TODO） */
const CDN_ORIGIN = 'https://cdn.jsdelivr.net'

/** 工具栏动作的 title 前缀 */
const PREVIEW_ACTION_PREFIX = '__preview_action__:'

/** 支持预览的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** 支持预览的视频扩展名 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov'])

/** 支持代码高亮预览的扩展名 */
const CODE_EXTENSIONS = new Set(['.json', '.xml', '.html', '.htm'])

/** 支持 Markdown 渲染预览的扩展名 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

/** 支持 PDF 预览的扩展名 */
const PDF_EXTENSIONS = new Set(['.pdf'])

/** 支持 DOCX 预览的扩展名 */
const DOCX_EXTENSIONS = new Set(['.docx'])

type ResolvedPreviewTheme = 'light' | 'dark'

interface ResolvedPreviewAppearance {
  mode: ResolvedPreviewTheme
  vars: ThemeVarMap
}

/** 获取预览类型 */
function getPreviewType(ext: string): 'image' | 'video' | 'markdown' | 'code' | 'pdf' | 'docx' | 'unsupported' {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (DOCX_EXTENSIONS.has(ext)) return 'docx'
  return 'unsupported'
}

/** 转义 HTML 特殊字符 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ===== 临时文件 =====

interface TempPreviewFile {
  /** 独占临时目录，窗口关闭时整体删除 */
  dir: string
  /** HTML 文件绝对路径 */
  file: string
}

/**
 * 将 HTML 写入独占临时目录
 *
 * 原实现用可预测的 `preview-${Date.now()}.html` 且永不清理，
 * 既能被同机其它进程预测/抢占，也会让用户文件内容无限堆积在临时目录。
 */
function writeTempHtml(html: string): TempPreviewFile {
  const dir = mkdtempSync(join(tmpdir(), 'kila-preview-'))
  const file = join(dir, `${randomUUID()}.html`)
  writeFileSync(file, html, { encoding: 'utf-8', mode: 0o600 })
  return { dir, file }
}

// ===== CSP =====

interface PreviewCspOptions {
  /** 内联脚本的 sha256（base64） */
  scriptHashes: string[]
  /** 是否允许 jsDelivr 提供脚本与样式 */
  allowCdn?: boolean
  /** 是否允许 fetch 本地文件与启动 worker（PDF.js 需要） */
  allowFileFetch?: boolean
}

/**
 * 构建预览页面的 CSP
 *
 * 关键点：script-src 只给内联脚本哈希（可选叠加 CDN），绝不含 'unsafe-inline'，
 * 因此被预览内容注入的 `<img onerror=...>` 一类内联处理器会被直接拦截。
 */
export function buildPreviewCsp(options: PreviewCspOptions): string {
  const cdn = options.allowCdn ? [CDN_ORIGIN] : []
  const scriptSources = [...options.scriptHashes.map((hash) => `'sha256-${hash}'`), ...cdn]

  const directives = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    'img-src file: data: blob:',
    'media-src file: blob:',
    'font-src file: data:',
    `style-src 'unsafe-inline'${cdn.length > 0 ? ` ${CDN_ORIGIN}` : ''}`,
    `script-src ${scriptSources.length > 0 ? scriptSources.join(' ') : "'none'"}`,
  ]

  if (options.allowFileFetch) {
    directives.push(`connect-src file: data: blob:${cdn.length > 0 ? ` ${CDN_ORIGIN}` : ''}`)
    directives.push(`worker-src blob:${cdn.length > 0 ? ` ${CDN_ORIGIN}` : ''}`)
  }

  return directives.join('; ')
}

/** 计算内联脚本的 CSP sha256 摘要 */
function scriptHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('base64')
}

// ===== 主题 =====

function hslVar(vars: ThemeVarMap, name: keyof ThemeVarMap): string {
  return `hsl(${vars[name]})`
}

function resolvePreviewTheme(): ResolvedPreviewAppearance {
  const settings = getSettings()
  const mode: ResolvedPreviewTheme = settings.themeMode === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : (settings.themeMode === 'dark' ? 'dark' : 'light')

  return {
    mode,
    vars: deriveThemeVars(resolveTheme(settings.themeId), mode),
  }
}

/** 生成支持 light/dark 主题的通用页面样式 */
function baseStyles(theme: ResolvedPreviewAppearance): string {
  const palette = {
    bg: hslVar(theme.vars, '--background'),
    bgToolbar: hslVar(theme.vars, '--card'),
    border: hslVar(theme.vars, '--border'),
    text: hslVar(theme.vars, '--foreground'),
    textSecondary: `hsl(${theme.vars['--muted-foreground']} / 0.82)`,
    textMuted: `hsl(${theme.vars['--muted-foreground']} / 0.68)`,
    btnBg: hslVar(theme.vars, '--brand-soft'),
    btnBorder: hslVar(theme.vars, '--border'),
    btnHover: hslVar(theme.vars, '--brand-soft-hover'),
    codeBg: hslVar(theme.vars, '--code-surface'),
    contentBg: hslVar(theme.vars, '--workspace'),
    link: hslVar(theme.vars, '--status-info'),
    statusDanger: hslVar(theme.vars, '--status-danger'),
    statusDangerSoft: hslVar(theme.vars, '--status-danger-soft'),
    statusDangerForeground: hslVar(theme.vars, '--status-danger-foreground'),
  }

  return `
    :root {
      color-scheme: ${theme.mode};
      --bg: ${palette.bg};
      --bg-toolbar: ${palette.bgToolbar};
      --border: ${palette.border};
      --text: ${palette.text};
      --text-secondary: ${palette.textSecondary};
      --text-muted: ${palette.textMuted};
      --btn-bg: ${palette.btnBg};
      --btn-border: ${palette.btnBorder};
      --btn-hover: ${palette.btnHover};
      --code-bg: ${palette.codeBg};
      --content-bg: ${palette.contentBg};
      --link: ${palette.link};
      --status-danger: ${palette.statusDanger};
      --status-danger-soft: ${palette.statusDangerSoft};
      --status-danger-foreground: ${palette.statusDangerForeground};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      background: var(--bg-toolbar);
      border-bottom: 1px solid var(--border);
      -webkit-app-region: drag;
      flex-shrink: 0;
    }
    .toolbar-title {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toolbar-path {
      font-size: 11px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }
    .toolbar-btn {
      -webkit-app-region: no-drag;
      padding: 5px 12px;
      border: 1px solid var(--btn-border);
      border-radius: 6px;
      background: var(--btn-bg);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .toolbar-btn:hover { background: var(--btn-hover); border-color: var(--border); }
    .content {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--content-bg);
    }
  `
}

// ===== 文档骨架 =====

/** 生成工具栏 HTML */
function toolbarHtml(filePath: string, filename: string): string {
  return `
  <div class="toolbar">
    <div style="flex:1">
      <div class="toolbar-title">${escapeHtml(filename)}</div>
      <div class="toolbar-path">${escapeHtml(filePath)}</div>
    </div>
    <button class="toolbar-btn" id="btn-open">用默认应用打开</button>
    <button class="toolbar-btn" id="btn-finder">在 Finder 中显示</button>
  </div>`
}

/**
 * 工具栏脚本：只发送动作名，不再携带任何路径
 *
 * 原实现把 filePath 拼进 document.title，主进程直接对该路径 shell.openPath，
 * 被预览的 HTML/Markdown 只要能执行脚本即可诱导主进程打开任意本地文件。
 */
const TOOLBAR_SCRIPT = [
  "document.getElementById('btn-open').onclick=function(){document.title='__preview_action__:open'};",
  "document.getElementById('btn-finder').onclick=function(){document.title='__preview_action__:folder'};",
].join('\n')

interface InlineScript {
  code: string
  module?: boolean
}

interface PreviewDocumentInput {
  filename: string
  filePath: string
  styles: string
  body: string
  /** 内联脚本，按顺序注入并全部计入 CSP 哈希白名单 */
  inlineScripts?: InlineScript[]
  /** 外部资源标签（仅 jsDelivr），需同时开启 allowCdn */
  externalTags?: string
  allowCdn?: boolean
  allowFileFetch?: boolean
}

/** 统一生成带 CSP 的预览文档 */
function renderDocument(input: PreviewDocumentInput): string {
  const scripts: InlineScript[] = [...(input.inlineScripts ?? []), { code: TOOLBAR_SCRIPT }]
  const csp = buildPreviewCsp({
    scriptHashes: scripts.map((script) => scriptHash(script.code)),
    allowCdn: input.allowCdn,
    allowFileFetch: input.allowFileFetch,
  })

  const scriptTags = scripts
    .map((script) => `<script${script.module ? ' type="module"' : ''}>${script.code}</script>`)
    .join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${escapeHtml(input.filename)}</title>
${input.externalTags ?? ''}
<style>${input.styles}</style>
</head><body>
${toolbarHtml(input.filePath, input.filename)}
${input.body}
${scriptTags}
</body></html>`
}

/** 生成可安全嵌入 HTML 的 file:// URL */
function toFileUrl(filePath: string): string {
  return `file://${encodeURI(filePath).replace(/#/g, '%23')}`
}

// ===== 各类型预览页面 =====

/** 生成图片预览 HTML */
function imagePreviewHtml(filePath: string, filename: string, theme: ResolvedPreviewAppearance): string {
  return renderDocument({
    filename,
    filePath,
    styles: `${baseStyles(theme)}
  .content { background: var(--content-bg); }
  .content img { max-width: 100%; max-height: 100%; object-fit: contain; }`,
    body: `<div class="content">
    <img src="${toFileUrl(filePath)}" alt="${escapeHtml(filename)}" />
  </div>`,
  })
}

/** 生成视频预览 HTML */
function videoPreviewHtml(filePath: string, filename: string, theme: ResolvedPreviewAppearance): string {
  return renderDocument({
    filename,
    filePath,
    styles: `${baseStyles(theme)}
  .content video { max-width: 100%; max-height: 100%; }`,
    body: `<div class="content">
    <video src="${toFileUrl(filePath)}" controls autoplay style="outline:none"></video>
  </div>`,
  })
}

/** 生成 Markdown 预览 HTML */
function markdownPreviewHtml(
  filePath: string,
  filename: string,
  textContent: string,
  theme: ResolvedPreviewAppearance,
): string {
  // marked 输出未做 sanitize，安全性依赖 CSP 拦截内联事件处理器
  const renderScript = `const raw = ${JSON.stringify(textContent)};
    document.getElementById('md-content').innerHTML = typeof marked !== 'undefined'
      ? marked.parse(raw)
      : '<pre>' + raw.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';`

  return renderDocument({
    filename,
    filePath,
    allowCdn: true,
    externalTags: `<script src="${CDN_ORIGIN}/npm/marked@15/marked.min.js"></script>`,
    styles: `${baseStyles(theme)}
  .content { display: block; padding: 24px 32px; align-items: stretch; overflow-y: auto; }
  .markdown-body { max-width: 800px; margin: 0 auto; font-size: 14px; line-height: 1.7; color: var(--text); }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin: 1em 0 0.5em; }
  .markdown-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 1.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
  .markdown-body h3 { font-size: 1.15em; }
  .markdown-body p { margin: 0.8em 0; }
  .markdown-body code {
    background: var(--code-bg); padding: 2px 6px; border-radius: 4px;
    font-size: 0.9em; font-family: 'SF Mono', Monaco, Menlo, monospace;
  }
  .markdown-body pre { background: var(--code-bg); padding: 12px 16px; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
  .markdown-body pre code { background: none; padding: 0; }
  .markdown-body blockquote { border-left: 3px solid var(--border); padding-left: 12px; color: var(--text-muted); margin: 1em 0; }
  .markdown-body ul, .markdown-body ol { padding-left: 2em; margin: 0.5em 0; }
  .markdown-body li { margin: 0.3em 0; }
  .markdown-body a { color: var(--link); text-decoration: none; }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  .markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .markdown-body th { background: var(--code-bg); }
  .markdown-body img { max-width: 100%; border-radius: 8px; }
  .markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }`,
    body: `<div class="content">
    <div class="markdown-body" id="md-content"></div>
  </div>`,
    inlineScripts: [{ code: renderScript }],
  })
}

/** 生成代码/文本预览 HTML */
function codePreviewHtml(
  filePath: string,
  filename: string,
  textContent: string,
  ext: string,
  theme: ResolvedPreviewAppearance,
): string {
  const langMap: Record<string, string> = {
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.htm': 'html',
  }
  const lang = langMap[ext] || 'text'
  const hljsTheme = theme.mode === 'dark' ? 'github-dark' : 'github'

  const highlightScript = `if (typeof hljs !== 'undefined') {
      hljs.highlightElement(document.getElementById('code-content'));
    }`

  return renderDocument({
    filename,
    filePath,
    allowCdn: true,
    externalTags: `<link rel="stylesheet" href="${CDN_ORIGIN}/npm/highlight.js@11/styles/${hljsTheme}.min.css">
<script src="${CDN_ORIGIN}/npm/highlight.js@11/highlight.min.js"></script>`,
    styles: `${baseStyles(theme)}
  .content { display: block; padding: 0; align-items: stretch; overflow: auto; }
  pre {
    padding: 16px 20px; font-family: 'SF Mono', Monaco, Menlo, monospace;
    font-size: 13px; line-height: 1.6; color: var(--text);
    white-space: pre-wrap; word-break: break-all; tab-size: 2;
    width: 100%; min-height: 100%; background: var(--code-bg);
  }`,
    body: `<div class="content">
    <pre><code class="language-${lang}" id="code-content">${escapeHtml(textContent)}</code></pre>
  </div>`,
    inlineScripts: [{ code: highlightScript }],
  })
}

/** 生成 PDF 预览 HTML（使用 PDF.js 渲染，兼容性优于 Chromium 内置查看器） */
function pdfPreviewHtml(filePath: string, filename: string, theme: ResolvedPreviewAppearance): string {
  const renderScript = `import * as pdfjsLib from '${CDN_ORIGIN}/npm/pdfjs-dist@4/build/pdf.min.mjs';

    pdfjsLib.GlobalWorkerOptions.workerSrc = '${CDN_ORIGIN}/npm/pdfjs-dist@4/build/pdf.worker.min.mjs';

    const container = document.getElementById('pdf-container');
    const fileUrl = ${JSON.stringify(toFileUrl(filePath))};

    async function renderPDF() {
      try {
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;
        container.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          // 使用 2x 缩放以获得清晰渲染
          const scale = 2;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // 显示宽度为实际宽度的一半（Retina 清晰度）
          canvas.style.width = (viewport.width / scale) + 'px';
          canvas.style.height = (viewport.height / scale) + 'px';

          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          container.appendChild(canvas);
        }

        const info = document.createElement('div');
        info.className = 'page-info';
        info.textContent = '共 ' + pdf.numPages + ' 页';
        container.appendChild(info);
      } catch (err) {
        container.textContent = 'PDF 加载失败: ' + err.message;
        container.className = 'content error-msg';
      }
    }

    renderPDF();`

  return renderDocument({
    filename,
    filePath,
    allowCdn: true,
    allowFileFetch: true,
    styles: `${baseStyles(theme)}
  .content {
    display: flex; flex-direction: column; align-items: center;
    overflow: auto; padding: 16px; gap: 12px; background: var(--content-bg);
  }
  canvas { max-width: 100%; border: 1px solid var(--border); border-radius: 10px; background: white; }
  .page-info { font-size: 12px; color: var(--text-muted); text-align: center; padding: 4px 0; }
  .loading-msg { text-align: center; color: var(--text-muted); padding: 40px; }
  .error-msg {
    color: var(--status-danger-foreground); background: var(--status-danger-soft);
    border: 1px solid var(--status-danger); border-radius: 12px; padding: 20px; text-align: center;
  }`,
    body: `<div class="content" id="pdf-container">
    <div class="loading-msg">正在加载 PDF...</div>
  </div>`,
    inlineScripts: [{ code: renderScript, module: true }],
  })
}

/** 生成 DOCX 预览 HTML（使用 mammoth.js 转换为 HTML） */
function docxPreviewHtml(
  filePath: string,
  filename: string,
  base64Data: string,
  theme: ResolvedPreviewAppearance,
): string {
  // mammoth 输出同样未 sanitize，安全性依赖 CSP 拦截内联事件处理器
  const convertScript = `const base64 = ${JSON.stringify(base64Data)};
    const container = document.getElementById('docx-content');

    function base64ToArrayBuffer(b64) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    if (typeof mammoth !== 'undefined') {
      mammoth.convertToHtml({ arrayBuffer: base64ToArrayBuffer(base64) })
        .then(function(result) {
          container.innerHTML = result.value;
        })
        .catch(function(err) {
          container.textContent = '文档解析失败: ' + err.message;
          container.className = 'error';
        });
    } else {
      container.textContent = 'mammoth.js 加载失败，请检查网络连接';
      container.className = 'error';
    }`

  return renderDocument({
    filename,
    filePath,
    allowCdn: true,
    externalTags: `<script src="${CDN_ORIGIN}/npm/mammoth@1/mammoth.browser.min.js"></script>`,
    styles: `${baseStyles(theme)}
  .content { display: block; padding: 24px 32px; align-items: stretch; overflow-y: auto; }
  .docx-body { max-width: 800px; margin: 0 auto; font-size: 14px; line-height: 1.7; color: var(--text); }
  .docx-body h1, .docx-body h2, .docx-body h3 { margin: 1em 0 0.5em; }
  .docx-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  .docx-body h2 { font-size: 1.4em; }
  .docx-body h3 { font-size: 1.15em; }
  .docx-body p { margin: 0.8em 0; }
  .docx-body table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  .docx-body th, .docx-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  .docx-body th { background: var(--code-bg); }
  .docx-body img { max-width: 100%; border-radius: 8px; }
  .docx-body ul, .docx-body ol { padding-left: 2em; margin: 0.5em 0; }
  .docx-body li { margin: 0.3em 0; }
  .docx-body a { color: var(--link); }
  .loading { text-align: center; color: var(--text-muted); padding: 40px; }
  .error {
    color: var(--status-danger-foreground); background: var(--status-danger-soft);
    border: 1px solid var(--status-danger); border-radius: 12px; padding: 20px;
  }`,
    body: `<div class="content">
    <div class="docx-body" id="docx-content">
      <div class="loading">正在解析文档...</div>
    </div>
  </div>`,
    inlineScripts: [{ code: convertScript }],
  })
}

// ===== 窗口 =====

/** 工具栏可执行的动作 */
export type PreviewTitleAction = 'open' | 'folder'

/**
 * 解析预览窗口通过 document.title 发来的动作
 *
 * 只接受严格等于 `__preview_action__:open` / `__preview_action__:folder` 的无参形式。
 * 任何携带路径的 title（如 `__preview_action__:open:/etc/passwd`）一律返回 null，
 * 主进程因此只会对「当前正在预览的文件」执行动作。
 */
export function parsePreviewTitleAction(title: string): PreviewTitleAction | null {
  if (typeof title !== 'string' || !title.startsWith(PREVIEW_ACTION_PREFIX)) return null

  const action = title.slice(PREVIEW_ACTION_PREFIX.length)
  if (action === 'open') return 'open'
  if (action === 'folder') return 'folder'

  log.warn('[文件预览] 拒绝无法识别的预览动作，可能来自被预览内容的注入')
  return null
}

/** 创建预览窗口并绑定工具栏事件 */
function createPreviewWindow(filename: string, targetPath: string, tempDir: string): BrowserWindow {
  const previewWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: filename,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      // 预览页面注入的是不可信的用户文件内容，必须开启渲染进程沙箱
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
    },
  })

  previewWindow.setMenuBarVisibility(false)

  // 禁止预览页面自行导航或开新窗口
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  previewWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // 监听 title 变化处理工具栏按钮：动作不带路径，只作用于当前预览文件
  previewWindow.on('page-title-updated', (event, title) => {
    const action = parsePreviewTitleAction(title)
    if (!action) return

    event.preventDefault()
    if (action === 'open') {
      shell.openPath(targetPath)
    } else {
      shell.showItemInFolder(targetPath)
    }
    previewWindow.setTitle(filename)
  })

  // 窗口关闭即清理临时 HTML，避免用户文件内容长期留在临时目录
  previewWindow.on('closed', () => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch (error) {
      log.warn('[文件预览] 清理临时预览文件失败:', error)
    }
  })

  return previewWindow
}

/**
 * 在新窗口中预览文件
 * 不支持的文件类型会调用系统默认应用打开
 */
export function openFilePreview(filePath: string): void {
  const safePath = resolve(filePath)
  const filename = basename(safePath)
  const ext = extname(safePath).toLowerCase()
  const previewType = getPreviewType(ext)
  const resolvedTheme = resolvePreviewTheme()

  if (!existsSync(safePath)) {
    log.warn(`[文件预览] 文件不存在，跳过预览: ${safePath}`)
    return
  }

  // 不支持的类型，直接用系统默认应用打开
  if (previewType === 'unsupported') {
    shell.openPath(safePath)
    return
  }

  // 检查文件大小
  const stat = statSync(safePath)
  if (stat.size > MAX_FILE_SIZE) {
    log.warn(`[文件预览] 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，使用系统应用打开`)
    shell.openPath(safePath)
    return
  }

  let html: string

  if (previewType === 'pdf') {
    html = pdfPreviewHtml(safePath, filename, resolvedTheme)
  } else if (previewType === 'image') {
    html = imagePreviewHtml(safePath, filename, resolvedTheme)
  } else if (previewType === 'video') {
    html = videoPreviewHtml(safePath, filename, resolvedTheme)
  } else if (previewType === 'docx') {
    const buffer = readFileSync(safePath)
    html = docxPreviewHtml(safePath, filename, buffer.toString('base64'), resolvedTheme)
  } else {
    const textContent = readFileSync(safePath, 'utf-8')
    html = previewType === 'markdown'
      ? markdownPreviewHtml(safePath, filename, textContent, resolvedTheme)
      : codePreviewHtml(safePath, filename, textContent, ext, resolvedTheme)
  }

  // 将 HTML 写入独占临时目录（避免 data: URL 大小限制），窗口关闭时清理
  const temp = writeTempHtml(html)
  const previewWindow = createPreviewWindow(filename, safePath, temp.dir)
  previewWindow.loadFile(temp.file)
}

/** 仅供测试：验证预览文档的 CSP 与工具栏脚本 */
export const __previewInternals = {
  markdownPreviewHtml,
  codePreviewHtml,
  TOOLBAR_SCRIPT,
  scriptHash,
}

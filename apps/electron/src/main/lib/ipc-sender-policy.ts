import { fileURLToPath } from 'node:url'
import { normalize, sep } from 'node:path'

const DEV_RENDERER_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

/**
 * 判断 IPC 来源 URL 是否属于 Kila 自己的 Renderer。
 * 生产环境仅接受打包后的 renderer/index.html；开发环境额外接受固定 Vite origin。
 */
export function isTrustedRendererUrl(rawUrl: string, packaged: boolean): boolean {
  if (!rawUrl || rawUrl.length > 8192) return false

  try {
    const url = new URL(rawUrl)
    if (!packaged && DEV_RENDERER_ORIGINS.has(url.origin)) {
      return url.username === '' && url.password === ''
    }

    if (url.protocol !== 'file:' || url.host !== '') return false
    const pathname = normalize(fileURLToPath(url))
    return pathname.endsWith(`${sep}renderer${sep}index.html`)
  } catch {
    return false
  }
}

interface IpcPayloadBudget {
  nodes: number
  stringUnits: number
}

const MAX_IPC_DEPTH = 24
const MAX_IPC_NODES = 50_000
const MAX_IPC_STRING_UNITS = 8 * 1024 * 1024

/**
 * 对所有 invoke 参数执行统一资源预算检查，阻止超深对象或超大字符串拖垮主进程。
 * 具体业务字段的语义与路径校验仍由各 handler 负责。
 */
export function assertSafeIpcPayload(args: readonly unknown[]): void {
  const budget: IpcPayloadBudget = { nodes: 0, stringUnits: 0 }
  const seen = new WeakSet<object>()

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_IPC_DEPTH) throw new Error('IPC 参数嵌套过深')
    budget.nodes += 1
    if (budget.nodes > MAX_IPC_NODES) throw new Error('IPC 参数元素过多')

    if (typeof value === 'string') {
      budget.stringUnits += value.length
      if (budget.stringUnits > MAX_IPC_STRING_UNITS) throw new Error('IPC 参数体积过大')
      return
    }
    if (!value || typeof value !== 'object') return
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) return
    if (seen.has(value)) throw new Error('IPC 参数包含循环引用')
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      budget.stringUnits += key.length
      if (budget.stringUnits > MAX_IPC_STRING_UNITS) throw new Error('IPC 参数体积过大')
      visit(item, depth + 1)
    }
  }

  visit(args, 0)
}

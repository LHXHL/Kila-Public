/**
 * cua-driver 在 Windows 上的 launch_app 参数预检
 *
 * 从 mcp-server-manager 抽出：这段逻辑只服务于 `cua-driver` 这一台 MCP 服务器，
 * 和「MCP 连接生命周期」无关，放在通用客户端里既撑大文件又混淆职责。
 * 模型经常把 macOS bundle id 直接丢给 Windows，这里在真正 launch 之前先纠正或拦下。
 */

import { createLogger } from './logger'

const log = createLogger('MCP CUA')

/** 只取预检需要的字段，避免与 mcp-server-manager 形成类型循环依赖 */
interface CuaToolCallResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
}

type CuaToolCaller = (params: {
  name: string
  arguments?: Record<string, unknown>
}) => Promise<CuaToolCallResult>

export type CuaLaunchArgsPreparation =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string }

function readStringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isWindowsPathLike(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || /[\\/]/.test(value)
}

function hasUrlLaunchTargets(args: Record<string, unknown>): boolean {
  return Array.isArray(args.urls) && args.urls.some((item) => readStringArg(item))
}

function normalizeWindowsAppIdentifier(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

function windowsAppIdentifierCandidates(value: unknown): string[] {
  const raw = readStringArg(value)
  if (!raw) return []

  const normalized = normalizeWindowsAppIdentifier(raw)
  const basename = raw.split(/[\\/]/).pop()
  return basename && basename !== raw
    ? [normalized, normalizeWindowsAppIdentifier(basename)]
    : [normalized]
}

function parseToolResultJsonObject(content: unknown): Record<string, unknown> | null {
  const text = Array.isArray(content)
    ? content
        .map((item) => item && typeof item === 'object' && 'text' in item
          ? String((item as { text?: unknown }).text ?? '')
          : '')
        .join('\n')
    : typeof content === 'string'
      ? content
      : ''
  if (!text.trim()) return null

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function matchesCuaWindowsApp(
  apps: Array<Record<string, unknown>>,
  target: string,
): boolean {
  const normalizedTarget = normalizeWindowsAppIdentifier(target)
  return apps.some((app) => {
    const candidates = [app.name, app.bundle_id, app.launch_path, app.path, app.aumid]
      .flatMap((value) => windowsAppIdentifierCandidates(value))
    return candidates.some(
      (candidate) =>
        candidate === normalizedTarget ||
        candidate.includes(normalizedTarget) ||
        normalizedTarget.includes(candidate),
    )
  })
}

async function listCuaWindowsApps(
  callTool: CuaToolCaller,
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const result = await callTool({ name: 'list_apps', arguments: {} })
    if (
      result.structuredContent &&
      typeof result.structuredContent === 'object' &&
      Array.isArray((result.structuredContent as { apps?: unknown }).apps)
    ) {
      return (result.structuredContent as { apps: Array<Record<string, unknown>> }).apps
    }

    const parsed = parseToolResultJsonObject(result.content)
    if (parsed && Array.isArray(parsed.apps)) {
      return parsed.apps as Array<Record<string, unknown>>
    }
  } catch (error) {
    log.warn('[MCP CUA] Windows launch 预检查询应用列表失败:', error)
  }
  return null
}

/** 判断当前调用是否需要走 Windows launch 预检 */
export function shouldPrepareCuaWindowsLaunch(serverName: string, toolName: string): boolean {
  return toolName === 'launch_app' && process.platform === 'win32' && serverName === 'cua-driver'
}

/**
 * 预检并纠正 Windows 下的 launch_app 参数
 *
 * - bundle_id 实际是 Windows 路径时改写成 path
 * - 已给出 path / launch_path / aumid / urls 时直接放行
 * - 只给了名称时先对照 list_apps 校验，避免拿 macOS bundle id 去启动
 */
export async function prepareCuaWindowsLaunchArgs(
  args: Record<string, unknown>,
  callTool: CuaToolCaller,
): Promise<CuaLaunchArgsPreparation> {
  const normalizedArgs = { ...args }
  const bundleId = readStringArg(normalizedArgs.bundle_id)
  const name = readStringArg(normalizedArgs.name)

  if (bundleId && !bundleId.includes('!') && isWindowsPathLike(bundleId)) {
    delete normalizedArgs.bundle_id
    if (!readStringArg(normalizedArgs.path) && !readStringArg(normalizedArgs.launch_path)) {
      normalizedArgs.path = bundleId
    }
    return { ok: true, args: normalizedArgs }
  }

  if (
    readStringArg(normalizedArgs.path) ||
    readStringArg(normalizedArgs.launch_path) ||
    readStringArg(normalizedArgs.aumid) ||
    (bundleId && bundleId.includes('!')) ||
    hasUrlLaunchTargets(normalizedArgs)
  ) {
    return { ok: true, args: normalizedArgs }
  }

  const target = bundleId || name
  if (!target) {
    return { ok: true, args: normalizedArgs }
  }

  const apps = await listCuaWindowsApps(callTool)
  if (!apps) {
    return {
      ok: false,
      error: 'Unable to validate the Windows app target before launching. Call list_apps first, then retry with a Windows name, path, launch_path, or aumid.',
    }
  }

  if (!matchesCuaWindowsApp(apps, target)) {
    return {
      ok: false,
      error: `Windows app target '${target}' was not found. Call list_apps first and use a Windows app name, path, launch_path, or aumid. Do not use macOS bundle ids on Windows.`,
    }
  }

  return { ok: true, args: normalizedArgs }
}

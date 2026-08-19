/**
 * Agent 工具名治理
 *
 * 统一处理「多来源工具合并到同一张工具表」时的命名冲突：
 * - Pi 内置 coding 工具（read/bash/edit/write）与 Kila 内置工具先占位
 * - MCP 工具遇到已占用的名字时降级为 `{服务器名}__{工具名}`
 * - 合并阶段一律「先到者保留」，任何冲突都写中文告警日志
 *
 * 单独成模块是为了让这段纯逻辑脱离 Electron 主进程依赖，能被直接单测。
 */

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { createLogger } from './logger'

const log = createLogger('Agent 工具名')

/**
 * 异构 Agent 工具的通用容器类型。
 *
 * Pi 的 `AgentTool<TParameters>` 把 `execute` 声明为属性而不是方法，
 * 其入参 `Static<TParameters>` 在 strictFunctionTypes 下是逆变的，
 * 因此 `AgentTool<具体 Schema>` 无法赋值给 `AgentTool<TSchema>` 或 `AgentTool<TObject>`。
 * 要把不同 schema 的工具装进同一个数组，容器类型只能退化到 `AgentTool<any>`。
 * 这里集中定义一次，避免 `any` 继续在业务代码里扩散。
 */
// biome-ignore lint/suspicious/noExplicitAny: Pi 把 execute 声明为属性且 Static<TParameters> 在 strictFunctionTypes 下逆变，AgentTool<TObject> / AgentTool<unknown> 都无法容纳异构工具数组；这里是全仓唯一收口点
export type AnyAgentTool = AgentTool<any>

/**
 * 规范化工具定义，使同一组工具在不同启动/文件系统顺序下产生字节一致的请求前缀。
 *
 * 只排序对象 key，不排序 schema 数组（required/enum/anyOf 的顺序可能具有语义），
 * 因此不会改变工具行为；返回新对象也避免破坏 MCP/内置工具持有的原始 schema。
 */
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item))
  if (!value || typeof value !== 'object') return value

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(input).sort()) {
    output[key] = canonicalizeJson(input[key])
  }
  return output
}

export function canonicalizeAgentTools(tools: AnyAgentTool[]): AnyAgentTool[] {
  return [...tools]
    .sort((left, right) => {
      if (left.name < right.name) return -1
      if (left.name > right.name) return 1
      return 0
    })
    .map((tool) => ({
      ...tool,
      parameters: canonicalizeJson(tool.parameters) as never,
    }))
}

/** 工具名归一化：冲突判定必须大小写不敏感，否则 `Read` 会绕过 `read` 的占位 */
export function normalizeToolNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** 一组待合并的工具及其来源标签（来源仅用于冲突日志） */
export interface AgentToolGroup {
  /** 来源描述，例如「Pi 内置编码工具」「MCP 工具」 */
  source: string
  tools?: AnyAgentTool[]
}

/**
 * 收集已被占用的工具名（归一化后）。
 *
 * 用于在拉取 MCP 工具之前，把内置工具名预置进去，
 * 让冲突的 MCP 工具自动降级而不是顶替内置工具。
 */
export function collectReservedToolNames(
  ...toolSets: Array<AnyAgentTool[] | undefined>
): Set<string> {
  const reserved = new Set<string>()
  for (const toolSet of toolSets) {
    for (const tool of toolSet ?? []) {
      reserved.add(normalizeToolNameKey(tool.name))
    }
  }
  return reserved
}

/**
 * 为 MCP 工具分配一个不与 `usedNames` 冲突的可见名。
 *
 * 冲突时降级为 `{服务器名}__{工具名}`，仍然冲突则追加序号。
 * `usedNames` 存的是归一化后的键，调用方必须先把内置工具名放进去，
 * 否则 MCP 暴露的 read/write/edit/bash 会在合并阶段和内置工具撞名。
 */
export function ensureUniqueToolName(
  toolName: string,
  serverName: string,
  usedNames: Set<string>,
): string {
  const directKey = normalizeToolNameKey(toolName)
  if (!usedNames.has(directKey)) {
    usedNames.add(directKey)
    return toolName
  }

  const prefixed = `${serverName}__${toolName}`
  const prefixedKey = normalizeToolNameKey(prefixed)
  if (!usedNames.has(prefixedKey)) {
    usedNames.add(prefixedKey)
    return prefixed
  }

  let counter = 2
  let candidate = `${prefixed}_${counter}`
  while (usedNames.has(normalizeToolNameKey(candidate))) {
    counter += 1
    candidate = `${prefixed}_${counter}`
  }
  usedNames.add(normalizeToolNameKey(candidate))
  return candidate
}

/**
 * 合并多来源工具集合，冲突时「先到者保留」。
 *
 * 旧实现是「后写入者覆盖」，且调用顺序把 MCP 工具排在内置工具之后，
 * 任一 MCP 服务器暴露 read/write/edit/bash 就会静默顶替真实的文件与 shell 工具，
 * 连带让 bash 追踪（后台任务面板、进程管理）一起失效，而且全程无日志。
 * 现在改为保留先注册的工具，并对每次冲突输出告警，说明谁被谁挡下。
 */
export function mergeAgentTools(groups: AgentToolGroup[]): AnyAgentTool[] {
  const merged = new Map<string, { tool: AnyAgentTool; source: string }>()

  for (const group of groups) {
    for (const tool of group.tools ?? []) {
      const key = normalizeToolNameKey(tool.name)
      const existing = merged.get(key)
      if (existing) {
        log.warn(
          `[Agent 工具名] 工具名冲突：${tool.name}（来源：${group.source}）`
          + ` 与已注册的 ${existing.tool.name}（来源：${existing.source}）重名，`
          + '已保留先注册的工具并丢弃后来者',
        )
        continue
      }
      merged.set(key, { tool, source: group.source })
    }
  }

  return [...merged.values()].map((item) => item.tool)
}

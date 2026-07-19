/**
 * MentionSuggestions — Skill / MCP 的 TipTap Mention Suggestion 统一配置
 *
 * 泛型工厂 createMentionSuggestion 封装公共逻辑（渲染、定位、键盘导航），
 * 通过 MentionSuggestionConfig 注入差异部分（触发字符、数据获取、行渲染）。
 */

import type React from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { Terminal, Wand2, Server } from 'lucide-react'
import { buildGlobalSkillMentionId } from '@kila/shared'
import type { GlobalSkillEntrySource } from '@kila/shared'
import { MentionList } from './MentionList'
import type { MentionListRef } from './MentionList'
import { createMentionPopup, positionPopup } from './mention-popup-utils'

// ===== 泛型工厂 =====

interface MentionCommandResult {
  id: string
  label: string
  plainText?: string
}

interface MentionSuggestionConfig<T> {
  /** 触发字符 */
  char: string
  /** 空列表占位文字 */
  emptyText: string
  /** 异步获取列表项 */
  fetchItems: (sessionId: string, query: string) => Promise<T[]>
  /** 提取唯一 key */
  keyExtractor: (item: T) => string
  /** 渲染列表项 */
  renderItem: (item: T) => React.ReactNode
  /** 选中后传给 command 的 id 和 label */
  toCommand: (item: T) => MentionCommandResult
}

function insertMentionCommand(
  editor: Parameters<NonNullable<SuggestionOptions['command']>>[0]['editor'],
  range: Parameters<NonNullable<SuggestionOptions['command']>>[0]['range'],
  char: string,
  command: MentionCommandResult,
): void {
  if (command.plainText) {
    editor
      .chain()
      .focus()
      .insertContentAt(range, command.plainText)
      .run()
    editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd()
    return
  }

  const nodeAfter = editor.view.state.selection.$to.nodeAfter
  const overrideSpace = nodeAfter?.text?.startsWith(' ')
  const insertRange = { ...range }
  if (overrideSpace) {
    insertRange.to += 1
  }

  editor
    .chain()
    .focus()
    .insertContentAt(insertRange, [
      {
        type: 'mention',
        attrs: { id: command.id, label: command.label, mentionSuggestionChar: char },
      },
      {
        type: 'text',
        text: ' ',
      },
    ])
    .run()

  editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd()
}

function createMentionSuggestion<T>(
  config: MentionSuggestionConfig<T>,
  sessionIdRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
): Omit<SuggestionOptions<T>, 'editor'> {
  return {
    char: config.char,
    allowSpaces: false,
    command: ({ editor, range, props }) => {
      insertMentionCommand(editor, range, config.char, props as MentionCommandResult)
    },

    items: async ({ query }): Promise<T[]> => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return []
      try {
        return await config.fetchItems(sessionId, (query ?? '').toLowerCase())
      } catch {
        return []
      }
    },

    render: () => {
      let renderer: ReactRenderer<MentionListRef> | null = null
      let popup: HTMLDivElement | null = null

      return {
        onStart(props) {
          mentionActiveRef.current = true
          renderer = new ReactRenderer(MentionList, {
            props: {
              items: props.items,
              selectedIndex: 0,
              emptyText: config.emptyText,
              keyExtractor: config.keyExtractor,
              renderItem: config.renderItem,
              onSelect: (item: T) => {
                props.command(config.toCommand(item))
              },
            },
            editor: props.editor,
          })
          popup = createMentionPopup(renderer.element)
          positionPopup(popup, props.clientRect?.())
        },

        onUpdate(props) {
          renderer?.updateProps({ items: props.items })
          positionPopup(popup, props.clientRect?.())
        },

        onKeyDown(props) {
          return renderer?.ref?.onKeyDown({ event: props.event }) ?? false
        },

        onExit() {
          mentionActiveRef.current = false
          popup?.remove()
          popup = null
          renderer?.destroy()
          renderer = null
        },
      }
    },
  }
}

// ===== Skill 配置 =====

export interface SkillMentionItem {
  kind: 'skill'
  id: string
  name: string
  slug: string
  source: GlobalSkillEntrySource
  sourceLabel: string
  description?: string
}

interface SlashCommandItem {
  kind: 'command'
  id: 'compact'
  name: '/compact'
  description: string
}

type SlashMentionItem = SkillMentionItem | SlashCommandItem

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    kind: 'command',
    id: 'compact',
    name: '/compact',
    description: '压缩session历史以节省 token',
  },
]

const SKILL_SOURCE_ORDER: Record<GlobalSkillEntrySource, number> = {
  kila: 0,
  codex: 1,
  claude: 2,
}

function compareSkillMentionItems(a: SkillMentionItem, b: SkillMentionItem): number {
  const sourceDiff = SKILL_SOURCE_ORDER[a.source] - SKILL_SOURCE_ORDER[b.source]
  if (sourceDiff !== 0) return sourceDiff
  const left = (a.name || a.id).toLowerCase()
  const right = (b.name || b.id).toLowerCase()
  return left.localeCompare(right)
}

export async function listEnabledSkillMentionItems(query = ''): Promise<SkillMentionItem[]> {
  const normalizedQuery = query.toLowerCase()
  const entries = await window.electronAPI.getGlobalAgentSkills()
  return entries
    .filter((entry) => entry.kind === 'skill' && entry.enabled)
    .filter((entry) => (
      !normalizedQuery
      || entry.name.toLowerCase().includes(normalizedQuery)
      || entry.slug.toLowerCase().includes(normalizedQuery)
      || (entry.description ?? '').toLowerCase().includes(normalizedQuery)
      || entry.sourceLabel.toLowerCase().includes(normalizedQuery)
    ))
    .map((entry) => ({
      kind: 'skill' as const,
      id: buildGlobalSkillMentionId({ source: entry.source, slug: entry.slug }),
      name: entry.name,
      slug: entry.slug,
      source: entry.source,
      sourceLabel: entry.sourceLabel,
      description: entry.description,
    }))
    .sort(compareSkillMentionItems)
}

function listSlashMentionItems(query = ''): Promise<SlashMentionItem[]> {
  const normalizedQuery = query.toLowerCase()
  const commandItems = SLASH_COMMANDS.filter((item) => (
    !normalizedQuery
    || item.name.toLowerCase().includes(normalizedQuery)
    || item.description.toLowerCase().includes(normalizedQuery)
  ))
  return listEnabledSkillMentionItems(query)
    .then((skillItems) => [...commandItems, ...skillItems])
}

export function renderSkillMentionItem(item: SlashMentionItem): React.ReactNode {
  if (item.kind === 'command') {
    return (
      <>
        <Terminal className="mt-0.5 size-3.5 flex-shrink-0 text-[hsl(var(--status-success))]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{item.name}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground/55">
            {item.description}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Wand2 className="mt-0.5 size-3.5 flex-shrink-0 text-[hsl(var(--brand-soft-foreground))]" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
          <span className="shrink-0 rounded-full border border-border/55 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
            {item.sourceLabel}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/55">
          {item.description || item.slug}
        </div>
      </div>
    </>
  )
}

export function createSkillMentionSuggestion(
  sessionIdRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
) {
  return createMentionSuggestion<SlashMentionItem>(
    {
      char: '/',
      emptyText: '无匹配命令或 Skill',
      fetchItems: async (_sessionId, q) => listSlashMentionItems(q),
      keyExtractor: (item) => item.id,
      renderItem: renderSkillMentionItem,
      toCommand: (item) => item.kind === 'command'
        ? { id: item.id, label: item.name, plainText: item.name }
        : { id: item.id, label: item.name },
    },
    sessionIdRef,
    mentionActiveRef,
  )
}

// ===== MCP 配置 =====

export interface McpMentionItem {
  id: string
  name: string
  type: string
}

export function createMcpMentionSuggestion(
  sessionIdRef: React.RefObject<string | null>,
  mentionActiveRef: React.MutableRefObject<boolean>,
) {
  return createMentionSuggestion<McpMentionItem>(
    {
      char: '#',
      emptyText: '无匹配 MCP 服务',
      fetchItems: async (_sessionId, q) => {
        const caps = await window.electronAPI.getGlobalAgentCapabilities()
        return caps.mcpServers
          .filter((s) => s.enabled)
          .filter((s) => !q || s.name.toLowerCase().includes(q))
          .map((s) => ({ id: s.name, name: s.name, type: s.type }))
      },
      keyExtractor: (item) => item.id,
      renderItem: (item) => (
        <>
          <Server className="size-3.5 flex-shrink-0 text-[hsl(var(--status-info))]" />
          <span className="truncate font-medium flex-1 min-w-0">{item.name}</span>
          <span className="truncate text-[10px] text-muted-foreground/50 max-w-[120px]">{item.type}</span>
        </>
      ),
      toCommand: (item) => ({ id: item.id, label: item.name }),
    },
    sessionIdRef,
    mentionActiveRef,
  )
}

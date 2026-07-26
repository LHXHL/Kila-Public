import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ArrowRight, Sparkles, GitBranch, PenLine, Search } from 'lucide-react'
import { UserAvatar } from '@/components/message/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
import { sessionQuickSuggestionsAtom } from '@/atoms/agent-ui-atoms'
import type { QuickSuggestion } from '@kila/shared'

const WELCOME_DESCRIPTION = '描述要完成的任务，或选择一个常用操作。'

interface AgentWelcomeStateProps {
  sessionPath?: string | null
  onUsePrompt?: (prompt: string) => void
}

interface StarterPrompt {
  title: string
  detail: string
  prompt: string
  icon: React.ComponentType<{ className?: string }>
}

const FALLBACK_PROMPTS: StarterPrompt[] = [
  {
    title: '梳理今天要推进的事',
    detail: '目标、约束、第一步',
    prompt: '帮我梳理今天这个会话要推进的工作：先确认目标、列出约束，再给出可执行的第一步。',
    icon: PenLine,
  },
  {
    title: '审查当前项目风险',
    detail: '入口、变更点、验证路径',
    prompt: '请从当前项目出发，帮我做一次快速代码审查：找入口、关键数据流、潜在风险，并给出验证步骤。',
    icon: Search,
  },
  {
    title: '把想法拆成计划',
    detail: '范围、取舍、落地顺序',
    prompt: '我有一个粗略想法，帮我把它拆成清晰计划：范围、非目标、实现顺序、验证方式都要列出来。',
    icon: GitBranch,
  },
]

const ICONS: React.ComponentType<{ className?: string }>[] = [PenLine, Search, GitBranch]

function getDisplayName(userName: string): string {
  const trimmed = userName.trim()
  return trimmed || '你'
}

function toStarterPrompts(suggestions: QuickSuggestion[]): StarterPrompt[] {
  return suggestions.map((s, i) => ({
    title: s.title,
    detail: s.detail,
    prompt: s.prompt,
    icon: ICONS[i % ICONS.length] ?? Sparkles,
  }))
}

export function AgentWelcomeState({
  sessionPath,
  onUsePrompt,
}: AgentWelcomeStateProps): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const suggestions = useAtomValue(sessionQuickSuggestionsAtom)
  const displayName = getDisplayName(userProfile.userName)
  const projectName = sessionPath?.split(/[\\/]/).filter(Boolean).pop() ?? null

  // LLM 建议已在应用启动时生成并缓存，直接读取；无缓存则显示静态 fallback
  const displayPrompts = suggestions.length > 0 ? toStarterPrompts(suggestions) : FALLBACK_PROMPTS

  return (
    <div className="flex h-full min-h-[460px] items-center justify-center px-4 py-8 md:px-8">
      <section className="w-full max-w-[760px]">
        <div className="mb-7 flex items-start gap-4">
          <UserAvatar
            avatar={userProfile.avatar}
            size={48}
            className="mt-1 bg-brand-soft"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-balance text-[28px] font-semibold leading-tight tracking-tight text-foreground md:text-[32px]">
              {displayName}，今天想和 Kila 做点什么？
            </h1>
            <p className="mt-3 max-w-[560px] text-pretty text-sm leading-6 text-muted-foreground md:text-[15px]">
              {projectName ? `当前项目：${projectName}。描述要完成的任务，或选择一个常用操作。` : WELCOME_DESCRIPTION}
            </p>
            {sessionPath && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70" title={sessionPath}>{sessionPath}</p>}
          </div>
        </div>

        <div className="divide-y divide-border/45 border-y border-border/45">
          {displayPrompts.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.title}
                type="button"
                className="group flex min-h-[64px] w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={() => onUsePrompt?.(item.prompt)}
                aria-label={item.title}
              >
                <Icon className="size-[18px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium leading-5 text-foreground">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{item.detail}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

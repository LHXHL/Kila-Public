import type * as React from 'react'
import { useAtomValue } from 'jotai'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Sparkles, GitBranch, PenLine, Search } from 'lucide-react'
import { UserAvatar } from '@/components/message/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
import { sessionQuickSuggestionsAtom } from '@/atoms/agent-ui-atoms'
import type { QuickSuggestion } from '@kila/shared'

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

/** 无 LLM 建议缓存时的静态起步提示 */
function getFallbackPrompts(t: TFunction): StarterPrompt[] {
  return [
    {
      title: t('agent.welcome.prompts.plan.title'),
      detail: t('agent.welcome.prompts.plan.detail'),
      prompt: t('agent.welcome.prompts.plan.prompt'),
      icon: PenLine,
    },
    {
      title: t('agent.welcome.prompts.review.title'),
      detail: t('agent.welcome.prompts.review.detail'),
      prompt: t('agent.welcome.prompts.review.prompt'),
      icon: Search,
    },
    {
      title: t('agent.welcome.prompts.breakdown.title'),
      detail: t('agent.welcome.prompts.breakdown.detail'),
      prompt: t('agent.welcome.prompts.breakdown.prompt'),
      icon: GitBranch,
    },
  ]
}

const ICONS: React.ComponentType<{ className?: string }>[] = [PenLine, Search, GitBranch]

function getDisplayName(userName: string, t: TFunction): string {
  const trimmed = userName.trim()
  return trimmed || t('agent.welcome.fallbackName')
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
  const { t } = useTranslation()
  const userProfile = useAtomValue(userProfileAtom)
  const suggestions = useAtomValue(sessionQuickSuggestionsAtom)
  const displayName = getDisplayName(userProfile.userName, t)
  const projectName = sessionPath?.split(/[\\/]/).filter(Boolean).pop() ?? null

  // LLM 建议已在应用启动时生成并缓存，直接读取；无缓存则显示静态 fallback
  const displayPrompts = suggestions.length > 0 ? toStarterPrompts(suggestions) : getFallbackPrompts(t)

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
              {t('agent.welcome.greeting', { name: displayName })}
            </h1>
            <p className="mt-3 max-w-[560px] text-pretty text-sm leading-6 text-muted-foreground md:text-[15px]">
              {projectName
                ? t('agent.welcome.descriptionWithProject', { project: projectName })
                : t('agent.welcome.description')}
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

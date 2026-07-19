/**
 * AskUserBanner — Agent AskUserQuestion 交互式问答横幅
 *
 * 多问题用顶部 Tab 切换，选项竖向排列。
 * 键盘：↑↓ 选择选项，Enter 确认当前问题（最后一题提交，否则翻页）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { allPendingAskUserRequestsAtom } from '@/atoms/agent-permission-atoms'
import type { AskUserQuestion } from '@kila/shared'

interface QuestionAnswer {
  selected: string[]
  customText: string
  showCustom: boolean
}

const EMPTY_ANSWER: QuestionAnswer = { selected: [], customText: '', showCustom: false }

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** AskUserBanner 属性接口 */
interface AskUserBannerProps {
  sessionId: string
}

export function AskUserBanner({ sessionId }: AskUserBannerProps): React.ReactElement | null {
  const allRequests = useAtomValue(allPendingAskUserRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [answers, setAnswers] = React.useState<Map<number, QuestionAnswer>>(new Map())
  const [submitting, setSubmitting] = React.useState(false)
  const [responseError, setResponseError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState(0)
  const [focusedOptIdx, setFocusedOptIdx] = React.useState(0)
  const [now, setNow] = React.useState(() => Date.now())

  const request = requests[0] ?? null
  const questions = request?.questions ?? []
  const isLastTab = activeTab >= questions.length - 1

  React.useEffect(() => {
    setActiveTab(0)
    setFocusedOptIdx(0)
    setSubmitting(false)
    setResponseError(null)
    setAnswers(new Map())
  }, [request?.requestId])

  React.useEffect(() => {
    if (!request?.expiresAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [request?.requestId, request?.expiresAt])

  // 切换 Tab 时仅重置导航位置，不代表用户作答
  React.useEffect(() => {
    setFocusedOptIdx(0)
  }, [activeTab])

  const goNextTab = React.useCallback(() => {
    if (!isLastTab) setActiveTab((prev) => prev + 1)
  }, [isLastTab])

  if (!request) return null

  const getAnswer = (idx: number): QuestionAnswer => answers.get(idx) ?? EMPTY_ANSWER

  function toggleOptionByState(qIdx: number, q: AskUserQuestion, label: string): void {
    setAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      const selected = q.multiSelect
        ? (cur.selected.includes(label) ? cur.selected.filter((s) => s !== label) : [...cur.selected, label])
        : [label]
      map.set(qIdx, { ...cur, selected, showCustom: false, customText: '' })
      return map
    })
  }

  function toggleCustomByState(qIdx: number): void {
    setAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      map.set(qIdx, { ...cur, showCustom: !cur.showCustom, selected: cur.showCustom ? cur.selected : [] })
      return map
    })
  }

  const hasValidAnswers = questions.length > 0 && questions.every((_, idx) => {
    const answer = getAnswer(idx)
    return answer.selected.length > 0 || (answer.showCustom && answer.customText.trim().length > 0)
  })
  const remainingMs = request.expiresAt - now
  const isExpired = remainingMs <= 0

  const handleSubmit = async (): Promise<void> => {
    if (submitting || !hasValidAnswers || isExpired) return
    setSubmitting(true)
    setResponseError(null)
    try {
      const answersRecord: Record<string, string> = {}
      for (let i = 0; i < questions.length; i++) {
        const answer = getAnswer(i)
        if (answer.showCustom && answer.customText.trim()) {
          answersRecord[String(i)] = answer.customText.trim()
        } else if (answer.selected.length > 0) {
          answersRecord[String(i)] = answer.selected.join(', ')
        }
      }
      await window.electronAPI.respondAskUser({ requestId: request.requestId, answers: answersRecord })
    } catch (error) {
      console.error('[AskUserBanner] 响应失败:', error)
      setResponseError(error instanceof Error ? error.message : '答案未提交，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const currentQuestion = questions[activeTab]
  if (!currentQuestion) return null
  const expiryHint = remainingMs > 0
    ? `将在 ${formatRemaining(remainingMs)} 后自动取消`
    : '请求已过期，正在移除'

  return (
    <div
      role="region"
      aria-label="Agent 问题"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.defaultPrevented) return
        if (isExpired) return
        const itemCount = currentQuestion.options.length + 1
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const nextIndex = event.key === 'ArrowDown'
            ? (focusedOptIdx + 1) % itemCount
            : (focusedOptIdx - 1 + itemCount) % itemCount
          setFocusedOptIdx(nextIndex)
          if (nextIndex < currentQuestion.options.length) {
            const option = currentQuestion.options[nextIndex]
            if (option) toggleOptionByState(activeTab, currentQuestion, option.label)
          } else {
            toggleCustomByState(activeTab)
          }
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (isLastTab) void handleSubmit()
          else goNextTab()
        }
      }}
      className="mx-3 mb-2 overflow-hidden rounded-[var(--kila-panel-radius)] border border-border/35 bg-[hsl(var(--workspace))] shadow-none outline-none animate-in slide-in-from-bottom-2 duration-200 focus-visible:ring-2 focus-visible:ring-primary/40 md:mx-[24px]"
    >
      {/* 头部 + Tab 栏 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Kila Agent 需要你的输入</span>
            <span className="text-[11px] text-muted-foreground" aria-live="polite">{expiryHint}</span>
          </div>
          {requests.length > 1 && (
            <span className="text-xs text-muted-foreground">(+{requests.length - 1})</span>
          )}
        </div>

        {/* Tab 栏（多问题时显示） */}
        {questions.length > 1 && (
          <div role="tablist" aria-label="问题列表" className="flex gap-1">
            {questions.map((q, idx) => {
              const isActive = idx === activeTab
              const hasAnswer = getAnswer(idx).selected.length > 0
                || (getAnswer(idx).showCustom && getAnswer(idx).customText.trim().length > 0)
              return (
                <button
                  key={idx}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={isExpired}
                  className={`
                    px-2.5 py-1 rounded-lg text-xs font-medium transition-all outline-none
                    ${isActive
                      ? 'border border-primary/20 bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]'
                      : hasAnswer
                        ? 'border border-primary/15 bg-[hsl(var(--brand-soft-hover))] text-[hsl(var(--primary))]'
                        : 'border border-border/35 bg-muted/35 text-muted-foreground hover:bg-muted/55 hover:text-foreground'
                    }
                  `}
                  onClick={() => setActiveTab(idx)}
                >
                  {q.header || `问题 ${idx + 1}`}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 当前问题内容 */}
      <div className="px-4 pb-2">
        <QuestionCard
          question={currentQuestion}
          answer={getAnswer(activeTab)}
          focusedIndex={focusedOptIdx}
          showHeader={questions.length === 1}
          disabled={isExpired}
          onToggleOption={(label) => toggleOptionByState(activeTab, currentQuestion, label)}
          onToggleCustom={() => toggleCustomByState(activeTab)}
          onCustomTextChange={(text) => setAnswers((prev) => {
            const map = new Map(prev)
            const cur = map.get(activeTab) ?? EMPTY_ANSWER
            map.set(activeTab, { ...cur, customText: text })
            return map
          })}
          onSubmit={isLastTab ? handleSubmit : goNextTab}
        />
      </div>

      {responseError && (
        <p role="alert" className="px-4 pb-2 text-xs text-destructive">
          {responseError}
        </p>
      )}

      {/* 底部 */}
      <div className="flex items-center justify-end gap-1.5 px-4 pb-3">
        {!isExpired && (
          <span className="text-[10px] text-muted-foreground/40 mr-auto">
            聚焦卡片后 ↑↓ 选择 · Enter {isLastTab ? '确认' : '下一个'}
          </span>
        )}
        {isLastTab && (
          <Button
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !hasValidAnswers || isExpired}
            className="h-7 px-3 text-xs"
          >
            <Send className="size-3 mr-1" />
            确认
          </Button>
        )}
      </div>
    </div>
  )
}

/** 单个问题卡片（竖向选项） */
function QuestionCard({
  question,
  answer,
  focusedIndex,
  showHeader,
  disabled,
  onToggleOption,
  onToggleCustom,
  onCustomTextChange,
  onSubmit,
}: {
  question: AskUserQuestion
  answer: QuestionAnswer
  focusedIndex: number
  showHeader: boolean
  disabled: boolean
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomTextChange: (text: string) => void
  onSubmit: () => void
}): React.ReactElement {
  const optionCount = question.options.length

  return (
    <div className="space-y-2">
      {/* 问题文本 */}
      <div className="flex items-center gap-2">
        {showHeader && question.header && (
          <span className="metadata-chip shrink-0" data-tone="accent">
            {question.header}
          </span>
        )}
        <p className="text-sm text-foreground">{question.question}</p>
      </div>

      {/* 竖向选项 */}
      <div className="flex flex-col gap-1">
        {question.options.map((option, idx) => {
          const isSelected = answer.selected.includes(option.label)
          const isFocused = focusedIndex === idx
          return (
            <button
              key={option.label}
              type="button"
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
                ${isSelected
                  ? 'border border-primary/20 bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]'
                  : 'border border-border/35 bg-muted/35 text-foreground/80 hover:bg-muted/55'
                }
                ${isFocused ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card' : ''}
              `}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggleOption(option.label)}
            >
              <span className={`text-[10px] shrink-0 ${isSelected ? 'text-[hsl(var(--brand-soft-foreground)/0.65)]' : 'text-muted-foreground/50'}`}>
                {idx + 1}
              </span>
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className={`text-[11px] ${isSelected ? 'text-[hsl(var(--brand-soft-foreground)/0.78)]' : 'text-muted-foreground'}`}>
                  {option.description}
                </span>
              )}
            </button>
          )
        })}

        {/* "其他" */}
        <button
          type="button"
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
            ${answer.showCustom
              ? 'border border-primary/20 bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))]'
              : 'border border-border/35 bg-muted/35 text-foreground/80 hover:bg-muted/55'
            }
            ${focusedIndex === optionCount ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card' : ''}
          `}
          aria-pressed={answer.showCustom}
          disabled={disabled}
          onClick={onToggleCustom}
        >
          <span className={`text-[10px] shrink-0 ${answer.showCustom ? 'text-[hsl(var(--brand-soft-foreground)/0.65)]' : 'text-muted-foreground/50'}`}>
            {optionCount + 1}
          </span>
          <span className="font-medium">其他...</span>
        </button>
      </div>

      {/* 自由文本输入 */}
      {answer.showCustom && (
        <input
          type="text"
          className="w-full rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs transition-colors duration-200 placeholder:text-muted-foreground/40 focus:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/25"
          placeholder="输入自定义答案..."
          aria-label="自定义答案"
          value={answer.customText}
          disabled={disabled}
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !disabled) {
              e.preventDefault()
              onSubmit()
            }
          }}
          autoFocus
        />
      )}
    </div>
  )
}

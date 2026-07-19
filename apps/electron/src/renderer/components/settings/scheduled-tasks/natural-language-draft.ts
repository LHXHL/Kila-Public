import type { ScheduledTaskSchedule } from '@kila/shared'

export interface ScheduledTaskNaturalLanguageDraft {
  name: string
  prompt: string
  schedule: ScheduledTaskSchedule
  scheduleLabel: string
}

export type ScheduledTaskNaturalLanguageParseResult =
  | { ok: true; draft: ScheduledTaskNaturalLanguageDraft }
  | { ok: false; reason: string }


function normalizeHour(prefix: string | undefined, rawHour: number): number {
  if ((prefix === '下午' || prefix === '晚上') && rawHour < 12) return rawHour + 12
  if (prefix === '中午' && rawHour < 11) return rawHour + 12
  if (prefix === '凌晨' && rawHour === 12) return 0
  return rawHour
}

function parseClock(text: string): { hour: number; minute: number; raw: string } | null {
  const match = text.match(/(上午|下午|晚上|中午|早上|凌晨)?\s*(\d{1,2})(?:\s*[:：点时]\s*(\d{1,2})?\s*分?)?/)
  if (!match) return null
  const rawHour = Number(match[2])
  const minute = match[3] ? Number(match[3]) : 0
  const hour = normalizeHour(match[1], rawHour)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute, raw: match[0] }
}

function localIsoAt(base: Date, hour: number, minute: number): string {
  const target = new Date(base)
  target.setHours(hour, minute, 0, 0)
  return target.toISOString()
}

function derivePrompt(text: string, matchedParts: string[]): string {
  let prompt = text.trim()
  for (const part of matchedParts) {
    prompt = prompt.replace(part, ' ')
  }
  return prompt.replace(/^[，,。\s]*(?:请|帮我)?\s*/, '').replace(/[，,。\s]+$/g, '').trim()
}

function deriveName(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  if (!compact) return '定时任务'
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact
}

export function parseScheduledTaskNaturalLanguage(
  text: string,
  now = new Date(),
): ScheduledTaskNaturalLanguageParseResult {
  const source = text.trim()
  if (!source) return { ok: false, reason: '请输入任务描述' }

  const everyMatch = source.match(/每\s*(\d+)\s*(分钟|小时)/)
  if (everyMatch) {
    const amount = Number(everyMatch[1])
    const minutes = everyMatch[2] === '小时' ? amount * 60 : amount
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525_600) {
      return { ok: false, reason: '执行间隔需要在 1 分钟到 1 年之间' }
    }
    const prompt = derivePrompt(source, [everyMatch[0]])
    if (!prompt) return { ok: false, reason: '请补充要执行的任务内容' }
    return {
      ok: true,
      draft: {
        name: deriveName(prompt),
        prompt,
        schedule: { kind: 'every', minutes },
        scheduleLabel: `每 ${minutes} 分钟`,
      },
    }
  }

  const dailyMatch = source.match(/每天/)
  if (dailyMatch) {
    const clock = parseClock(source.slice((dailyMatch.index ?? 0) + dailyMatch[0].length))
    if (!clock) return { ok: false, reason: '“每天”任务需要明确时间，例如每天上午 9 点' }
    const prompt = derivePrompt(source, [dailyMatch[0], clock.raw])
    if (!prompt) return { ok: false, reason: '请补充要执行的任务内容' }
    return {
      ok: true,
      draft: {
        name: deriveName(prompt),
        prompt,
        schedule: { kind: 'cron', expr: `${clock.minute} ${clock.hour} * * *` },
        scheduleLabel: `每天 ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
      },
    }
  }

  const relativeDayMatch = source.match(/(今天|明天|后天)/)
  if (relativeDayMatch) {
    const clock = parseClock(source.slice((relativeDayMatch.index ?? 0) + relativeDayMatch[0].length))
    if (!clock) return { ok: false, reason: '一次性任务需要明确时间，例如明天下午 3 点' }
    const target = new Date(now)
    const offset = relativeDayMatch[1] === '明天' ? 1 : relativeDayMatch[1] === '后天' ? 2 : 0
    target.setDate(target.getDate() + offset)
    const prompt = derivePrompt(source, [relativeDayMatch[0], clock.raw])
    if (!prompt) return { ok: false, reason: '请补充要执行的任务内容' }
    return {
      ok: true,
      draft: {
        name: deriveName(prompt),
        prompt,
        schedule: { kind: 'at', at: localIsoAt(target, clock.hour, clock.minute) },
        scheduleLabel: `${relativeDayMatch[1]} ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
      },
    }
  }

  return { ok: false, reason: '暂支持“每 30 分钟”“每天上午 9 点”“明天下午 3 点”这类表达' }
}

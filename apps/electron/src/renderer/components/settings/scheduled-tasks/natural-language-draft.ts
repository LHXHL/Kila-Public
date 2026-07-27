import type { ScheduledTaskSchedule } from '@kila/shared'
import type { TFunction } from 'i18next'

/** 相对日期，展示时按当前语言翻译 */
export type ScheduledTaskRelativeDay = 'today' | 'tomorrow' | 'dayAfterTomorrow'

/**
 * 草稿的调度描述
 *
 * 解析器是纯函数，不直接产出译文；这里只描述“是什么”，由渲染层格式化成当前语言。
 */
export type ScheduledTaskDraftScheduleLabel =
  | { kind: 'everyMinutes'; minutes: number }
  | { kind: 'dailyAt'; time: string }
  | { kind: 'relativeDayAt'; day: ScheduledTaskRelativeDay; time: string }

export interface ScheduledTaskNaturalLanguageDraft {
  name: string
  prompt: string
  schedule: ScheduledTaskSchedule
  scheduleLabel: ScheduledTaskDraftScheduleLabel
}

export type ScheduledTaskNaturalLanguageParseResult =
  | { ok: true; draft: ScheduledTaskNaturalLanguageDraft }
  | { ok: false; reasonKey: string }

/** 解析失败原因对应的 i18n key */
export const SCHEDULED_TASK_DRAFT_ERROR_KEYS = {
  empty: 'settingsTasks.naturalLanguage.errors.empty',
  intervalRange: 'settingsTasks.naturalLanguage.errors.intervalRange',
  missingPrompt: 'settingsTasks.naturalLanguage.errors.missingPrompt',
  dailyNeedsTime: 'settingsTasks.naturalLanguage.errors.dailyNeedsTime',
  onceNeedsTime: 'settingsTasks.naturalLanguage.errors.onceNeedsTime',
  unsupported: 'settingsTasks.naturalLanguage.errors.unsupported',
} as const

interface ClockMatch {
  hour: number
  minute: number
  raw: string
}

/** 中文时段前缀换算成 24 小时制 */
function normalizeHour(prefix: string | undefined, rawHour: number): number {
  if ((prefix === '下午' || prefix === '晚上') && rawHour < 12) return rawHour + 12
  if (prefix === '中午' && rawHour < 11) return rawHour + 12
  if (prefix === '凌晨' && rawHour === 12) return 0
  return rawHour
}

/** 同时识别「上午 9 点」与「at 9am」两类时间写法 */
function parseClock(text: string): ClockMatch | null {
  const match = text.match(
    /(上午|下午|晚上|中午|早上|凌晨)?\s*(?:at\s+)?(\d{1,2})(?:\s*[:：.点时]\s*(\d{1,2})?\s*分?)?\s*(am|pm)?/i,
  )
  if (!match) return null

  const rawHour = Number(match[2])
  const minute = match[3] ? Number(match[3]) : 0
  const meridiem = match[4]?.toLowerCase()

  let hour = normalizeHour(match[1], rawHour)
  if (meridiem === 'pm' && rawHour < 12) hour = rawHour + 12
  if (meridiem === 'am' && rawHour === 12) hour = 0

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute, raw: match[0] }
}

function formatClock(clock: ClockMatch): string {
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
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
  return prompt
    .replace(/^[，,。\s]*(?:请|帮我|please|help me)?\s*/i, '')
    .replace(/[，,。.\s]+$/g, '')
    .trim()
}

function deriveName(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  return compact.length > 24 ? `${compact.slice(0, 24)}…` : compact
}

/** 「每 N 分钟 / 每 N 小时 / every N minutes」 */
function matchInterval(source: string): { raw: string; minutes: number } | null {
  const chinese = source.match(/每\s*(\d+)\s*(分钟|小时)/)
  if (chinese) {
    const amount = Number(chinese[1])
    return { raw: chinese[0], minutes: chinese[2] === '小时' ? amount * 60 : amount }
  }

  const english = source.match(/every\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/i)
  if (english) {
    const amount = Number(english[1])
    const isHour = /^h/i.test(english[2] ?? '')
    return { raw: english[0], minutes: isHour ? amount * 60 : amount }
  }

  return null
}

/** 「每天 / every day / daily」 */
function matchDaily(source: string): { raw: string; rest: string } | null {
  const match = source.match(/每天|every\s+day|daily/i)
  if (!match) return null
  return { raw: match[0], rest: source.slice((match.index ?? 0) + match[0].length) }
}

/** 「今天 / 明天 / 后天 / today / tomorrow / the day after tomorrow」 */
function matchRelativeDay(source: string): { raw: string; day: ScheduledTaskRelativeDay; rest: string } | null {
  const match = source.match(/今天|明天|后天|day after tomorrow|tomorrow|today/i)
  if (!match) return null

  const token = match[0].toLowerCase()
  const day: ScheduledTaskRelativeDay = token === '明天' || token === 'tomorrow'
    ? 'tomorrow'
    : token === '后天' || token === 'day after tomorrow'
      ? 'dayAfterTomorrow'
      : 'today'

  return { raw: match[0], day, rest: source.slice((match.index ?? 0) + match[0].length) }
}

const RELATIVE_DAY_OFFSET: Record<ScheduledTaskRelativeDay, number> = {
  today: 0,
  tomorrow: 1,
  dayAfterTomorrow: 2,
}

export function parseScheduledTaskNaturalLanguage(
  text: string,
  now = new Date(),
): ScheduledTaskNaturalLanguageParseResult {
  const source = text.trim()
  if (!source) return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.empty }

  const interval = matchInterval(source)
  if (interval) {
    const { minutes } = interval
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525_600) {
      return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.intervalRange }
    }
    const prompt = derivePrompt(source, [interval.raw])
    if (!prompt) return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.missingPrompt }
    return {
      ok: true,
      draft: {
        name: deriveName(prompt),
        prompt,
        schedule: { kind: 'every', minutes },
        scheduleLabel: { kind: 'everyMinutes', minutes },
      },
    }
  }

  const daily = matchDaily(source)
  if (daily) {
    const clock = parseClock(daily.rest)
    if (!clock) return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.dailyNeedsTime }
    const prompt = derivePrompt(source, [daily.raw, clock.raw])
    if (!prompt) return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.missingPrompt }
    return {
      ok: true,
      draft: {
        name: deriveName(prompt),
        prompt,
        schedule: { kind: 'cron', expr: `${clock.minute} ${clock.hour} * * *` },
        scheduleLabel: { kind: 'dailyAt', time: formatClock(clock) },
      },
    }
  }

  const relative = matchRelativeDay(source)
  if (relative) {
    const clock = parseClock(relative.rest)
    if (!clock) return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.onceNeedsTime }
    const target = new Date(now)
    target.setDate(target.getDate() + RELATIVE_DAY_OFFSET[relative.day])
    const prompt = derivePrompt(source, [relative.raw, clock.raw])
    if (!prompt) return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.missingPrompt }
    return {
      ok: true,
      draft: {
        name: deriveName(prompt),
        prompt,
        schedule: { kind: 'at', at: localIsoAt(target, clock.hour, clock.minute) },
        scheduleLabel: { kind: 'relativeDayAt', day: relative.day, time: formatClock(clock) },
      },
    }
  }

  return { ok: false, reasonKey: SCHEDULED_TASK_DRAFT_ERROR_KEYS.unsupported }
}

/** 把结构化调度描述格式化成当前语言的文案 */
export function formatDraftScheduleLabel(t: TFunction, label: ScheduledTaskDraftScheduleLabel): string {
  switch (label.kind) {
    case 'everyMinutes':
      return t('settingsTasks.naturalLanguage.scheduleLabel.everyMinutes', { count: label.minutes })
    case 'dailyAt':
      return t('settingsTasks.naturalLanguage.scheduleLabel.dailyAt', { time: label.time })
    case 'relativeDayAt':
      return t('settingsTasks.naturalLanguage.scheduleLabel.relativeDayAt', {
        day: t(`settingsTasks.naturalLanguage.relativeDay.${label.day}`),
        time: label.time,
      })
  }
}

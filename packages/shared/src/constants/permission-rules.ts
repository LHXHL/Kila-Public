/**
 * 工具分类规则 — Agent 权限系统
 *
 * 定义安全工具白名单、安全 Bash 命令模式和危险命令列表。
 * 用于智能模式下的自动允许/询问判断。
 */

/** 始终安全的工具（免询问） */
export const SAFE_TOOLS: readonly string[] = [
  'Read',            // 文件读取
  'Glob',            // 文件名搜索
  'Grep',            // 内容搜索
  'WebSearch',       // 网络搜索
  'WebFetch',        // 网页获取
  'TodoRead',        // Todo 列表读取
  'TodoWrite',       // Todo 列表写入（无安全风险）
  'TaskOutput',      // 后台任务输出
  // 注意：AskUserQuestion 不在此列表 — 由 canUseTool 拦截并展示交互式 UI
]

/** 安全的 Bash 命令模式（只读操作） */
export const SAFE_BASH_PATTERNS: readonly RegExp[] = [
  /^git\s+(status|log|diff|show|branch|remote|tag)\b/,
  /^ls\b/,
  /^head\b/,
  /^tail\b/,
  /^grep\b/,
  /^rg\b/,
  /^which\b/,
  /^pwd$/,
  /^env$/,
  /^whoami$/,
  /^uname\b/,
  /^tree\b/,
  /^wc\b/,
  /^file\b/,
  /^stat\b/,
  /^du\b/,
  /^df\b/,
  /^node\s+--version$/,
  /^bun\s+--version$/,
  /^npm\s+(list|ls|view|info|outdated)\b/,
  /^bun\s+(pm\s+ls)\b/,
  // 注意：cat/echo/find 不在此列表中
  // - cat 可读取敏感文件（~/.ssh/id_rsa 等）
  // - echo 可通过重定向写入文件
  // - find 的 -exec/-delete 可执行任意命令/删除文件
]

/** 危险命令前缀（需特别标记⚠️） */
export const DANGEROUS_COMMANDS: readonly string[] = [
  'rm', 'rmdir',
  'sudo', 'su',
  'chmod', 'chown',
  'mv',
  'dd',
  'kill', 'killall', 'pkill',
  'git push', 'git reset', 'git rebase', 'git checkout',
  'git clean', 'git branch -D', 'git branch -d',
  'npm publish',
  'curl', 'wget',
  'ssh', 'scp',
]

export interface BashCommandAnalysis {
  command: string
  tokens: string[]
  baseCommand: string
  hasStructure: boolean
  isSafe: boolean
  isDangerous: boolean
  dangerLevel: 'safe' | 'normal' | 'dangerous'
  riskScore: number
  reasons: string[]
}

const SHELL_OPERATORS = new Set(['|', '||', '>', '>>', '<', '<<', '&&', ';', '&'])

function tokenizeShellLike(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  const push = (): void => {
    if (!current) return
    tokens.push(current)
    current = ''
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    const next = command[index + 1]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      current += char
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      }
      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    if (/\s/.test(char)) {
      push()
      continue
    }

    const twoChar = `${char}${next ?? ''}`
    if (SHELL_OPERATORS.has(twoChar)) {
      push()
      tokens.push(twoChar)
      index += 1
      continue
    }

    if (SHELL_OPERATORS.has(char)) {
      push()
      tokens.push(char)
      continue
    }

    current += char
  }

  push()
  return tokens
}

function getBaseCommand(tokens: string[]): string {
  const commandTokens = tokens.filter((token) => !SHELL_OPERATORS.has(token))
  const first = commandTokens[0] ?? ''
  const second = commandTokens[1] ?? ''
  if (first && second && ['git', 'npm', 'bun', 'yarn', 'pnpm'].includes(first)) {
    return `${first} ${second}`
  }
  return first
}

function hasShellStructure(tokens: string[], command: string): boolean {
  if (tokens.some((token) => SHELL_OPERATORS.has(token))) return true
  if (/\$\(/.test(command) || /`/.test(command)) return true
  return false
}

function clampRiskScore(score: number): number {
  if (score < 0) return 0
  if (score > 100) return 100
  return score
}

export function analyzeBashCommand(command: string): BashCommandAnalysis {
  const trimmed = command.trim()
  const lowered = trimmed.toLowerCase()
  const tokens = tokenizeShellLike(trimmed)
  const baseCommand = getBaseCommand(tokens)
  const reasons: string[] = []
  let riskScore = 0

  const hasStructure = hasShellStructure(tokens, trimmed)
  const dangerousCommand = DANGEROUS_COMMANDS.find((dc) => lowered.startsWith(dc.toLowerCase()))
  const hasRedirection = tokens.some((token) => token === '>' || token === '>>' || token === '<' || token === '<<')
  const hasExecutionChain = tokens.some((token) => token === '&&' || token === '||' || token === ';' || token === '&')
  const hasPipe = tokens.includes('|')
  const hasCommandSubstitution = /\$\(/.test(trimmed) || /`/.test(trimmed)
  const hasFindExecOrDelete = tokens.includes('-exec') || tokens.includes('-delete')

  if (dangerousCommand) {
    riskScore += 75
    reasons.push(`dangerous command: ${dangerousCommand}`)
  }
  if (hasRedirection) {
    riskScore += 45
    reasons.push('shell redirection')
  }
  if (hasExecutionChain) {
    riskScore += 35
    reasons.push('chained command execution')
  }
  if (hasPipe) {
    riskScore += 20
    reasons.push('pipeline')
  }
  if (hasCommandSubstitution) {
    riskScore += 60
    reasons.push('command substitution')
  }
  if (hasFindExecOrDelete) {
    riskScore += 80
    reasons.push('find exec/delete')
  }

  const matchesSafePattern = SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))
  const isSafe = Boolean(trimmed) && matchesSafePattern && !hasStructure && !dangerousCommand && !hasFindExecOrDelete
  if (isSafe) {
    return {
      command: trimmed,
      tokens,
      baseCommand,
      hasStructure,
      isSafe: true,
      isDangerous: false,
      dangerLevel: 'safe',
      riskScore: 0,
      reasons: [],
    }
  }

  if (!matchesSafePattern && trimmed) {
    riskScore += 25
    reasons.push('not in read-only allowlist')
  }

  riskScore = clampRiskScore(riskScore)
  const isDangerous = riskScore >= 70
  return {
    command: trimmed,
    tokens,
    baseCommand,
    hasStructure,
    isSafe: false,
    isDangerous,
    dangerLevel: isDangerous ? 'dangerous' : 'normal',
    riskScore,
    reasons,
  }
}

/**
 * 检测 Bash 命令是否包含危险结构
 *
 * 检测管道、输出重定向、exec 子命令等危险模式。
 */
export function hasDangerousStructure(command: string): boolean {
  return analyzeBashCommand(command).hasStructure
}

/**
 * 判断 Bash 命令是否匹配安全模式
 */
export function isSafeBashCommand(command: string): boolean {
  return analyzeBashCommand(command).isSafe
}

/**
 * 判断命令是否为危险命令
 */
export function isDangerousCommand(command: string): boolean {
  return analyzeBashCommand(command).isDangerous
}

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface ProcessIdentity {
  pid: number
  parentPid: number
  processStartTime: number
}

/** Runtime lock 中的启动时间来自 monotonic uptime，跨平台核对时允许少量取整误差。 */
export const PROCESS_START_TIME_TOLERANCE_MS = 5_000

/** 用当前进程的 uptime 计算稳定的 wall-clock 启动时间。 */
export function getCurrentProcessStartTime(): number {
  return Date.now() - Math.round(process.uptime() * 1_000)
}

/**
 * 读取指定 PID 的身份。
 *
 * 只能可靠取得 PID、父 PID 和启动时间时才返回结果；平台接口不可用时返回
 * undefined，让 sidecar 回收逻辑保持 fail-closed。
 */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined

  if (process.platform === 'linux') return readLinuxProcessIdentity(pid)
  if (process.platform === 'darwin') return readDarwinProcessIdentity(pid)
  if (process.platform === 'win32') return readWindowsProcessIdentity(pid)
  return undefined
}

export function isSameProcessStartTime(expected: number, actual: number): boolean {
  return Number.isFinite(expected)
    && Number.isFinite(actual)
    && Math.abs(expected - actual) <= PROCESS_START_TIME_TOLERANCE_MS
}

function readLinuxProcessIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')
    if (commandEnd < 0) return undefined
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/)
    const parentPid = Number(fields[1])
    const startTicks = Number(fields[19])
    const bootSeconds = Number(
      readFileSync('/proc/stat', 'utf8')
        .split('\n')
        .find((line) => line.startsWith('btime '))
        ?.split(/\s+/)[1],
    )
    const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim())
    if (!Number.isInteger(parentPid) || !Number.isFinite(startTicks)
      || !Number.isFinite(bootSeconds) || !Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) {
      return undefined
    }
    return {
      pid,
      parentPid,
      processStartTime: bootSeconds * 1_000 + (startTicks / ticksPerSecond) * 1_000,
    }
  } catch {
    return undefined
  }
}

function readDarwinProcessIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,lstart='], { encoding: 'utf8' }).trim()
    const match = output.match(/^(\d+)\s+(.+)$/)
    if (!match) return undefined
    const parentPid = Number(match[1])
    const processStartTime = Date.parse(match[2]!)
    if (!Number.isInteger(parentPid) || !Number.isFinite(processStartTime)) return undefined
    return { pid, parentPid, processStartTime }
  } catch {
    return undefined
  }
}

function readWindowsProcessIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const script = [
      `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      'if ($process) {',
      '  "$($process.ParentProcessId)|$($process.CreationDate.ToUniversalTime().ToString(\'o\'))"',
      '}',
    ].join('; ')
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], { encoding: 'utf8', windowsHide: true }).trim()
    const match = output.match(/^(\d+)\|(.+)$/)
    if (!match) return undefined
    const parentPid = Number(match[1])
    const processStartTime = Date.parse(match[2]!)
    if (!Number.isInteger(parentPid) || !Number.isFinite(processStartTime)) return undefined
    return { pid, parentPid, processStartTime }
  } catch {
    return undefined
  }
}

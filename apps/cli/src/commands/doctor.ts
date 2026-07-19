import { accessSync, constants, statSync } from 'node:fs'
import { inspectBridgeConnection, connectToBridge, type CliBridgeClient } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag } from '../args'
import { printJson } from '../format/json-output'

type CheckLevel = 'PASS' | 'FAIL'

interface DoctorCheck {
  name: string
  level: CheckLevel
  detail: string
}

function recordCheck(
  checks: DoctorCheck[],
  name: string,
  pass: boolean,
  detail: string,
): void {
  checks.push({
    name,
    level: pass ? 'PASS' : 'FAIL',
    detail,
  })
}

function checkAccessiblePath(
  checks: DoctorCheck[],
  name: string,
  filePath: string,
): void {
  try {
    accessSync(filePath, constants.R_OK | constants.W_OK)
    recordCheck(checks, name, true, filePath)
  } catch (error) {
    recordCheck(
      checks,
      name,
      false,
      `${filePath} (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

async function appendBridgeBackedChecks(
  checks: DoctorCheck[],
  client: CliBridgeClient | null,
): Promise<void> {
  if (!client) {
    recordCheck(checks, 'global-capabilities', false, 'bridge unavailable')
    recordCheck(checks, 'personality-soul', false, 'bridge unavailable')
    recordCheck(checks, 'personality-user', false, 'bridge unavailable')
    recordCheck(checks, 'task-runtime', false, 'bridge unavailable')
    recordCheck(checks, 'run-preflight', false, 'bridge unavailable')
    return
  }

  const [status, capabilities, soul, user, taskRuntime] = await Promise.all([
    client.getStatus().catch(() => null),
    client.getCapabilities().catch(() => null),
    client.getPersonality('soul').catch(() => null),
    client.getPersonality('user').catch(() => null),
    client.getTaskRuntime().catch(() => null),
  ])

  recordCheck(
    checks,
    'global-capabilities',
    Boolean(capabilities),
    capabilities
      ? `mcp=${capabilities.mcpServers.length}, skills=${capabilities.skills.length}`
      : '无法读取全局 MCP / Skills 配置',
  )

  if (soul?.document.path) {
    checkAccessiblePath(checks, 'personality-soul', soul.document.path)
  } else {
    recordCheck(checks, 'personality-soul', false, '无法读取 SOUL.md')
  }

  if (user?.document.path) {
    checkAccessiblePath(checks, 'personality-user', user.document.path)
  } else {
    recordCheck(checks, 'personality-user', false, '无法读取 USER.md')
  }

  recordCheck(
    checks,
    'task-runtime',
    taskRuntime?.runtime.watchdogState === 'healthy' || taskRuntime?.runtime.watchdogState === 'idle',
    taskRuntime
      ? `${taskRuntime.runtime.watchdogState}: ${taskRuntime.runtime.watchdogReason}`
      : '无法读取调度器状态',
  )

  const runReady = Boolean(status?.defaults.channelId)
    && status?.defaults.channelExists === true
    && status?.defaults.channelEnabled === true
    && Boolean(status?.defaults.modelId)
    && status?.defaults.modelExists === true
    && status?.defaults.modelEnabled === true

  recordCheck(
    checks,
    'run-preflight',
    runReady,
    runReady
      ? `${status?.defaults.channelName ?? status?.defaults.channelId} / ${status?.defaults.modelId}`
      : '默认 channel/model 不可直接用于新 run，请先运行 kila status 或 kila channels',
  )
}

export async function runDoctorCommand(args: ParsedArgs): Promise<number> {
  const asJson = getBooleanFlag(args, 'json')
  const checks: DoctorCheck[] = []

  const inspection = await inspectBridgeConnection()
  recordCheck(
    checks,
    'discovery-file',
    Boolean(inspection.discovery),
    inspection.discovery
      ? inspection.discoveryPath
      : `missing: ${inspection.discoveryPath}`,
  )

  recordCheck(
    checks,
    'bridge-health',
    Boolean(inspection.health),
    inspection.health
      ? `ok (pid ${inspection.health.pid})`
      : 'desktop bridge unavailable or auth failed',
  )

  const client = inspection.health ? await connectToBridge() : null
  const status = client ? await client.getStatus().catch(() => null) : null

  recordCheck(
    checks,
    'default-channel',
    Boolean(status?.defaults.channelId) && status?.defaults.channelExists === true && status?.defaults.channelEnabled === true,
    status?.defaults.channelId
      ? `${status.defaults.channelId}${status.defaults.channelEnabled ? '' : ' (disabled or missing)'}`
      : 'unset',
  )

  recordCheck(
    checks,
    'default-model',
    Boolean(status?.defaults.modelId) && status?.defaults.modelExists === true && status?.defaults.modelEnabled === true,
    status?.defaults.modelId
      ? `${status.defaults.modelId}${status.defaults.modelEnabled ? '' : ' (disabled or missing)'}`
      : 'unset',
  )

  let cwdOk = false
  let cwdDetail = process.cwd()
  try {
    const cwd = process.cwd()
    cwdOk = statSync(cwd).isDirectory()
    accessSync(cwd, constants.R_OK | constants.W_OK)
    cwdDetail = cwd
  } catch (error) {
    cwdDetail = error instanceof Error ? error.message : String(error)
  }
  recordCheck(checks, 'cwd', cwdOk, cwdDetail)

  await appendBridgeBackedChecks(checks, client)

  const exitCode = checks.every((check) => check.level === 'PASS') ? 0 : 1

  if (asJson) {
    printJson({
      ok: exitCode === 0,
      checks,
    })
    return exitCode
  }

  for (const check of checks) {
    process.stdout.write(`${check.level} ${check.name}: ${check.detail}\n`)
  }
  return exitCode
}

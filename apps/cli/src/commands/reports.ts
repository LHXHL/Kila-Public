import { connectToBridgeOrThrow } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag, getStringFlag } from '../args'
import { printHint } from '../format/hints'
import { printJson } from '../format/json-output'

export async function runReportDailyCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const date = getStringFlag(args, 'date')
  const response = await client.getDailyReport(date)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`Date: ${response.date}\n`)
  process.stdout.write(`Sessions active: ${response.sessions.activeCount}\n`)
  process.stdout.write(`Sessions created: ${response.sessions.createdCount}\n`)
  process.stdout.write(`User messages: ${response.sessions.userMessageCount}\n`)
  process.stdout.write(`Assistant messages: ${response.sessions.assistantMessageCount}\n`)
  process.stdout.write(`Scheduled messages: ${response.sessions.scheduledMessageCount}\n`)
  process.stdout.write(`Task runs: ${response.tasks.totalRuns}\n`)
  process.stdout.write(`Task success/error/skipped/ai-stop: ${response.tasks.successCount}/${response.tasks.errorCount}/${response.tasks.skippedCount}/${response.tasks.stoppedByAiCount}\n`)
  if (response.tasks.errorCount > 0) {
    printHint('运行 `kila task list` 或 `kila task history <id>` 排查失败任务')
  } else if (response.tasks.totalRuns > 0) {
    printHint('如需 drill-down，运行 `kila task list` 或 `kila sessions`')
  }
  return 0
}

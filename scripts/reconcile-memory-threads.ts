import { runMemoryThreadReconciliation } from '../apps/electron/src/main/lib/memory/reconcile-threads'

interface CliOptions {
  apply: boolean
  cascadeDeleteMemories: boolean
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Set(argv)

  if (args.has('--help') || args.has('-h')) {
    console.log([
      'Usage: bun run scripts/reconcile-memory-threads.ts [--apply] [--json] [--keep-orphan-memories]',
      '',
      '  --apply                  执行修复；缺省只做 dry-run',
      '  --json                   以 JSON 输出结果',
      '  --keep-orphan-memories   删除孤儿 thread 时保留其沉淀 memories',
    ].join('\n'))
    process.exit(0)
  }

  return {
    apply: args.has('--apply'),
    cascadeDeleteMemories: !args.has('--keep-orphan-memories'),
    json: args.has('--json'),
  }
}

function formatResults(label: string, results: Array<{
  kind: string
  target: string
  status: string
  detail: string
}>): string[] {
  const lines = [`${label}: ${results.length}`]
  for (const result of results) {
    lines.push(`  - [${result.status}] ${result.kind} ${result.target} :: ${result.detail}`)
  }
  return lines
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const report = await runMemoryThreadReconciliation({
    apply: options.apply,
    cascadeDeleteMemories: options.cascadeDeleteMemories,
  })

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const lines = [
    `Mode: ${report.apply ? 'apply' : 'dry-run'}`,
    `Cascade orphan memories: ${report.cascadeDeleteMemories ? 'yes' : 'no'}`,
    `Initial snapshot: sessions=${report.initialSnapshot.sessions}, localStates=${report.initialSnapshot.localStates}, remoteThreads=${report.initialSnapshot.remoteThreads}`,
    `Normalization plan: createRemote=${report.normalizationPlan.createRemoteThreads}, upsertLocal=${report.normalizationPlan.upsertLocalThreadStates}, deleteLocal=${report.normalizationPlan.deleteLocalThreadStates}`,
    `Remote deletion plan: deleteRemote=${report.remoteDeletionPlan.deleteRemoteThreads}`,
  ]

  if (!report.apply) {
    lines.push('Dry-run only. Re-run with --apply to execute.')
  } else {
    lines.push(...formatResults('Normalization results', report.normalizationResults))
    lines.push(...formatResults('Remote deletion results', report.remoteDeletionResults))
    if (report.finalSnapshot) {
      lines.push(`Final snapshot: sessions=${report.finalSnapshot.sessions}, localStates=${report.finalSnapshot.localStates}, remoteThreads=${report.finalSnapshot.remoteThreads}`)
    }
  }

  console.log(lines.join('\n'))
}

main().catch((error) => {
  console.error('[reconcile-memory-threads] failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})

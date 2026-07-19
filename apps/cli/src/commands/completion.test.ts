import { describe, expect, test } from 'bun:test'
import { runCompletionCommand } from './completion'

async function captureStdout(run: () => Promise<number>): Promise<string> {
  let output = ''
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    return true
  }) as typeof process.stdout.write

  try {
    await run()
  } finally {
    process.stdout.write = write
  }

  return output
}

describe('completion command', () => {
  test('includes newly added top-level commands in bash completion', async () => {
    const output = await captureStdout(() => runCompletionCommand({
      positionals: ['bash'],
      flags: new Map(),
    }))

    expect(output).toContain('providers')
    expect(output).toContain('config')
    expect(output).toContain('task')
    expect(output).toContain('report')
    expect(output).toContain('channel')
  })
})

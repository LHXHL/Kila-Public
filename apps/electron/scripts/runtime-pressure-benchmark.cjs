/* eslint-disable no-console */
/**
 * 真实 Utility Process 启动/RSS 基准。
 *
 * 运行前需要先生成 dist/pi-runtime.cjs：
 *   bun run build:pi-runtime
 *   bun run benchmark:runtime
 *
 * 这个脚本只测 Runtime 进程本身，不发起 Provider 请求，也不会写入用户配置或 Session。
 */

const { app, utilityProcess } = require('electron')
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_COUNTS = [1, 4, 8, 16]
const READY_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 5_000

function parseCounts() {
  const raw = process.env.KILA_RUNTIME_PRESSURE_COUNTS || DEFAULT_COUNTS.join(',')
  const counts = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 32)
  if (counts.length === 0) throw new Error(`无有效 benchmark 数量: ${raw}`)
  return [...new Set(counts)]
}

function readRssBytes(pid) {
  if (!pid) return undefined
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
      { encoding: 'utf8', windowsHide: true },
    )
    const bytes = Number(result.stdout.trim())
    return result.status === 0 && Number.isFinite(bytes) ? bytes : undefined
  }

  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })
  const kilobytes = Number(result.stdout.trim())
  return result.status === 0 && Number.isFinite(kilobytes) ? kilobytes * 1024 : undefined
}

function makeEnvelope(sequence, type, payload) {
  return { version: 1, channel: 'command', sequence, type, payload }
}

function waitForReady(child, appBootId, spawnNonce) {
  return new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectReady(new Error(`Runtime ready 超时 pid=${child.pid ?? 'unknown'}`))
    }, READY_TIMEOUT_MS)

    const onMessage = (_event, rawMessage) => {
      const message = rawMessage ?? _event
      if (message?.type !== 'runtime.ready') return
      const payload = message.payload
      if (payload?.appBootId !== appBootId || payload?.spawnNonce !== spawnNonce) {
        cleanup()
        rejectReady(new Error('Runtime ready 身份校验失败'))
        return
      }
      cleanup()
      resolveReady(payload)
    }
    const onExit = (code) => {
      cleanup()
      rejectReady(new Error(`Runtime 在 ready 前退出 code=${code}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.removeListener('message', onMessage)
      child.removeListener('exit', onExit)
    }

    child.on('message', onMessage)
    child.on('exit', onExit)
  })
}

function waitForExit(child) {
  if (child.__benchmarkExited) return Promise.resolve()
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill()
      resolveExit()
    }, SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit()
    })
  })
}

async function startRuntime(entryPath, index, appBootId, onSpawn) {
  const spawnNonce = `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`
  const child = utilityProcess.fork(entryPath, [], {
    serviceName: `Kila Runtime Benchmark ${index}`,
    env: { ...process.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.__benchmarkExited = false
  child.once('exit', () => { child.__benchmarkExited = true })
  onSpawn(child)
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text) console.error(`[runtime ${index}] ${text}`)
  })
  child.postMessage(makeEnvelope(1, 'runtime.handshake', { appBootId, spawnNonce }))
  const ready = await waitForReady(child, appBootId, spawnNonce)
  return { child, ready }
}

async function runScenario(entryPath, count) {
  const appBootId = `benchmark-${process.pid}-${Date.now()}`
  const startedAt = Date.now()
  const runtimes = []
  const children = []
  try {
    const started = await Promise.all(
      Array.from(
        { length: count },
        (_, index) => startRuntime(entryPath, index, appBootId, (child) => children.push(child)),
      ),
    )
    runtimes.push(...started)
    const readyAt = Date.now()
    const rssBytes = runtimes.map(({ child }) => readRssBytes(child.pid)).filter((value) => value !== undefined)
    return {
      count,
      startupMs: readyAt - startedAt,
      rssBytes: rssBytes.reduce((sum, value) => sum + value, 0),
      rssBytesPerRuntime: rssBytes.length > 0 ? Math.round(rssBytes.reduce((sum, value) => sum + value, 0) / rssBytes.length) : null,
      readyRuntimeCount: runtimes.length,
      runtimePids: runtimes.map(({ child }) => child.pid).filter((pid) => pid !== undefined),
    }
  } finally {
    await Promise.all(children.map(async (child) => {
      if (!child.__benchmarkExited) {
        try {
          child.postMessage(makeEnvelope(2, 'runtime.shutdown', { reason: 'benchmark' }))
        } catch {
          child.kill()
        }
      }
      await waitForExit(child)
    }))
  }
}

async function main() {
  const entryPath = resolve(process.env.KILA_PI_RUNTIME_ENTRY || join(__dirname, '..', 'dist', 'pi-runtime.cjs'))
  if (!existsSync(entryPath)) throw new Error(`Runtime bundle 不存在: ${entryPath}`)
  const counts = parseCounts()
  await app.whenReady()
  try {
    for (const count of counts) {
      const result = await runScenario(entryPath, count)
      console.log(JSON.stringify({ type: 'runtime-pressure-sample', ...result }))
    }
  } finally {
    app.quit()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  app.exit(1)
})

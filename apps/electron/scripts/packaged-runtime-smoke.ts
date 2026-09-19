#!/usr/bin/env bun

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const CHANNEL_ID = 'packaged-smoke-channel'
const MODEL_ID = 'packaged-smoke-model'
const RESPONSE_MARKER = 'packaged-runtime-isolation-ok'
const WAIT_TIMEOUT_MS = 45_000

interface CliDiscovery {
  host: string
  port: number
  token: string
}

interface SseEvent {
  name: string
  data: Record<string, unknown>
}

interface SmokeContext {
  configDir: string
  workspaceDir: string
  mockServer: Server
  mockPort: number
  app: ChildProcess
  appLog: string
  getAppLog: () => string
}

function log(message: string): void {
  process.stdout.write(`[打包 smoke] ${message}\n`)
}

function fail(message: string, context?: SmokeContext): never {
  const appLog = context?.getAppLog() ?? context?.appLog ?? ''
  const suffix = appLog ? `\n应用日志尾部:\n${appLog.slice(-8_000)}` : ''
  throw new Error(`${message}${suffix}`)
}

function parseAppPath(args: string[]): string {
  const index = args.indexOf('--app')
  const value = index >= 0 ? args[index + 1] : process.env.KILA_PACKAGED_APP
  if (!value) {
    throw new Error('用法: bun run scripts/packaged-runtime-smoke.ts --app <打包后的可执行文件>')
  }

  const appPath = resolve(value)
  if (!existsSync(appPath)) throw new Error(`打包后的可执行文件不存在: ${appPath}`)
  return appPath
}

function findPackagedAsar(appPath: string): string {
  const appDir = dirname(appPath)
  const candidates = process.platform === 'darwin'
    ? [join(appDir, '..', 'Resources', 'app.asar')]
    : [join(appDir, 'resources', 'app.asar'), join(appDir, '..', 'resources', 'app.asar')]
  const asarPath = candidates.find((candidate) => existsSync(candidate))
  if (!asarPath) {
    throw new Error(`打包产物缺少 app.asar，已检查: ${candidates.join(', ')}`)
  }
  return resolve(asarPath)
}

function assertPackagedRuntimeBundle(appPath: string): void {
  const asarPath = findPackagedAsar(appPath)
  const asarCli = resolve(
    import.meta.dir,
    '../../../node_modules/.bin',
    process.platform === 'win32' ? 'asar.cmd' : 'asar',
  )
  if (!existsSync(asarCli)) throw new Error(`找不到 asar CLI，无法验证 ${asarPath}`)

  const result = spawnSync(asarCli, ['list', asarPath], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`读取 app.asar 失败: ${result.stderr || result.stdout}`)
  }
  const entries = result.stdout.split(/\r?\n/)
  if (!entries.some((entry) => entry.replace(/^\//, '') === 'dist/pi-runtime.cjs')) {
    throw new Error(`app.asar 未包含 dist/pi-runtime.cjs: ${asarPath}`)
  }
  log(`产物合同通过: ${asarPath} 包含 dist/pi-runtime.cjs`)
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function createCompletionResponse(): string {
  const firstChunk = {
    id: 'chatcmpl-packaged-smoke',
    object: 'chat.completion.chunk',
    created: 0,
    model: MODEL_ID,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content: RESPONSE_MARKER },
      finish_reason: null,
    }],
  }
  const finalChunk = {
    id: 'chatcmpl-packaged-smoke',
    object: 'chat.completion.chunk',
    created: 0,
    model: MODEL_ID,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 16, completion_tokens: 1, total_tokens: 17 },
  }

  return [
    `data: ${JSON.stringify(firstChunk)}\n\n`,
    `data: ${JSON.stringify(finalChunk)}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
}

async function createMockProvider(): Promise<{ server: Server; port: number }> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end('not found')
      return
    }

    const authorization = request.headers.authorization
    if (authorization !== 'Bearer packaged-smoke-key') {
      response.writeHead(401).end('invalid smoke credential')
      return
    }

    const body = await readRequestBody(request)
    if (!body.includes(`"model":"${MODEL_ID}"`)) {
      response.writeHead(400).end('unexpected smoke model')
      return
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    })
    response.end(createCompletionResponse())
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('mock provider 未能取得监听端口')
  }
  return { server, port: address.port }
}

function writeSmokeConfig(configDir: string, mockPort: number, workspaceDir: string): void {
  const now = Date.now()
  const channel = {
    id: CHANNEL_ID,
    name: 'Packaged Runtime Smoke',
    provider: 'custom',
    apiType: 'openai',
    baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    apiKey: 'plain:packaged-smoke-key',
    models: [{ id: MODEL_ID, name: 'Packaged Runtime Smoke', enabled: true }],
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }

  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(join(configDir, 'channels.json'), JSON.stringify({ version: 1, channels: [channel] }, null, 2))
  writeFileSync(join(configDir, 'settings.json'), JSON.stringify({
    themeMode: 'dark',
    themeId: 'default',
    onboardingCompleted: true,
    environmentCheckSkipped: true,
    unifiedSessionsBootstrapped: true,
    sessionProjectModelBootstrapped: true,
    agentChannelId: CHANNEL_ID,
    agentModelId: MODEL_ID,
  }, null, 2))
}

function startPackagedApp(appPath: string, configDir: string): { app: ChildProcess; getLog: () => string } {
  let output = ''
  const app = spawn(appPath, [
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${join(configDir, 'user-data')}`,
  ], {
    cwd: dirname(appPath),
    env: { ...process.env, KILA_CONFIG_DIR: configDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const collect = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-32_000)
  }
  app.stdout?.on('data', collect)
  app.stderr?.on('data', collect)
  app.on('error', (error) => collect(Buffer.from(`[子进程 error] ${error.message}\n`)))
  app.on('exit', (code, signal) => collect(Buffer.from(`[子进程 exit] code=${code ?? 'null'} signal=${signal ?? 'null'}\n`)))
  return { app, getLog: () => output }
}

async function waitForDiscovery(configDir: string, context: SmokeContext): Promise<CliDiscovery> {
  const discoveryPath = join(configDir, 'cli-bridge.json')
  const startedAt = Date.now()
  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    if (existsSync(discoveryPath)) {
      try {
        const discovery = JSON.parse(readFileSync(discoveryPath, 'utf8')) as CliDiscovery
        if (discovery.port > 0 && discovery.token) return discovery
      } catch {
        // 主进程正在原子外写入发现文件，下一轮重试。
      }
    }
    if (context.app.exitCode !== null) fail(`打包应用提前退出，退出码=${context.app.exitCode}`, context)
    await delay(200)
  }
  fail('等待 CLI bridge 发现文件超时', context)
}

async function fetchBridge(discovery: CliDiscovery, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://${discovery.host}:${discovery.port}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${discovery.token}`,
      ...(init?.headers ?? {}),
    },
  })
}

function parseSseEvents(raw: string): SseEvent[] {
  return raw.split(/\n\n+/).flatMap((block) => {
    const name = block.match(/^event: (.+)$/m)?.[1]
    const data = block.match(/^data: (.+)$/m)?.[1]
    if (!name || !data || data === '[DONE]') return []
    try {
      return [{ name, data: JSON.parse(data) as Record<string, unknown> }]
    } catch {
      return []
    }
  })
}

async function runThroughBridge(discovery: CliDiscovery, workspaceDir: string, context: SmokeContext): Promise<string> {
  const health = await fetchBridge(discovery, '/v1/health')
  if (!health.ok) fail(`CLI bridge health 检查失败: HTTP ${health.status}`, context)

  const response = await fetchBridge(discovery, '/v1/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '请只回复一个短句，验证打包后的 runtime 隔离链路。',
      projectPath: workspaceDir,
      channelId: CHANNEL_ID,
      modelId: MODEL_ID,
    }),
  })
  const raw = await response.text()
  if (!response.ok) fail(`CLI bridge run 失败: HTTP ${response.status}\n${raw}`, context)

  const events = parseSseEvents(raw)
  const created = events.find((event) => event.name === 'session_created')
  const complete = events.find((event) => event.name === 'session_complete')
  const streamText = events
    .filter((event) => event.name === 'session_stream')
    .map((event) => JSON.stringify(event.data))
    .join('\n')

  if (!created) fail('smoke 未收到 session_created', context)
  if (!streamText.includes(RESPONSE_MARKER)) {
    fail(`smoke 未收到 mock provider 的 assistant 输出\nSSE 原文:\n${raw.slice(-12_000)}`, context)
  }
  if (complete?.data.reason !== 'completed') {
    fail(`smoke 未正常收敛 session_complete: ${JSON.stringify(complete?.data)}`, context)
  }

  const sessionId = (created.data.session as { id?: string } | undefined)?.id
  if (!sessionId) fail('session_created 缺少 session id', context)

  const messagesResponse = await fetchBridge(discovery, `/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=100`)
  const messagesPayload = await messagesResponse.json() as { messages?: Array<{ role?: string; content?: unknown }> }
  if (!messagesResponse.ok || !Array.isArray(messagesPayload.messages)) {
    fail('smoke 无法读取已持久化的 session 消息', context)
  }
  if (!messagesPayload.messages.some((message) => message.role === 'assistant' && JSON.stringify(message.content).includes(RESPONSE_MARKER))) {
    fail('smoke 的 assistant 消息未通过 receipt barrier 持久化', context)
  }

  return sessionId
}

function listRuntimeProcesses(): string[] {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pi-runtime\\.cjs' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }",
    ], { encoding: 'utf8', windowsHide: true })
    return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : []
  }

  const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
  return result.status === 0
    ? result.stdout.split(/\r?\n/).filter((line) => line.includes('pi-runtime.cjs'))
    : []
}

async function stopPackagedApp(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null) return
  app.kill()
  const startedAt = Date.now()
  while (app.exitCode === null && Date.now() - startedAt < 8_000) await delay(100)
  if (app.exitCode !== null || app.pid === undefined) return

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  } else {
    try { process.kill(app.pid, 'SIGKILL') } catch { /* 进程已退出 */ }
  }
}

async function main(): Promise<void> {
  const appPath = parseAppPath(process.argv.slice(2))
  assertPackagedRuntimeBundle(appPath)
  const configDir = mkdtempSync(join(tmpdir(), 'kila-packaged-runtime-config-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'kila-packaged-runtime-workspace-'))
  const { server: mockServer, port: mockPort } = await createMockProvider()
  writeSmokeConfig(configDir, mockPort, workspaceDir)
  const started = startPackagedApp(appPath, configDir)
  const context: SmokeContext = {
    configDir,
    workspaceDir,
    mockServer,
    mockPort,
    app: started.app,
    appLog: '',
    getAppLog: started.getLog,
  }

  try {
    context.appLog = started.getLog()
    const discovery = await waitForDiscovery(configDir, context)
    context.appLog = started.getLog()
    const sessionId = await runThroughBridge(discovery, workspaceDir, context)
    context.appLog = started.getLog()
    log(`mock provider 已完成真实打包运行，session=${sessionId}`)
  } finally {
    context.appLog = started.getLog()
    await stopPackagedApp(started.app)
    await new Promise<void>((resolveClose) => mockServer.close(() => resolveClose()))
    await delay(500)
    const leftovers = listRuntimeProcesses()
    const keepFailure = process.env.KILA_PACKAGED_SMOKE_KEEP_FAILURE === '1'
    if (keepFailure) {
      log(`保留 smoke 临时目录: config=${configDir} workspace=${workspaceDir}`)
    } else {
      rmSync(configDir, { recursive: true, force: true })
      rmSync(workspaceDir, { recursive: true, force: true })
    }
    if (leftovers.length > 0) fail(`检测到未退出的 pi-runtime 进程:\n${leftovers.join('\n')}`, context)
  }

  log(`通过: ${appPath}`)
}

await main()

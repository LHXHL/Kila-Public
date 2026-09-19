#!/usr/bin/env bun

import { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { build, context, type BuildOptions, type OutputFile, type Plugin } from 'esbuild'

type BundleTarget = 'main' | 'preload' | 'pi-runtime'

const projectDir = resolve(import.meta.dir, '..')

const bundleConfigs: Record<BundleTarget, { entry: string, outfile: string, external: string[] }> = {
  main: {
    entry: resolve(projectDir, 'src/main/index.ts'),
    outfile: resolve(projectDir, 'dist/main.cjs'),
    external: [
      'electron',
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-ai/*',
      '@earendil-works/pi-coding-agent',
      // 飞书 SDK（内部有运行时版本检测和 HTTP 客户端初始化，打包会破坏）
      '@larksuiteoapi/node-sdk',
      // 重型文档解析库（运行时按需加载，避免 71MB 主 bundle）
      'pdf-parse',
      'officeparser',
      'word-extractor',
    ],
  },
  preload: {
    entry: resolve(projectDir, 'src/preload/index.ts'),
    outfile: resolve(projectDir, 'dist/preload.cjs'),
    external: ['electron'],
  },
  'pi-runtime': {
    entry: resolve(projectDir, 'src/utility/pi-runtime.ts'),
    outfile: resolve(projectDir, 'dist/pi-runtime.cjs'),
    external: [
      'electron',
      '@earendil-works/pi-agent-core',
      '@earendil-works/pi-ai',
      '@earendil-works/pi-ai/*',
      '@earendil-works/pi-coding-agent',
    ],
  },
}

function parseArgs(argv: string[]) {
  const [targetArg, ...flags] = argv

  if (targetArg !== 'main' && targetArg !== 'preload' && targetArg !== 'pi-runtime' && targetArg !== 'utility') {
    throw new Error('usage: bun run scripts/build-bundle.ts <main|preload|pi-runtime> [--watch]')
  }

  return {
    target: (targetArg === 'utility' ? 'pi-runtime' : targetArg) as BundleTarget,
    watch: flags.includes('--watch'),
  }
}

function writeAtomically(targetPath: string, contents: Uint8Array) {
  const targetDir = dirname(targetPath)
  const tempPath = resolve(
    targetDir,
    `.${basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  )

  mkdirSync(targetDir, { recursive: true })
  writeFileSync(tempPath, contents)
  try {
    renameSync(tempPath, targetPath)
  } catch (renameError) {
    if (process.platform !== 'win32') throw renameError
    const code = (renameError as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw renameError
    copyFileSync(tempPath, targetPath)
    try { unlinkSync(tempPath) } catch { /* noop */ }
  }
}

function createAtomicWritePlugin(outfile: string, watch: boolean): Plugin {
  return {
    name: 'atomic-write',
    setup(buildApi) {
      buildApi.onEnd((result) => {
        if (result.errors.length > 0) {
          return
        }

        // 写入主产物
        const outputFile = resolveOutputFile(result.outputFiles, outfile)
        writeAtomically(outfile, outputFile.contents)
        if (targetIsMainBundle(outfile)) assertMainBundleBoundary(outfile)
        if (targetIsPiRuntimeBundle(outfile)) assertPiRuntimeBoundary(outfile)

        // 写入 sourcemap（如果存在）
        const mapPath = `${outfile}.map`
        const mapFile = result.outputFiles?.find((file) => resolve(file.path) === mapPath)
        if (mapFile) {
          writeAtomically(mapPath, mapFile.contents)
        }

        if (watch) {
          console.log(`[watch] ${basename(outfile)} build finished, watching for changes...`)
        }
      })
    },
  }
}

function targetIsMainBundle(outfile: string): boolean {
  return basename(outfile) === 'main.cjs'
}

function targetIsPiRuntimeBundle(outfile: string): boolean {
  return basename(outfile) === 'pi-runtime.cjs'
}

function assertMainBundleBoundary(outfile: string): void {
  const contents = readFileSync(outfile, 'utf8')
  const forbidden = ['createAgentSession', 'SessionManager.continueRecent', 'class PiAgentAdapter']
  const match = forbidden.find((needle) => contents.includes(needle))
  if (match) throw new Error(`主进程产物越过 Pi Runtime 边界，发现 ${match}`)
}

function assertPiRuntimeBoundary(outfile: string): void {
  const contents = readFileSync(outfile, 'utf8')
  const required = ['process.parentPort', 'runtime.handshake', 'createAgentSession']
  const missing = required.find((needle) => !contents.includes(needle))
  if (missing) throw new Error(`Pi Runtime 产物缺少隔离入口标记：${missing}`)
}

function resolveOutputFile(outputFiles: OutputFile[] | undefined, outfile: string): OutputFile {
  if (!outputFiles || outputFiles.length === 0) {
    throw new Error(`esbuild did not emit output for ${outfile}`)
  }

  return outputFiles.find((file) => resolve(file.path) === outfile) ?? outputFiles[0]
}

function createBuildOptions(target: BundleTarget, watch: boolean): BuildOptions {
  const config = bundleConfigs[target]

  return {
    absWorkingDir: projectDir,
    bundle: true,
    entryPoints: [config.entry],
    external: config.external,
    format: 'cjs',
    outfile: config.outfile,
    platform: 'node',
    plugins: [createAtomicWritePlugin(config.outfile, watch)],
    write: false,
    // 生产构建优化
    minify: !watch,
    treeShaking: true,
    sourcemap: watch ? 'inline' : 'external',
    drop: watch ? [] : ['debugger'],
    logLevel: 'warning',
  }
}

async function run() {
  const { target, watch } = parseArgs(process.argv.slice(2))
  const options = createBuildOptions(target, watch)

  if (!watch) {
    await build(options)
    return
  }

  const ctx = await context(options)

  const dispose = async () => {
    await ctx.dispose()
    process.exit(0)
  }

  process.on('SIGINT', () => void dispose())
  process.on('SIGTERM', () => void dispose())

  await ctx.watch()
  await new Promise(() => {})
}

await run()

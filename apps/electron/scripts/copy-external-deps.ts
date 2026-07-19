#!/usr/bin/env bun
/**
 * 复制 external 依赖到 dist/ext-modules/node_modules/
 *
 * esbuild 将重型依赖标记为 external 后，运行时需要从标准 node_modules 布局加载。
 * 此脚本递归复制依赖及其子依赖到 dist/ext-modules/node_modules/ 目录。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const projectDir = resolve(import.meta.dir, '..')
const rootDir = resolve(projectDir, '..', '..')
const rootModules = join(rootDir, 'node_modules')
const extModulesDir = join(projectDir, 'dist', 'ext-modules')
const distModules = join(extModulesDir, 'node_modules')

// esbuild external 中需要复制到 dist 的包
const EXTERNAL_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  'pdf-parse',
  'officeparser',
  'word-extractor',
  '@larksuiteoapi/node-sdk',
]

const copied = new Set<string>()

function resolvePackageDir(name: string): string | null {
  // 优先从 monorepo root node_modules 解析
  const paths = [rootModules, join(projectDir, 'node_modules')]
  for (const base of paths) {
    const dir = join(base, name)
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return null
}

function getDeps(pkgDir: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'))
    const deps = Object.keys(pkg.dependencies ?? {})
    const optionalDeps = Object.keys(pkg.optionalDependencies ?? {})
    return [...deps, ...optionalDeps]
  } catch {
    return []
  }
}

function copyPackage(name: string): void {
  if (copied.has(name)) return
  // 跳过 TypeScript 类型定义（运行时不需要）
  if (name.startsWith('@types/')) {
    copied.add(name)
    return
  }
  copied.add(name)

  const srcDir = resolvePackageDir(name)
  if (!srcDir) {
    console.warn(`[copy-external-deps] 跳过未找到的包: ${name}`)
    return
  }

  const destDir = join(distModules, name)
  if (existsSync(destDir)) return

  mkdirSync(dirname(destDir), { recursive: true })
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(srcDir.length + 1)
      // 排除测试、文档、源码等无用文件
      if (rel.startsWith('test') || rel.startsWith('tests')) return false
      if (rel.startsWith('docs') || rel.startsWith('doc')) return false
      if (rel.startsWith('.github')) return false
      if (rel.startsWith('example') || rel.startsWith('examples')) return false
      if (rel.startsWith('benchmark')) return false
      // 排除 .bin 目录（CLI 入口符号链接，运行时不需要且打包后断链）
      if (rel === '.bin' || rel.startsWith('.bin/') || rel.includes('/.bin/') || rel.includes('\\.bin\\')) return false
      // 排除 @types 包（运行时不需要 TypeScript 类型定义）
      if (rel.startsWith('@types')) return false
      return true
    },
  })
  console.log(`  ${name} (${(dirSize(destDir) / 1024 / 1024).toFixed(1)}MB)`)

  // 递归复制子依赖
  for (const dep of getDeps(srcDir)) {
    copyPackage(dep)
  }
}

function dirSize(dir: string): number {
  let total = 0
  try {
    const { readdirSync, statSync } = require('node:fs')
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        total += statSync(join(entry.path || dir, entry.name)).size
      }
    }
  } catch { /* ignore */ }
  return total
}

console.log('[copy-external-deps] 复制 external 依赖到 dist/ext-modules/node_modules/...')

// 清理旧目录
if (existsSync(extModulesDir)) {
  rmSync(extModulesDir, { recursive: true, force: true })
}
mkdirSync(distModules, { recursive: true })

for (const pkg of EXTERNAL_PACKAGES) {
  copyPackage(pkg)
}

for (const pkg of EXTERNAL_PACKAGES) {
  if (!existsSync(join(distModules, pkg, 'package.json'))) {
    throw new Error(`[copy-external-deps] external 根依赖复制失败: ${pkg}`)
  }
}
const distRequire = createRequire(join(extModulesDir, 'probe.cjs'))
distRequire.resolve('call-bind-apply-helpers')

console.log(`[copy-external-deps] 完成，共 ${copied.size} 个包`)

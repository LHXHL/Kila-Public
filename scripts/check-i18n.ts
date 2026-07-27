#!/usr/bin/env bun
/**
 * i18n 一致性闸门
 *
 * 校验四件事：
 * 1. zh-CN 与 en 的领域文件一一对应（不能只加一边）
 * 2. 两种语言的 key 集合完全一致（不能只补中文忘了英文）
 * 3. 没有空字符串译文（占位没填完就提交）
 * 4. 组件里 `t('x.y')` 引用的 key 必须真实存在 —— 半迁移时最危险的失效模式是
 *    组件改成了 t() 但忘了补 key，界面会直接显示原始 key 字符串而不是文案，
 *    而前三项检查对此完全无感。
 *
 * 用法：bun run scripts/check-i18n.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOCALES_DIR = join(import.meta.dir, '..', 'apps', 'electron', 'src', 'renderer', 'locales')
const BASE_LANG = 'zh-CN'
const TARGET_LANGS = ['en']

interface FlatEntry {
  key: string
  value: string
}

/** 把嵌套 JSON 拍平成 `a.b.c` 形式，非字符串叶子视为错误 */
function flatten(obj: unknown, prefix: string, out: FlatEntry[], errors: string[]): void {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    errors.push(`${prefix} 不是对象或字符串`)
    return
  }

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out.push({ key: path, value })
    } else {
      flatten(value, path, out, errors)
    }
  }
}

function loadLang(lang: string): { entries: FlatEntry[]; files: string[]; errors: string[] } {
  const dir = join(LOCALES_DIR, lang)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const entries: FlatEntry[] = []
  const errors: string[] = []

  for (const file of files) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
      flatten(parsed, '', entries, errors)
    } catch (error) {
      errors.push(`${lang}/${file} 解析失败：${String(error)}`)
    }
  }

  return { entries, files, errors }
}

const RENDERER_DIR = join(import.meta.dir, '..', 'apps', 'electron', 'src', 'renderer')

/** 递归收集 renderer 下的 .ts/.tsx 源文件 */
function collectSourceFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'locales' || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
}

/**
 * 扫描组件里的静态 `t('...')` 调用，返回引用了但不存在的 key。
 *
 * 只认字面量参数：动态拼接（`t(someVar)` / 模板串）无法静态判定，跳过而不误报。
 */
/**
 * i18next 复数/序数后缀。
 *
 * 组件写 `t('x.count', { count })`，而 JSON 里存的是 `x.count_one` / `x.count_other`，
 * 基础键本身并不存在 —— 校验必须认这些后缀，否则会把正确的复数写法误判为缺失，
 * 反过来逼开发者放弃英文单复数。
 */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other']

/** 判断某个 key 是否可解析：本身存在，或存在任一复数/序数变体 */
function isKeyResolvable(key: string, availableKeys: Set<string>): boolean {
  if (availableKeys.has(key)) return true
  return PLURAL_SUFFIXES.some(
    (suffix) => availableKeys.has(`${key}_${suffix}`) || availableKeys.has(`${key}_ordinal_${suffix}`),
  )
}

function findMissingKeyReferences(availableKeys: Set<string>): string[] {
  const files: string[] = []
  collectSourceFiles(RENDERER_DIR, files)

  const missing = new Map<string, string>()
  const callPattern = /\bt\(\s*'([A-Za-z][\w.]*)'/g

  for (const file of files) {
    const source = readFileSync(file, 'utf-8')
    for (const match of source.matchAll(callPattern)) {
      const key = match[1]
      if (!key || key.indexOf('.') === -1) continue
      if (isKeyResolvable(key, availableKeys)) continue
      if (!missing.has(key)) {
        missing.set(key, file.replace(`${RENDERER_DIR}/`, ''))
      }
    }
  }

  return [...missing.entries()].map(([key, file]) => `${key}（${file}）`)
}

function main(): void {
  const base = loadLang(BASE_LANG)
  const problems: string[] = [...base.errors]

  const baseKeys = new Set(base.entries.map((e) => e.key))
  const emptyBase = base.entries.filter((e) => e.value.trim() === '')
  if (emptyBase.length > 0) {
    problems.push(`${BASE_LANG} 有 ${emptyBase.length} 条空译文：${emptyBase.slice(0, 5).map((e) => e.key).join(', ')}`)
  }

  for (const lang of TARGET_LANGS) {
    const target = loadLang(lang)
    problems.push(...target.errors)

    const missingFiles = base.files.filter((f) => !target.files.includes(f))
    const extraFiles = target.files.filter((f) => !base.files.includes(f))
    if (missingFiles.length > 0) problems.push(`${lang} 缺少领域文件：${missingFiles.join(', ')}`)
    if (extraFiles.length > 0) problems.push(`${lang} 多出领域文件：${extraFiles.join(', ')}`)

    const targetKeys = new Set(target.entries.map((e) => e.key))

    // 复数形态按「基础键」比对：中文只需 _other，英文需要 _one/_other，
    // 逐键严格比对会把这种合理差异判成缺失。
    const toPluralBase = (key: string): string => {
      for (const suffix of PLURAL_SUFFIXES) {
        if (key.endsWith(`_${suffix}`)) return key.slice(0, -(suffix.length + 1)).replace(/_ordinal$/, '')
      }
      return key
    }
    const baseFamilies = new Set([...baseKeys].map(toPluralBase))
    const targetFamilies = new Set([...targetKeys].map(toPluralBase))

    const missing = [...baseFamilies].filter((k) => !targetFamilies.has(k))
    const extra = [...targetFamilies].filter((k) => !baseFamilies.has(k))

    if (missing.length > 0) {
      problems.push(`${lang} 缺少 ${missing.length} 个 key：${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`)
    }
    if (extra.length > 0) {
      problems.push(`${lang} 多出 ${extra.length} 个 key：${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' …' : ''}`)
    }

    const empty = target.entries.filter((e) => e.value.trim() === '')
    if (empty.length > 0) {
      problems.push(`${lang} 有 ${empty.length} 条空译文：${empty.slice(0, 5).map((e) => e.key).join(', ')}`)
    }
  }

  const missingRefs = findMissingKeyReferences(baseKeys)
  if (missingRefs.length > 0) {
    problems.push(
      `组件引用了 ${missingRefs.length} 个不存在的 key（界面会直接显示原始 key 字符串）：\n      `
      + missingRefs.slice(0, 12).join('\n      ')
      + (missingRefs.length > 12 ? `\n      …（另有 ${missingRefs.length - 12} 个）` : ''),
    )
  }

  if (problems.length > 0) {
    console.error('[i18n] ✗ 校验未通过：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  console.log(`[i18n] ✓ 通过（${base.files.length} 个领域文件，${baseKeys.size} 个 key × ${1 + TARGET_LANGS.length} 种语言；组件 t() 引用全部命中）`)
}

main()

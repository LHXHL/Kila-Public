#!/usr/bin/env bun
/**
 * i18n 运行时探针
 *
 * `check-i18n.ts` 是静态检查（key 对齐、引用存在性），但有些失效只在运行时才暴露：
 *
 * 1. **key 回显** —— 译文缺失时 i18next 会原样返回 key，界面上出现 `settings.foo.bar`
 * 2. **复数变体泄漏** —— 写了 `x_one` 却没写 `x_other`，或反过来
 * 3. **插值未替换** —— 译文里的 `{{count}}` 因为变量名对不上而原样渲染
 * 4. **英文侧残留中文** —— 漏翻的条目
 *
 * 本脚本把两种语言的全部译文过一遍真实的 i18next 实例，逐条断言渲染结果。
 *
 * 用法：bun run scripts/probe-i18n-runtime.ts
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next from 'i18next'

const LOCALES_DIR = join(import.meta.dir, '..', 'apps', 'electron', 'src', 'renderer', 'locales')
const LANGS = ['zh-CN', 'en'] as const
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other']

interface Problem {
  lang: string
  key: string
  detail: string
}

function loadResources(lang: string): Record<string, unknown> {
  const dir = join(LOCALES_DIR, lang)
  let merged: Record<string, unknown> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    merged = { ...merged, ...(JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>) }
  }
  return merged
}

function flatten(obj: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof obj !== 'object' || obj === null) return
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, value)
    else flatten(value, path, out)
  }
}

/** 去掉复数后缀，得到调用方实际会用的基础 key */
function toBaseKey(key: string): { base: string; isPlural: boolean } {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suffix}`)) {
      return { base: key.slice(0, -(suffix.length + 1)).replace(/_ordinal$/, ''), isPlural: true }
    }
  }
  return { base: key, isPlural: false }
}

/** 从译文里提取插值变量名 */
function extractPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] ?? '')
}

async function main(): Promise<void> {
  const problems: Problem[] = []

  for (const lang of LANGS) {
    const resources = loadResources(lang)
    const entries = new Map<string, string>()
    flatten(resources, '', entries)

    const instance = i18next.createInstance()
    await instance.init({
      lng: lang,
      resources: { [lang]: { translation: resources } },
      interpolation: { escapeValue: false },
    })

    // 基础 key 去重（复数变体归一到同一个基础 key）
    const baseKeys = new Map<string, { isPlural: boolean; sample: string }>()
    for (const [key, value] of entries) {
      const { base, isPlural } = toBaseKey(key)
      const existing = baseKeys.get(base)
      baseKeys.set(base, { isPlural: isPlural || (existing?.isPlural ?? false), sample: value })
    }

    for (const [base, meta] of baseKeys) {
      // 为插值变量准备样例值；复数键统一喂 count
      const placeholders = extractPlaceholders(meta.sample)
      const vars: Record<string, string | number> = {}
      for (const name of placeholders) {
        vars[name] = name === 'count' ? 2 : `«${name}»`
      }
      if (meta.isPlural && vars.count === undefined) vars.count = 2

      const counts = meta.isPlural ? [0, 1, 2, 5] : [undefined]

      for (const count of counts) {
        const options = count === undefined ? vars : { ...vars, count }
        const rendered = instance.t(base, options)

        if (rendered === base) {
          problems.push({ lang, key: base, detail: `渲染结果等于 key 本身（译文缺失，界面会显示原始 key）${count !== undefined ? `，count=${count}` : ''}` })
          continue
        }
        if (/_(?:zero|one|two|few|many|other)$/.test(rendered)) {
          problems.push({ lang, key: base, detail: `渲染结果泄漏了复数后缀：${rendered}` })
        }
        if (rendered.includes('{{')) {
          problems.push({ lang, key: base, detail: `插值未被替换：${rendered}` })
        }
        if (lang === 'en' && /[一-龥]/.test(rendered)) {
          problems.push({ lang, key: base, detail: `英文译文含中文：${rendered}` })
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`[i18n 探针] ✗ 发现 ${problems.length} 个问题：`)
    for (const p of problems.slice(0, 30)) {
      console.error(`  - [${p.lang}] ${p.key}：${p.detail}`)
    }
    if (problems.length > 30) console.error(`  …（另有 ${problems.length - 30} 个）`)
    process.exit(1)
  }

  console.log('[i18n 探针] ✓ 通过（两种语言全部译文经真实 i18next 实例渲染，无 key 回显 / 复数泄漏 / 插值残留 / 中文残留）')
}

await main()

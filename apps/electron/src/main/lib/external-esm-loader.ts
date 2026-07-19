/**
 * 加载 esbuild external 的 ESM-only 包。
 *
 * 开发环境直接使用 workspace 的 Node ESM 解析；打包环境先从
 * Resources/ext-modules/node_modules 读取 package exports，再交给原生 import()。
 * 不能使用 require.resolve()：Pi 包只声明了 `import` condition，没有 `require` condition。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type NativeDynamicImport = <T>(specifier: string) => Promise<T>
type PackageExports = string | Record<string, unknown>

const nativeDynamicImport = new Function('specifier', 'return import(specifier)') as NativeDynamicImport

function externalNodeModulesDirs(): string[] {
  const dirs: string[] = []
  const overriddenDir = process.env.KILA_EXTERNAL_MODULES_DIR?.trim()
  if (overriddenDir) dirs.push(resolve(overriddenDir))

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    dirs.push(join(resourcesPath, 'ext-modules', 'node_modules'))
  }
  dirs.push(join(__dirname, 'ext-modules', 'node_modules'))
  return [...new Set(dirs)]
}

function splitPackageSpecifier(specifier: string): { packageName: string; exportKey: string } | undefined {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('://')) {
    return undefined
  }

  const segments = specifier.split('/')
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0]
  if (!packageName || (specifier.startsWith('@') && segments.length < 2)) return undefined

  const subpath = specifier.slice(packageName.length)
  return {
    packageName,
    exportKey: subpath ? `.${subpath}` : '.',
  }
}

function pickImportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const conditions = value as Record<string, unknown>
  for (const key of ['import', 'node', 'default']) {
    const target = pickImportTarget(conditions[key])
    if (target) return target
  }
  return undefined
}

function resolveExportTarget(exportsField: PackageExports | undefined, exportKey: string): string | undefined {
  if (!exportsField) return undefined
  if (typeof exportsField === 'string') return exportKey === '.' ? exportsField : undefined

  const exact = pickImportTarget(exportsField[exportKey])
  if (exact) return exact

  for (const [key, value] of Object.entries(exportsField)) {
    const wildcardIndex = key.indexOf('*')
    if (wildcardIndex < 0) continue
    const prefix = key.slice(0, wildcardIndex)
    const suffix = key.slice(wildcardIndex + 1)
    if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix)) continue
    const wildcard = exportKey.slice(prefix.length, exportKey.length - suffix.length)
    const target = pickImportTarget(value)
    if (target) return target.replaceAll('*', wildcard)
  }

  return exportKey === '.' ? pickImportTarget(exportsField) : undefined
}

function resolveFromExternalModules(specifier: string): string | undefined {
  const parsed = splitPackageSpecifier(specifier)
  if (!parsed) return undefined

  for (const modulesDir of externalNodeModulesDirs()) {
    const packageDir = join(modulesDir, parsed.packageName)
    const packageJsonPath = join(packageDir, 'package.json')
    if (!existsSync(packageJsonPath)) continue

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        exports?: PackageExports
        module?: string
        main?: string
      }
      const relativeTarget = resolveExportTarget(packageJson.exports, parsed.exportKey)
        ?? (parsed.exportKey === '.' ? packageJson.module ?? packageJson.main : undefined)
      if (!relativeTarget) continue

      const resolved = resolve(packageDir, relativeTarget)
      if (existsSync(resolved)) return resolved
    } catch {
      // 包元数据损坏时继续尝试其他运行时位置，最终交给原生解析报错。
    }
  }

  return undefined
}

export function resolveExternalEsmModule(specifier: string): string {
  return resolveFromExternalModules(specifier) ?? specifier
}

export function loadExternalEsm<T>(specifier: string): Promise<T> {
  const resolved = resolveExternalEsmModule(specifier)
  const importSpecifier = resolved === specifier ? specifier : pathToFileURL(resolved).href
  return nativeDynamicImport<T>(importSpecifier)
}

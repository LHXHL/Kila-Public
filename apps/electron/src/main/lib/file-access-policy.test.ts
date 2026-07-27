/**
 * 文件访问白名单 — 符号链接解引用回归测试
 *
 * 原实现只做 resolve() + relative() 的词法判断：
 * 恶意仓库或 Agent 在项目内植入 `notes.txt -> ~/.ssh/id_rsa`，
 * 词法上仍在根内，实际却读到根外文件。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertPathWithinAllowedRoots,
  isPathInsideRoot,
  isPathWithinAllowedRoots,
} from './file-access-policy'

let sandboxDir = ''
let projectRoot = ''
let secretFile = ''

beforeEach(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), 'kila-file-access-'))
  projectRoot = join(sandboxDir, 'project')
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'README.md'), '# ok', 'utf-8')

  // 根目录之外的敏感文件
  secretFile = join(sandboxDir, 'id_rsa')
  writeFileSync(secretFile, 'PRIVATE-KEY', 'utf-8')
})

afterEach(() => {
  rmSync(sandboxDir, { recursive: true, force: true })
})

describe('符号链接解引用', () => {
  test('Given 项目内符号链接指向根外文件，When 校验访问，Then 拒绝', () => {
    const link = join(projectRoot, 'notes.txt')
    symlinkSync(secretFile, link)

    expect(isPathInsideRoot(link, projectRoot)).toBe(false)
    expect(isPathWithinAllowedRoots(link, [projectRoot])).toBe(false)
    expect(() => assertPathWithinAllowedRoots(link, [projectRoot]))
      .toThrow('访问路径超出 Agent 工作区范围')
  })

  test('Given 项目内目录软链指向根外目录，When 通过它访问子文件，Then 拒绝', () => {
    const outsideDir = join(sandboxDir, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, 'secret.env'), 'TOKEN=1', 'utf-8')

    symlinkSync(outsideDir, join(projectRoot, 'linked'))

    expect(isPathInsideRoot(join(projectRoot, 'linked', 'secret.env'), projectRoot)).toBe(false)
  })

  test('Given 断链符号链接指向根外路径，When 校验访问，Then 依然拒绝', () => {
    const link = join(projectRoot, 'ghost.txt')
    symlinkSync(join(sandboxDir, 'not-created-yet'), link)

    expect(isPathInsideRoot(link, projectRoot)).toBe(false)
  })

  test('Given 指向根内文件的符号链接，When 校验访问，Then 放行', () => {
    const link = join(projectRoot, 'alias.md')
    symlinkSync(join(projectRoot, 'README.md'), link)

    expect(isPathInsideRoot(link, projectRoot)).toBe(true)
  })
})

describe('不破坏正常访问路径', () => {
  test('Given 根内已存在的文件，When 校验访问，Then 放行', () => {
    expect(isPathInsideRoot(join(projectRoot, 'README.md'), projectRoot)).toBe(true)
    expect(isPathInsideRoot(projectRoot, projectRoot)).toBe(true)
  })

  test('Given 根内尚不存在的写入路径，When 校验访问，Then 放行（不因 realpath 抛错而误杀）', () => {
    expect(isPathInsideRoot(join(projectRoot, 'src', 'new', 'deep', 'file.ts'), projectRoot)).toBe(true)
    expect(assertPathWithinAllowedRoots(join(projectRoot, 'new-file.ts'), [projectRoot]))
      .toBe(join(projectRoot, 'new-file.ts'))
  })

  test('Given 根外的普通路径，When 校验访问，Then 拒绝', () => {
    expect(isPathInsideRoot(secretFile, projectRoot)).toBe(false)
    expect(isPathInsideRoot(join(projectRoot, '..', 'id_rsa'), projectRoot)).toBe(false)
  })
})

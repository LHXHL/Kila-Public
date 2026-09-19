import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodingTool } from '@kila/shared'
import { createEditTool } from './edit-tool'
import { createReadTool } from './read-tool'
import { createWriteTool } from './write-tool'
import { createCodingPathPolicy } from './path-policy'

const createdDirs: string[] = []

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createFixture(): { root: string; tools: CodingTool[] } {
  const root = mkdtempSync(join(tmpdir(), 'kila-coding-tools-'))
  createdDirs.push(root)
  const policy = createCodingPathPolicy({ sessionId: `test-${Date.now()}`, cwd: root })
  return {
    root,
    tools: [createReadTool(policy), createWriteTool(policy), createEditTool(policy)],
  }
}

function getTool(
  tools: CodingTool[],
  name: 'read' | 'write' | 'edit' | 'bash',
) {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`缺少工具: ${name}`)
  return tool
}

describe('Kila coding tools', () => {
  test('Given 新文件路径 When write Then 创建父目录并原子写入内容', async () => {
    const { root, tools } = createFixture()

    const result = await getTool(tools, 'write').execute('call-write', {
      path: 'nested/note.txt',
      content: '第一行\n第二行',
    })

    expect(readFileSync(join(root, 'nested/note.txt'), 'utf8')).toBe('第一行\n第二行')
    expect(result.details?.bytesWritten).toBe(Buffer.byteLength('第一行\n第二行'))
    expect(existsSync(join(root, 'nested/note.txt.kila-temp'))).toBe(false)
  })

  test('Given 带 BOM 的文本 When read with offset and limit Then 返回指定行并去除 BOM', async () => {
    const { root, tools } = createFixture()
    writeFileSync(join(root, 'notes.txt'), '\ufeff一\n二\n三\n四', 'utf8')

    const result = await getTool(tools, 'read').execute('call-read', {
      path: 'notes.txt',
      offset: 2,
      limit: 2,
    })

    expect(result.text).toBe('二\n三')
    expect(result.details?.truncation).toEqual({ truncated: true, nextOffset: 4 })
  })

  test('Given 非 UTF-8 文件 When read Then 返回稳定错误码', async () => {
    const { root, tools } = createFixture()
    writeFileSync(join(root, 'binary.dat'), Buffer.from([0xff, 0xfe, 0xfd]))

    await expect(getTool(tools, 'read').execute('call-read', { path: 'binary.dat' })).rejects.toMatchObject({
      code: 'coding_read_invalid_encoding',
    })
  })

  test('Given edit 的 oldText 唯一匹配 When edit Then 顺序替换并返回 patch', async () => {
    const { root, tools } = createFixture()
    writeFileSync(join(root, 'code.ts'), 'const one = 1\nconst two = 2\n')

    const result = await getTool(tools, 'edit').execute('call-edit', {
      path: 'code.ts',
      edits: [
        { oldText: 'const one = 1', newText: 'const one = 10' },
        { oldText: 'const two = 2', newText: 'const two = 20' },
      ],
    })

    expect(readFileSync(join(root, 'code.ts'), 'utf8')).toBe('const one = 10\nconst two = 20\n')
    expect(result.details?.firstChangedLine).toBe(1)
    expect(String(result.details?.patch)).toContain('-const one = 1')
    expect(String(result.details?.patch)).toContain('+const one = 10')
  })

  test('Given edit 的 oldText 多次匹配 When edit Then 不写入文件', async () => {
    const { root, tools } = createFixture()
    const original = 'same\nsame\n'
    writeFileSync(join(root, 'duplicate.txt'), original)

    await expect(getTool(tools, 'edit').execute('call-edit', {
      path: 'duplicate.txt',
      edits: [{ oldText: 'same', newText: 'changed' }],
    })).rejects.toMatchObject({ code: 'coding_edit_ambiguous' })
    expect(readFileSync(join(root, 'duplicate.txt'), 'utf8')).toBe(original)
  })

  test('Given 文件是允许根外的符号链接 When read or write Then 拒绝路径逃逸', async () => {
    const { root, tools } = createFixture()
    const outside = join(tmpdir(), `kila-outside-${Date.now()}.txt`)
    createdDirs.push(outside)
    writeFileSync(outside, 'secret')
    symlinkSync(outside, join(root, 'escape.txt'))

    await expect(getTool(tools, 'read').execute('call-read', { path: 'escape.txt' })).rejects.toMatchObject({
      code: 'coding_path_not_allowed',
    })
    await expect(getTool(tools, 'write').execute('call-write', {
      path: 'escape.txt',
      content: 'overwrite',
    })).rejects.toMatchObject({ code: 'coding_path_not_allowed' })
  })

  test('Given 绝对路径位于允许根内 When resolve Then 仍允许当前项目文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'kila-coding-policy-'))
    createdDirs.push(root)
    mkdirSync(join(root, 'src'))
    const policy = createCodingPathPolicy({ sessionId: 'test-policy', cwd: root })

    expect(policy.resolveWritePath(join(root, 'src/new.ts'))).toBe(join(root, 'src/new.ts'))
  })
})

export type DiffDisplayLineKind = 'context' | 'addition' | 'deletion' | 'header' | 'meta'

export interface DiffDisplayLine {
  kind: DiffDisplayLineKind
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function isDiffMetadata(line: string): boolean {
  return line.startsWith('diff --git ')
    || line.startsWith('index ')
    || line.startsWith('--- ')
    || line.startsWith('+++ ')
    || line.startsWith('new file mode ')
    || line.startsWith('deleted file mode ')
    || line.startsWith('similarity index ')
    || line.startsWith('rename from ')
    || line.startsWith('rename to ')
    || line.startsWith('Binary files ')
    || line.startsWith('GIT binary patch')
    || line.startsWith('\\ No newline at end of file')
}

/** 将 unified diff 转换为可逐行渲染、带双侧行号的展示模型。 */
export function parseUnifiedDiffLines(patch: string): DiffDisplayLine[] {
  const sourceLines = patch.split('\n')
  if (sourceLines.at(-1) === '') sourceLines.pop()

  const result: DiffDisplayLine[] = []
  let oldLineNumber: number | null = null
  let newLineNumber: number | null = null

  for (const line of sourceLines) {
    const hunkMatch = line.match(HUNK_HEADER_PATTERN)
    if (hunkMatch) {
      oldLineNumber = Number(hunkMatch[1])
      newLineNumber = Number(hunkMatch[3])
      result.push({ kind: 'header', content: line, oldLineNumber: null, newLineNumber: null })
      continue
    }

    if (isDiffMetadata(line) || oldLineNumber === null || newLineNumber === null) {
      result.push({ kind: 'meta', content: line, oldLineNumber: null, newLineNumber: null })
      continue
    }

    if (line.startsWith('+')) {
      result.push({
        kind: 'addition',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber,
      })
      newLineNumber += 1
      continue
    }

    if (line.startsWith('-')) {
      result.push({
        kind: 'deletion',
        content: line.slice(1),
        oldLineNumber,
        newLineNumber: null,
      })
      oldLineNumber += 1
      continue
    }

    const content = line.startsWith(' ') ? line.slice(1) : line
    result.push({
      kind: 'context',
      content,
      oldLineNumber,
      newLineNumber,
    })
    oldLineNumber += 1
    newLineNumber += 1
  }

  return result
}

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface SyncMissingSkillDirectoriesInput {
  sourceDirs: string[]
  activeDir: string
  inactiveDir?: string
  blockedSlugs?: Set<string>
}

function isDirectoryEntry(rootDir: string, entryName: string): boolean {
  try {
    return statSync(join(rootDir, entryName)).isDirectory()
  } catch {
    return false
  }
}

export function syncMissingSkillDirectories(input: SyncMissingSkillDirectoriesInput): string[] {
  const {
    sourceDirs,
    activeDir,
    inactiveDir,
    blockedSlugs = new Set<string>(),
  } = input

  if (!existsSync(activeDir)) {
    mkdirSync(activeDir, { recursive: true })
  }

  const copied: string[] = []

  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir)) continue

    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectoryEntry(sourceDir, entry.name))
      if (!isDir) continue
      if (blockedSlugs.has(entry.name)) continue

      const activeTarget = join(activeDir, entry.name)
      const inactiveTarget = inactiveDir ? join(inactiveDir, entry.name) : null

      if (existsSync(activeTarget) || (inactiveTarget && existsSync(inactiveTarget))) {
        continue
      }

      cpSync(join(sourceDir, entry.name), activeTarget, { recursive: true })
      copied.push(entry.name)
    }
  }

  return copied
}

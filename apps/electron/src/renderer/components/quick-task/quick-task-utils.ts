import type { SessionMeta } from '@kila/shared'

export interface QuickTaskProjectOption {
  path: string
  name: string
}

export function collectRecentProjects(sessions: SessionMeta[], limit = 8): QuickTaskProjectOption[] {
  const seen = new Set<string>()
  const result: QuickTaskProjectOption[] = []
  for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const project = session.project
    if (!project?.path || project.source === 'temp' || seen.has(project.path)) continue
    seen.add(project.path)
    result.push({ path: project.path, name: project.name || project.path })
    if (result.length >= limit) break
  }
  return result
}

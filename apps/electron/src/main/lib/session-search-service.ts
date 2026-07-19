import type {
  SessionSearchInput,
  SessionSearchResult,
  SessionSearchResults,
} from '@kila/shared'
import { searchSessionsWithIndex } from './session-search-index'

function parseScopedQuery(rawQuery: string): { query: string; scope?: SessionSearchResult['type'] } {
  const trimmed = rawQuery.trim()
  const match = trimmed.match(/^(session|message|project|file):\s*(.+)$/i)
  if (!match) return { query: trimmed }
  const scope = match[1]!.toLowerCase()
  return {
    query: match[2]!.trim(),
    scope: scope === 'file' ? 'project' : scope as SessionSearchResult['type'],
  }
}

export async function searchSessions(input: SessionSearchInput): Promise<SessionSearchResults> {
  const scoped = parseScopedQuery(input.query)
  const searchInput = scoped.query === input.query ? input : { ...input, query: scoped.query }
  const indexed = await searchSessionsWithIndex(searchInput)
  return scoped.scope
    ? { query: input.query, results: indexed.results.filter((result) => result.type === scoped.scope) }
    : { ...indexed, query: input.query }
}

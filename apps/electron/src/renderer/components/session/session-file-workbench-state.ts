import type { InlineFilePreviewKind } from '@kila/shared'

export type SessionWorkbenchViewMode = 'preview' | 'code'

export type SessionWorkbenchItem =
  | {
    kind: 'file'
    key: string
    path: string
  }
  | {
    kind: 'widget'
    key: string
    pinId: string
    title: string
  }

export interface SessionFileWorkbenchState {
  activeItem: SessionWorkbenchItem | null
  viewMode: SessionWorkbenchViewMode
  recentFiles: string[]
}

export const SESSION_SIDE_PANEL_WIDTH_MIN = 280
export const SESSION_SIDE_PANEL_WIDTH_MAX = 720
export const SESSION_SIDE_PANEL_WIDTH_DEFAULT = 320
export const SESSION_WORKBENCH_EXPLORER_WIDTH_MIN = 180
export const SESSION_WORKBENCH_EXPLORER_WIDTH_MAX = 420
export const SESSION_WORKBENCH_EXPLORER_WIDTH_DEFAULT = 220

export function createEmptyWorkbenchState(): SessionFileWorkbenchState {
  return {
    activeItem: null,
    viewMode: 'preview',
    recentFiles: [],
  }
}

export function clampSessionSidePanelWidth(width: number): number {
  return Math.min(SESSION_SIDE_PANEL_WIDTH_MAX, Math.max(SESSION_SIDE_PANEL_WIDTH_MIN, Math.round(width)))
}

export function clampSessionWorkbenchExplorerWidth(width: number): number {
  return Math.min(
    SESSION_WORKBENCH_EXPLORER_WIDTH_MAX,
    Math.max(SESSION_WORKBENCH_EXPLORER_WIDTH_MIN, Math.round(width)),
  )
}

export function createWorkbenchFileItem(filePath: string): SessionWorkbenchItem {
  return {
    kind: 'file',
    key: `file:${filePath}`,
    path: filePath,
  }
}

export function createWorkbenchWidgetItem(pinId: string, title: string): SessionWorkbenchItem {
  return {
    kind: 'widget',
    key: `widget:${pinId}`,
    pinId,
    title,
  }
}

export function openWorkbenchItem(
  state: SessionFileWorkbenchState,
  item: SessionWorkbenchItem,
): SessionFileWorkbenchState {
  if (state.activeItem?.key === item.key) {
    return {
      ...state,
      activeItem: item,
    }
  }

  return {
    ...state,
    activeItem: item,
    recentFiles: item.kind === 'file'
      ? [item.path, ...(state.recentFiles ?? []).filter((path) => path !== item.path)].slice(0, 5)
      : (state.recentFiles ?? []),
  }
}

export function openWorkbenchFile(
  state: SessionFileWorkbenchState,
  filePath: string,
): SessionFileWorkbenchState {
  return openWorkbenchItem(state, createWorkbenchFileItem(filePath))
}

export function openWorkbenchWidget(
  state: SessionFileWorkbenchState,
  pinId: string,
  title: string,
): SessionFileWorkbenchState {
  return openWorkbenchItem(state, createWorkbenchWidgetItem(pinId, title))
}

export function clearWorkbenchItem(
  state: SessionFileWorkbenchState,
): SessionFileWorkbenchState {
  return {
    ...state,
    activeItem: null,
  }
}

export function clearWorkbenchItemIfMatches(
  state: SessionFileWorkbenchState,
  itemKey: string,
): SessionFileWorkbenchState {
  if (state.activeItem?.key !== itemKey) {
    return state
  }

  return clearWorkbenchItem(state)
}

export function pruneWorkbenchWidgets(
  state: SessionFileWorkbenchState,
  validPinIds: Set<string>,
): SessionFileWorkbenchState {
  if (state.activeItem?.kind !== 'widget') {
    return state
  }

  return validPinIds.has(state.activeItem.pinId)
    ? state
    : clearWorkbenchItem(state)
}

export function getActiveWorkbenchItem(state: SessionFileWorkbenchState): SessionWorkbenchItem | null {
  return state.activeItem
}

export function resolveWorkbenchViewModes(kind: InlineFilePreviewKind): SessionWorkbenchViewMode[] {
  if (kind === 'markdown') return ['preview', 'code']
  if (kind === 'code' || kind === 'text') return ['code']
  return ['preview']
}

/**
 * SessionListItem - 侧边栏会话行
 *
 * 从 LeftSidebar 拆出，控制侧栏组件体积：会话行渲染、来源 badge、
 * 日期分组都是独立展示逻辑，不依赖侧栏状态机。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CheckSquare, Pencil, Pin, Square, Trash2, X } from 'lucide-react'
import type { SessionMeta } from '@kila/shared'
import { cn } from '@/lib/utils'
import { EntityMetadataChip } from '@/components/ui/entity-metadata-chip'
import { WorkspaceEntityRow } from '@/components/ui/workspace-entity-row'

/** DateGroup 直接作为 `sidebar.*` 译文 key；Translate 是 t(key) 的最小签名 */
type DateGroup = 'today' | 'yesterday' | 'earlier'
type Translate = (key: string) => string

/** 会话来源 */
export type SessionSourceKind = 'scheduled' | 'remote' | 'manual'

export function getSessionSource(session: SessionMeta, t: Translate): { kind: SessionSourceKind; label: string } {
  const { messageSource: source, messageSourceLabel: sourceLabel } = session
  if (source === 'scheduled-task') return { kind: 'scheduled', label: sourceLabel ?? t('sidebar.sourceScheduled') }
  if (source === 'im-bridge') return { kind: 'remote', label: sourceLabel ?? t('sidebar.sourceRemote') }
  return { kind: 'manual', label: t('sidebar.sourceManual') }
}

/** 按更新日期分组的会话列表 */
export function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: T[] = []
  const yesterday: T[] = []
  const earlier: T[] = []

  for (const item of items) {
    if (item.updatedAt >= todayStart) {
      today.push(item)
    } else if (item.updatedAt >= yesterdayStart) {
      yesterday.push(item)
    } else {
      earlier.push(item)
    }
  }

  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: 'today', items: today })
  if (yesterday.length > 0) groups.push({ label: 'yesterday', items: yesterday })
  if (earlier.length > 0) groups.push({ label: 'earlier', items: earlier })
  return groups
}

export interface SessionItemProps {
  session: SessionMeta
  active: boolean
  streaming: boolean
  editing: boolean
  editValue: string
  selectMode: boolean
  checked: boolean
  onToggleSelect: (sessionId: string) => void
  onSelect: (session: SessionMeta) => void
  onStartEdit: (session: SessionMeta) => void
  onEditChange: (value: string) => void
  onEditSubmit: () => void
  onEditCancel: () => void
  onTogglePin: (sessionId: string) => void
  onRequestDelete: (sessionId: string) => void
}

// React.memo：配合父组件的稳定回调，避免侧栏任一状态变化（如标题编辑逐字输入）
// 导致所有会话行重渲染——只有 props 真正变化的行才重渲染。
export const SessionItem = React.memo(function SessionItem({
  session,
  active,
  streaming,
  editing,
  editValue,
  selectMode,
  checked,
  onToggleSelect,
  onSelect,
  onStartEdit,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onTogglePin,
  onRequestDelete,
}: SessionItemProps): React.ReactElement {
  const { t } = useTranslation()
  const source = getSessionSource(session, t)
  const hasSessionBadges = streaming || source.kind !== 'manual'

  const actions = editing ? (
    <>
      <button type="button" onClick={onEditSubmit} className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label={t('common.confirm')}>
        <Check className="size-3.5" />
      </button>
      <button type="button" onClick={onEditCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label={t('common.cancel')}>
        <X className="size-3.5" />
      </button>
    </>
  ) : (
    <>
      <button type="button" onClick={() => onTogglePin(session.id)} className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label={session.pinned ? t('sidebar.unpin') : t('sidebar.pin')}>
        <Pin className={cn('size-3.5', session.pinned && 'fill-current text-primary')} />
      </button>
      <button type="button" onClick={() => onStartEdit(session)} className="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label={t('common.rename')}>
        <Pencil className="size-3.5" />
      </button>
      <button type="button" onClick={() => onRequestDelete(session.id)} className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t('common.delete')}>
        <Trash2 className="size-3.5" />
      </button>
    </>
  )

  return (
    <div data-session-id={session.id}>
      <WorkspaceEntityRow
        selected={selectMode ? checked : active}
        onClick={selectMode ? () => onToggleSelect(session.id) : (editing ? undefined : () => onSelect(session))}
        overlayActions
        compact
        tabIndex={0}
        className="sidebar-session-row pr-2"
        contentClassName="py-0.5"
        icon={selectMode
          ? (checked
              ? <CheckSquare className="size-3.5 text-primary" />
              : <Square className="size-3.5 text-muted-foreground/60" />)
          : (streaming ? <span className="size-1.5 rounded-full bg-primary" /> : undefined)}
        title={editing ? (
          <input
            value={editValue}
            onChange={(event) => onEditChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={onEditSubmit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onEditSubmit()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onEditCancel()
              }
            }}
            className="h-4 min-w-0 w-full border-b border-primary/40 bg-transparent text-[12.5px] outline-none"
            autoFocus
          />
        ) : session.title}
        metadata={hasSessionBadges ? (
          <>
            {streaming && <EntityMetadataChip tone="accent">{t('sidebar.running')}</EntityMetadataChip>}
            {source.kind !== 'manual' && (
              <EntityMetadataChip tone={source.kind === 'scheduled' ? 'warning' : 'accent'}>
                {source.label}
              </EntityMetadataChip>
            )}
          </>
        ) : undefined}
        actions={actions}
      />
    </div>
  )
})

/**
 * ToolActivityItem — 紧凑列表式工具活动展示
 *
 * 对标 craft-agents-oss TurnCard 的 ActivityRow 设计：
 * - 单行紧凑布局（24px 行高）
 * - 工具类型图标 + 语义状态切换
 * - Badge 系统（文件名 / diff 统计 / 错误）
 * - Task 子代理折叠分组 + 左边框层级
 * - CSS 动画（交错入场 / 状态切换）
 */

import * as React from 'react'
import {
  Pencil,
  FilePenLine,
  FileText,
  Terminal,
  FolderSearch,
  Search,
  GitBranch,
  Globe,
  BookOpen,
  Zap,
  ListTodo,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ChevronRight,
  MessageCircleDashed,
  Plus,
  Users,
  ImagePlus,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getStatusToneClasses } from '@/lib/theme/status-tone'
import { useAttachmentImage } from '@/hooks/use-attachment-image'
import {
  compactAdjacentToolActivities,
  extractFilePath,
  formatElapsed,
  getInputSummary,
  getRenderedToolResult,
  getToolActivityTarget,
  getToolActivityTitle,
  getToolDisplayName,
  isCompactActivityGroup,
  normalizeToolName,
  TOOL_RESULT_EXPANDED_CHARS,
  TOOL_RESULT_PREVIEW_CHARS,
  type CompactActivityGroup,
} from './tool-activity-utils'
import {
  type ToolActivity,
  type ActivityGroup,
  type ActivityStatus,
  getActivityStatus,
  groupActivities,
  isActivityGroup,
} from '@/atoms/agent-atoms'

// ===== 尺寸配置 =====

const SIZE = {
  icon: 'size-2.5',
  spinner: 'size-2',
  row: 'py-[2px]',
  staggerLimit: 10,
  autoScrollThreshold: 6,
  rowHeight: 22,
} as const

// ===== 工具图标映射 =====

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Edit: Pencil,
  Write: FilePenLine,
  Read: FileText,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  Task: GitBranch,
  WebFetch: Globe,
  WebSearch: Globe,
  NotebookEdit: BookOpen,
  Skill: Zap,
  TodoWrite: ListTodo,
  TodoRead: ListTodo,
  TaskCreate: ListTodo,
  TaskUpdate: ListTodo,
  TaskGet: ListTodo,
  TaskList: ListTodo,
  TeamCreate: Users,
  Agent: Users,
  generate_image: ImagePlus,
}

export function getToolIcon(toolName: string): React.ComponentType<{ className?: string }> {
  const normalizedToolName = normalizeToolName(toolName)
  return TOOL_ICONS[normalizedToolName] ?? Wrench
}

// ===== 状态图标 =====

export function StatusIcon({ status, toolName }: { status: ActivityStatus; toolName?: string }): React.ReactElement {
  const key = `${status}-${toolName}`

  if (status === 'running') {
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <Loader2 className={cn(SIZE.spinner, 'animate-spin text-foreground/45')} />
      </span>
    )
  }

  if (status === 'backgrounded') {
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <Circle className={cn(SIZE.icon, 'text-foreground/35')} />
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <XCircle className={cn(SIZE.icon, 'text-destructive')} />
      </span>
    )
  }

  if (status === 'completed') {
    return (
      <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center animate-in fade-in zoom-in-75 duration-200')}>
        <CheckCircle2 className={cn(SIZE.icon, getStatusToneClasses('success').icon)} />
      </span>
    )
  }

  return (
    <span key={key} className={cn(SIZE.icon, 'flex items-center justify-center')}>
      <Circle className={cn(SIZE.icon, 'text-muted-foreground/50')} />
    </span>
  )
}

// ===== Diff 统计 =====

interface DiffStats {
  additions: number
  deletions: number
}

function computeDiffStats(toolName: string, input: Record<string, unknown>): DiffStats | null {
  const normalizedToolName = normalizeToolName(toolName)
  if (normalizedToolName === 'Edit') {
    const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
    const newStr = typeof input.new_string === 'string' ? input.new_string : ''
    if (!oldStr && !newStr) return null
    const oldLines = oldStr.split('\n').length
    const newLines = newStr.split('\n').length
    return { additions: Math.max(0, newLines - oldLines + 1), deletions: Math.max(0, oldLines - newLines + 1) }
  }
  return null
}

// ===== Badge 组件 =====

function FileBadge({ path }: { path: string }): React.ReactElement {
  const filename = path.split('/').pop() ?? path
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-background text-foreground/70 leading-none">
      {filename}
    </span>
  )
}

function DiffBadges({ stats }: { stats: DiffStats }): React.ReactElement {
  return (
    <span className="shrink-0 flex items-center gap-1">
      {stats.deletions > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-destructive/5 text-destructive leading-none">
          -{stats.deletions}
        </span>
      )}
      {stats.additions > 0 && (
        <span className="rounded px-1.5 py-0.5 text-[10px] leading-none bg-[hsl(var(--status-success-soft))] text-[hsl(var(--status-success-foreground))]">
          +{stats.additions}
        </span>
      )}
    </span>
  )
}

function ErrorBadge(): React.ReactElement {
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-destructive/5 text-destructive font-medium leading-none">
      Error
    </span>
  )
}

// ===== 格式化 Input JSON =====

function formatInput(input: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('_')) filtered[key] = value
  }
  try { return JSON.stringify(filtered, null, 2) } catch { return '[不可序列化]' }
}

// ===== TodoWrite 可视化 =====

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

function parseTodoItems(input: Record<string, unknown>): TodoItem[] | null {
  if (input.todos && Array.isArray(input.todos)) {
    return (input.todos as Array<Record<string, unknown>>).map((t) => ({
      content: String(t.subject ?? t.content ?? ''),
      status: (t.status as TodoItem['status']) ?? 'pending',
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
    }))
  }
  return null
}

function TodoList({ items }: { items: TodoItem[] }): React.ReactElement {
  return (
    <div className="pl-5 space-y-0.5 border-l-2 border-muted ml-[5px]">
      {items.map((todo, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-2 text-[13px]',
            SIZE.row,
            todo.status === 'completed' && 'opacity-50',
          )}
        >
          {todo.status === 'pending' && <Circle className={cn(SIZE.icon, 'text-muted-foreground/50')} />}
          {todo.status === 'in_progress' && <Loader2 className={cn(SIZE.spinner, 'animate-spin text-foreground/45')} />}
          {todo.status === 'completed' && <CheckCircle2 className={cn(SIZE.icon, getStatusToneClasses('success').icon)} />}
          <span className={cn('truncate flex-1', todo.status === 'completed' && 'line-through')}>
            {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
          </span>
        </div>
      ))}
    </div>
  )
}

// ===== 活动行 =====

export interface ActivityRowProps {
  activity: ToolActivity
  index?: number
  animate?: boolean
  onOpenDetails?: (activity: ToolActivity) => void
}

export function ActivityRow({ activity, index = 0, animate = false, onOpenDetails }: ActivityRowProps): React.ReactElement {
  const status = getActivityStatus(activity)
  const filePath = extractFilePath(activity.input)
  const diffStats = computeDiffStats(activity.toolName, activity.input)
  const inputSummary = getInputSummary(activity.toolName, activity.input)
  const intent = activity.intent ?? activity.displayName

  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'

  const canExpand = !!onOpenDetails && activity.done && !!(activity.result || Object.keys(activity.input).length > 0)

  return (
    <div
      className={cn(
        'group/row flex items-center gap-1.5 text-[12px] rounded-md',
        SIZE.row,
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      {canExpand ? (
        <button
          type="button"
          className="group/expand shrink-0 flex items-center gap-2"
          onClick={(e) => { e.stopPropagation(); onOpenDetails(activity) }}
        >
          <span className={cn(SIZE.icon, 'relative flex items-center justify-center')}>
            <span className="transition-opacity duration-150 group-hover/expand:opacity-0">
              <StatusIcon status={status} toolName={activity.toolName} />
            </span>
            <Plus className={cn(SIZE.icon, 'absolute text-foreground/60 opacity-0 transition-opacity duration-150 group-hover/expand:opacity-100')} />
          </span>
          <span className="shrink-0 text-foreground/80 group-hover/expand:text-foreground transition-colors duration-150">{activity.toolName}</span>
        </button>
      ) : (
        <>
          <StatusIcon status={status} toolName={activity.toolName} />
          <span className="shrink-0 text-foreground/80">{activity.toolName}</span>
        </>
      )}

      {diffStats && <DiffBadges stats={diffStats} />}

      {filePath && <FileBadge path={filePath} />}

      {activity.isError && <ErrorBadge />}

      <span className="truncate flex-1 min-w-0 text-foreground/50">
        {intent && <>{intent}</>}
        {!intent && inputSummary && <>{inputSummary}</>}
        {intent && inputSummary && <> · <span className="opacity-70">{inputSummary}</span></>}
      </span>

      {activity.elapsedSeconds !== undefined && activity.elapsedSeconds > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
          {formatElapsed(activity.elapsedSeconds)}
        </span>
      )}
    </div>
  )
}

// ===== Task 分组行 =====

interface ActivityGroupRowProps {
  group: ActivityGroup
  index?: number
  animate?: boolean
  onOpenDetails?: (activity: ToolActivity) => void
  detailsId?: string | null
  onCloseDetails?: () => void
}

function ActivityGroupRow({ group, index = 0, animate = false, onOpenDetails, detailsId, onCloseDetails }: ActivityGroupRowProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true)
  const { parent, children } = group

  const derivedStatus = React.useMemo((): ActivityStatus => {
    const selfStatus = getActivityStatus(parent)
    if (selfStatus === 'completed' || selfStatus === 'error') return selfStatus
    if (children.length > 0 && children.every((c) => c.done)) {
      if (children.some((c) => c.isError)) return 'error'
      if (parent.done) return 'completed'
    }
    return selfStatus
  }, [parent, children])

  const subagentType = typeof parent.input.subagent_type === 'string'
    ? parent.input.subagent_type
    : undefined

  // 优先使用 description，回退到 prompt
  const description = typeof parent.input.description === 'string'
    ? parent.input.description
    : typeof parent.input.prompt === 'string'
      ? parent.input.prompt
      : parent.intent ?? parent.displayName ?? 'Task'

  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'

  return (
    <div
      className={cn(
        'w-full',
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-1.5 pl-1 text-left text-[12px] rounded-md hover:text-foreground transition-colors',
          SIZE.row,
        )}
      >
        <ChevronRight
          className={cn(
            'size-2.5 text-muted-foreground/60 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />

        <StatusIcon status={derivedStatus} toolName="Task" />

        {subagentType && (
          <span className="shrink-0 px-1.5 py-0.5 rounded bg-[hsl(var(--brand-soft))] text-[hsl(var(--brand-soft-foreground))] text-[9px] font-medium leading-none">
            {subagentType}
          </span>
        )}

        <span className="truncate flex-1 min-w-0 text-foreground/70">{description}</span>

        {parent.elapsedSeconds !== undefined && parent.elapsedSeconds > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
            {formatElapsed(parent.elapsedSeconds)}
          </span>
        )}

        {children.length > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
            {children.filter((c) => c.done).length}/{children.length}
          </span>
        )}
      </button>

      {expanded && children.length > 0 && (
        <div
          className={cn(
            'pl-6 pr-1 space-y-0 border-l-2 border-muted ml-[7px]',
            'animate-in fade-in slide-in-from-top-1 duration-150',
          )}
        >
          {children.map((child, ci) => (
            <React.Fragment key={child.toolUseId}>
              <ActivityRow
                activity={child}
                index={ci}
                animate={animate}
                onOpenDetails={onOpenDetails}
              />
              {detailsId === child.toolUseId && (
                <ActivityDetails activity={child} onClose={onCloseDetails ?? (() => {})} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function CompactActivityGroupRow({
  group,
  index = 0,
  animate = false,
  onOpenDetails,
  detailsId,
  onCloseDetails,
}: {
  group: CompactActivityGroup
  index?: number
  animate?: boolean
  onOpenDetails?: (activity: ToolActivity) => void
  detailsId?: string | null
  onCloseDetails?: () => void
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const Icon = getToolIcon(group.toolName)
  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'
  const targets = group.activities
    .map(getToolActivityTarget)
    .filter((target): target is string => Boolean(target))
  const preview = targets.slice(0, 3).join(' · ')
  const hiddenTargetCount = Math.max(0, targets.length - 3)

  return (
    <div
      className={cn(
        'w-full',
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-1.5 rounded-md text-left text-[12px] transition-colors hover:text-foreground',
          SIZE.row,
        )}
      >
        <ChevronRight
          className={cn(
            'size-2.5 text-muted-foreground/60 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        <StatusIcon status={group.status} toolName={group.toolName} />
        <Icon className="size-3 text-muted-foreground/55" />
        <span className="shrink-0 text-foreground/80">{getToolDisplayName(group.toolName)}</span>
        <span className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
          × {group.activities.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/50">
          {preview || '连续工具调用'}
          {hiddenTargetCount > 0 && <span className="opacity-70"> · 另 {hiddenTargetCount} 项</span>}
        </span>
        {group.elapsedSeconds !== undefined && group.elapsedSeconds > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
            {formatElapsed(group.elapsedSeconds)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="ml-[7px] border-l-2 border-muted pl-6 pr-1 animate-in fade-in slide-in-from-top-1 duration-150">
          {group.activities.map((activity, activityIndex) => (
            <React.Fragment key={activity.toolUseId}>
              <ActivityRow
                activity={activity}
                index={activityIndex}
                animate={animate}
                onOpenDetails={onOpenDetails}
              />
              {detailsId === activity.toolUseId && (
                <ActivityDetails activity={activity} onClose={onCloseDetails ?? (() => {})} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 工具结果图片 =====

function ToolResultImage({ attachment }: { attachment: { localPath: string; filename: string; mediaType: string } }): React.ReactElement {
  const { imageSrc, loadState, retry, markError } = useAttachmentImage(
    attachment.localPath,
    attachment.mediaType,
  )

  const handleSave = React.useCallback((): void => {
    void window.electronAPI.saveImageAs(attachment.localPath, attachment.filename).catch((error) => {
      console.error('[ToolResultImage] 保存附件失败:', error)
    })
  }, [attachment.localPath, attachment.filename])

  if (loadState === 'loading') {
    return (
      <div
        className="size-[120px] rounded-md bg-muted/30 animate-pulse"
        role="status"
        aria-label={`正在加载 ${attachment.filename}`}
      />
    )
  }

  if (loadState === 'error' || !imageSrc) {
    return (
      <div className="flex size-[160px] flex-col items-center justify-center gap-2 rounded-md bg-destructive/5 px-3 text-center text-destructive/75">
        <XCircle className="size-5" />
        <span className="line-clamp-2 text-[11px]">图片加载失败：{attachment.filename}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={retry}
            className="rounded-md bg-background/70 px-2 py-1 text-[10px] text-foreground/70 hover:text-foreground"
          >
            重试
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-background/70 px-2 py-1 text-[10px] text-foreground/70 hover:text-foreground"
          >
            另存为
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={attachment.filename}
        className="max-w-[240px] max-h-[240px] rounded-md object-cover"
        onError={markError}
      />
      <button
        type="button"
        onClick={handleSave}
        className="absolute bottom-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-black/70"
        aria-label="保存图片"
        title="保存图片"
      >
        <Download className="size-3.5" />
      </button>
    </div>
  )
}

// ===== 详情面板 =====

function ActivityDetails({ activity, onClose }: { activity: ToolActivity; onClose: () => void }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)
  const [showFullResult, setShowFullResult] = React.useState(false)
  const renderedResult = activity.result ?? activity.partialResult
  const visibleResult = renderedResult ? getRenderedToolResult(renderedResult, showFullResult) : null
  const hasInput = Object.keys(activity.input).length > 0

  const handleCopy = (): void => {
    const parts: string[] = [`[${activity.toolName}]`]
    if (hasInput) {
      parts.push('输入:\n' + formatInput(activity.input))
    }
    if (renderedResult) {
      parts.push('结果:\n' + renderedResult)
    }
    void navigator.clipboard.writeText(parts.join('\n\n')).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }).catch((error) => {
      console.error('[ToolActivityDetails] 复制失败:', error)
    })
  }

  return (
    <div className="mt-1 overflow-hidden rounded-lg bg-[hsl(var(--workspace))]/68 px-3 py-2.5 animate-in fade-in slide-in-from-top-2 duration-300 ease-out">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/40">
            {activity.toolName}
          </div>
          <div className="mt-0.5 text-[11px] text-foreground/44">
            {activity.isError ? '执行结果异常' : '工具详情'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-full px-2 py-1 text-[11px] text-foreground/42 transition-colors hover:bg-background/50 hover:text-foreground"
          >
            {copied ? '已复制' : '复制完整内容'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-[11px] text-foreground/42 transition-colors hover:bg-background/50 hover:text-foreground"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-2 max-h-[300px] overflow-y-auto">
        {hasInput && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-foreground/34">输入</div>
            <pre className="rounded-md bg-background/30 p-2 text-[11px] leading-5 text-foreground/66 overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all">
              {formatInput(activity.input)}
            </pre>
          </div>
        )}
        {renderedResult && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-foreground/34">结果</div>
              {activity.isError && <span className="text-[10px] font-medium text-destructive/70">错误</span>}
            </div>
            <pre
              className={cn(
                'rounded-md p-2 text-[11px] leading-5 overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all',
                activity.isError ? 'bg-destructive/5 text-destructive/80' : 'bg-background/30 text-foreground/66',
              )}
            >
              {visibleResult?.text}
            </pre>
            {renderedResult.length > TOOL_RESULT_PREVIEW_CHARS && (
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                onClick={() => setShowFullResult((value) => !value)}
              >
                {showFullResult
                  ? '收起结果'
                  : `展开结果（${renderedResult.length.toLocaleString('zh-CN')} 字符${renderedResult.length > TOOL_RESULT_EXPANDED_CHARS ? '，界面最多显示 100,000 字符' : ''}）`}
              </button>
            )}
          </div>
        )}
        {activity.imageAttachments && activity.imageAttachments.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-foreground/34">生成图片</div>
            <div className="flex flex-wrap gap-2">
              {activity.imageAttachments.map((img, i) => (
                <ToolResultImage key={i} attachment={img} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 中间思考行 =====

function IntermediateRow({ text, index, animate }: { text: string; index: number; animate: boolean }): React.ReactElement {
  const delay = animate && index < SIZE.staggerLimit ? `${index * 30}ms` : '0ms'
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[13px] text-foreground/50',
        SIZE.row,
        animate && 'animate-in fade-in slide-in-from-left-2 duration-200 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <MessageCircleDashed className={cn(SIZE.icon, 'text-muted-foreground/50')} />
      <span className="truncate flex-1">{text}</span>
    </div>
  )
}

// ===== 主导出：活动列表 =====

interface ToolActivityListProps {
  activities: ToolActivity[]
  animate?: boolean
}

export function ToolActivityList({ activities, animate = false }: ToolActivityListProps): React.ReactElement | null {
  const [detailsId, setDetailsId] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  const grouped = React.useMemo(
    () => compactAdjacentToolActivities(groupActivities(activities)),
    [activities],
  )

  const visibleRows = React.useMemo(() => {
    let count = 0
    for (const item of grouped) {
      count += 1
      if (isCompactActivityGroup(item)) {
        count += item.activities.length
      } else if (isActivityGroup(item)) {
        count += item.children.length
      }
    }
    return count
  }, [grouped])

  const needsCollapse = visibleRows > SIZE.autoScrollThreshold

  // 流式模式：自动滚动到底部
  React.useEffect(() => {
    if (animate && listRef.current && needsCollapse) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [visibleRows, needsCollapse, animate])

  if (activities.length === 0) return null

  const detailActivity = detailsId ? activities.find((a) => a.toolUseId === detailsId) : null

  const handleOpenDetails = (activity: ToolActivity): void => {
    setDetailsId((prev) => (prev === activity.toolUseId ? null : activity.toolUseId))
  }

  // 流式：固定高度 + 自动滚动
  // 已完成未展开：固定高度 + overflow-hidden（无滚动条）
  // 已完成已展开：无高度限制
  const isCollapsed = !animate && needsCollapse && !expanded

  return (
    <div className="w-full">
      <div
        ref={listRef}
        className={cn(
          'space-y-0',
          animate && needsCollapse && 'overflow-y-auto',
          isCollapsed && 'overflow-hidden',
        )}
        style={
          animate && needsCollapse
            ? { maxHeight: SIZE.autoScrollThreshold * SIZE.rowHeight }
            : isCollapsed
              ? { maxHeight: SIZE.autoScrollThreshold * SIZE.rowHeight }
              : undefined
        }
      >
      {grouped.map((item, i) => {
        if (isCompactActivityGroup(item)) {
          return (
            <CompactActivityGroupRow
              key={item.key}
              group={item}
              index={i}
              animate={animate}
              onOpenDetails={handleOpenDetails}
              detailsId={detailsId}
              onCloseDetails={() => setDetailsId(null)}
            />
          )
        }

        if (isActivityGroup(item)) {
          return (
            <ActivityGroupRow
              key={item.parent.toolUseId}
              group={item}
              index={i}
              animate={animate}
              onOpenDetails={handleOpenDetails}
              detailsId={detailsId}
              onCloseDetails={() => setDetailsId(null)}
            />
          )
        }

        const activity = item as ToolActivity

        // TodoWrite / TaskCreate 特殊渲染
        if (normalizeToolName(activity.toolName) === 'TodoWrite' || normalizeToolName(activity.toolName) === 'TaskCreate') {
          const todos = parseTodoItems(activity.input)
          if (todos && todos.length > 0) {
            return (
              <React.Fragment key={activity.toolUseId}>
                <ActivityRow
                  activity={activity}
                  index={i}
                  animate={animate}
                  // 不传递 onOpenDetails，TodoWrite/TaskCreate 不支持点击展开详情
                  // 因为它们已经有专属的 TodoList 展示
                />
                <TodoList items={todos} />
              </React.Fragment>
            )
          }
        }

        return (
          <React.Fragment key={activity.toolUseId}>
            <ActivityRow
              activity={activity}
              index={i}
              animate={animate}
              onOpenDetails={handleOpenDetails}
            />
            {detailsId === activity.toolUseId && detailActivity && (
              <ActivityDetails activity={detailActivity} onClose={() => setDetailsId(null)} />
            )}
          </React.Fragment>
        )
      })}
      </div>

      {/* 已完成消息：折叠/展开按钮 */}
      {!animate && needsCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[11px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          {expanded ? '收起工具活动' : `展开全部 ${visibleRows} 项工具活动`}
        </button>
      )}
    </div>
  )
}

// 保留单项导出（向后兼容 AgentMessages 中的旧引用）
export function ToolActivityItem({ activity }: { activity: ToolActivity }): React.ReactElement {
  return <ToolActivityList activities={[activity]} />
}

export { formatElapsed, getInputSummary, getToolActivityTarget, getToolActivityTitle, getToolDisplayName, normalizeToolName } from './tool-activity-utils'

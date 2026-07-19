import * as React from 'react'
import {
  RotateCcw,
  FolderOpen,
  Brain,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Pencil,
  FileText,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  PersonalityDocKind,
  PersonalityDocument,
  PersonalityState,
  CustomSystemPrompt,
  SystemPromptState,
} from '@kila/shared'
import { systemPromptStateAtom } from '@/atoms/system-prompt-atoms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { SettingsCard, SettingsSection } from './primitives'
import { cn } from '@/lib/utils'
import { useAtom } from 'jotai'

const SAVE_DEBOUNCE_MS = 500

interface PersonalityDocumentMeta {
  title: string
  description: string
}

const PERSONALITY_DOC_META: Record<PersonalityDocKind, PersonalityDocumentMeta> = {
  soul: {
    title: '[SOUL] 助手人格',
    description: '定义 Kila 的身份、语气、工作方式与边界。',
  },
  user: {
    title: '[USER] 用户画像',
    description: '记录用户长期稳定的偏好、习惯与工作方式。',
  },
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function formatDateTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—'
  return new Date(timestamp).toLocaleString()
}

// ===== 自定义 System Prompt 管理区 =====

function SystemPromptManager(): React.ReactElement {
  const [state, setState] = useAtom(systemPromptStateAtom)
  const [loading, setLoading] = React.useState(true)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)

  // 新建/编辑表单
  const [formName, setFormName] = React.useState('')
  const [formContent, setFormContent] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const loadState = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.electronAPI.getSystemPromptState()
      setState(next)
    } catch (error) {
      console.error('[Prompt 管理] 加载失败:', error)
      toast.error('加载自定义提示词失败')
    } finally {
      setLoading(false)
    }
  }, [setState])

  React.useEffect(() => {
    void loadState()
  }, [loadState])

  const activePrompt = React.useMemo(() => {
    if (!state.activePromptId) return null
    return state.prompts.find((p) => p.id === state.activePromptId) ?? null
  }, [state])

  const handleStartCreate = React.useCallback(() => {
    setEditingId(null)
    setIsCreating(true)
    setFormName('')
    setFormContent('')
  }, [])

  const handleStartEdit = React.useCallback((prompt: CustomSystemPrompt) => {
    setIsCreating(false)
    setEditingId(prompt.id)
    setFormName(prompt.name)
    setFormContent(prompt.content)
  }, [])

  const handleCancelForm = React.useCallback(() => {
    setIsCreating(false)
    setEditingId(null)
    setFormName('')
    setFormContent('')
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!formName.trim()) {
      toast.error('请输入提示词名称')
      return
    }

    setSaving(true)
    try {
      if (isCreating) {
        const created = await window.electronAPI.addSystemPrompt({
          name: formName.trim(),
          content: formContent,
        })
        // 新建后自动激活
        const newState = await window.electronAPI.setActiveSystemPrompt(created.id)
        setState(newState)
        toast.success(`已创建并激活「${created.name}」`)
      } else if (editingId) {
        const updated = await window.electronAPI.updateSystemPrompt({
          id: editingId,
          name: formName.trim(),
          content: formContent,
        })
        setState((prev) => ({
          ...prev,
          prompts: prev.prompts.map((p) => (p.id === updated.id ? updated : p)),
        }))
        toast.success(`已更新「${updated.name}」`)
      }
      handleCancelForm()
    } catch (error) {
      console.error('[Prompt 管理] 保存失败:', error)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [formName, formContent, isCreating, editingId, handleCancelForm, setState])

  const handleDelete = React.useCallback(
    async (id: string) => {
      const prompt = state.prompts.find((p) => p.id === id)
      if (!prompt) return
      if (!confirm(`确定删除「${prompt.name}」吗？`)) return

      try {
        await window.electronAPI.deleteSystemPrompt(id)
        setState((prev) => ({
          prompts: prev.prompts.filter((p) => p.id !== id),
          activePromptId: prev.activePromptId === id ? null : prev.activePromptId,
        }))
        if (editingId === id) handleCancelForm()
        toast.success(`已删除「${prompt.name}」`)
      } catch (error) {
        console.error('[Prompt 管理] 删除失败:', error)
        toast.error('删除失败')
      }
    },
    [state.prompts, editingId, handleCancelForm, setState],
  )

  const handleSetActive = React.useCallback(
    async (id: string) => {
      try {
        const newState = await window.electronAPI.setActiveSystemPrompt(id)
        setState(newState)
        const prompt = newState.prompts.find((p) => p.id === id)
        toast.success(`已激活「${prompt?.name ?? id}」`)
      } catch (error) {
        console.error('[Prompt 管理] 激活失败:', error)
        toast.error('激活失败')
      }
    },
    [setState],
  )

  const handleClearActive = React.useCallback(async () => {
    try {
      const newState = await window.electronAPI.clearActiveSystemPrompt()
      setState(newState)
      toast.success('已切换回默认模式')
    } catch (error) {
      console.error('[Prompt 管理] 取消激活失败:', error)
      toast.error('取消激活失败')
    }
  }, [setState])

  const isFormOpen = isCreating || editingId !== null

  if (loading) {
    return (
      <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
        正在加载提示词配置...
      </SettingsCard>
    )
  }

  return (
    <div className="space-y-4">
      {/* 当前状态 */}
      <SettingsCard divided={false} className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">当前模式：</span>
            {activePrompt ? (
              <Badge variant="secondary" className="font-medium">
                {activePrompt.name}
              </Badge>
            ) : (
              <Badge variant="outline">默认</Badge>
            )}
          </div>
          {activePrompt && (
            <Button variant="outline" size="sm" onClick={() => void handleClearActive()}>
              <X className="mr-1 size-3.5" />
              <span>切回默认</span>
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {activePrompt
            ? '自定义提示词已激活。SOUL.md 和 USER.md 仍会生效，默认的「输出与执行约束」被替换为你自定义的内容。'
            : '使用 Kila 默认的输出与行为约束。你可以创建自定义提示词来替代。'}
        </p>
      </SettingsCard>

      {/* Prompt 列表 */}
      {state.prompts.length > 0 && (
        <SettingsCard divided={false} className="divide-y divide-border">
          {state.prompts.map((prompt) => (
            <div
              key={prompt.id}
              className={cn(
                'group flex items-center gap-3 px-4 py-3 transition-colors',
                state.activePromptId === prompt.id && 'bg-muted/30',
              )}
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{prompt.name}</span>
                  {state.activePromptId === prompt.id && (
                    <Check className="size-3.5 text-green-600 shrink-0" />
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground truncate">
                  {prompt.content.slice(0, 100) || '（空）'}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {state.activePromptId !== prompt.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="激活此提示词"
                    onClick={() => void handleSetActive(prompt.id)}
                  >
                    <Check className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title="编辑"
                  onClick={() => handleStartEdit(prompt)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  title="删除"
                  onClick={() => void handleDelete(prompt.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </SettingsCard>
      )}

      {/* 新建按钮（未展开表单时显示） */}
      {!isFormOpen && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleStartCreate}
        >
          <Plus className="mr-1 size-4" />
          <span>新建提示词</span>
        </Button>
      )}

      {/* 编辑/新建表单 */}
      {isFormOpen && (
        <SettingsCard divided={false} className="p-4 space-y-3">
          <div className="text-sm font-medium">
            {isCreating ? '新建提示词' : '编辑提示词'}
          </div>
          <div className="space-y-2">
            <Input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="提示词名称"
              className="text-sm"
            />
          </div>
          <Textarea
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="输入自定义提示词内容。激活后将替代默认的输出与执行约束，SOUL.md 和 USER.md 仍然生效。"
            className="min-h-[200px] resize-y font-mono text-[13px] leading-6"
            spellCheck={false}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelForm}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={saving || !formName.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </SettingsCard>
      )}
    </div>
  )
}

// ===== Personality 文档编辑器（SOUL.md / USER.md） =====

function upsertMarkdownSection(document: string, heading: string, content: string): string {
  const trimmedHeading = heading.trim()
  const trimmedContent = content.trim()
  if (!trimmedHeading || !trimmedContent) {
    return document
  }

  const normalized = document.endsWith('\n') ? document : `${document}\n`
  const lines = normalized.split('\n')
  const headingLc = trimmedHeading.toLowerCase()
  const levelMatch = trimmedHeading.match(/^(#{1,6})\s/)
  const targetLevel = levelMatch ? levelMatch[1]!.length : 2

  let startIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.trim().toLowerCase() === headingLc) {
      startIndex = index
      break
    }
  }

  if (startIndex < 0) {
    return `${normalized.trimEnd()}\n\n${trimmedHeading}\n${trimmedContent}\n`
  }

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^(#{1,6})\s/)
    if (match && match[1]!.length <= targetLevel) {
      endIndex = index
      break
    }
  }

  return [
    ...lines.slice(0, startIndex),
    lines[startIndex]!,
    trimmedContent,
    ...lines.slice(endIndex),
  ].join('\n').replace(/\n+$/, '\n')
}

interface PersonalityDocumentEditorProps {
  document: PersonalityDocument
  meta: PersonalityDocumentMeta
  onDocumentSaved: (document: PersonalityDocument) => void
}

function PersonalityDocumentEditor({
  document,
  meta,
  onDocumentSaved,
}: PersonalityDocumentEditorProps): React.ReactElement {
  const [draft, setDraft] = React.useState(document.content)
  const [saveState, setSaveState] = React.useState<SaveState>('idle')

  React.useEffect(() => {
    setDraft(document.content)
    setSaveState('idle')
  }, [document.content, document.path])

  React.useEffect(() => {
    if (saveState !== 'saved') {
      return
    }

    const timer = window.setTimeout(() => {
      setSaveState((prev) => (prev === 'saved' ? 'idle' : prev))
    }, 1600)

    return () => window.clearTimeout(timer)
  }, [saveState])

  React.useEffect(() => {
    if (draft === document.content) {
      return
    }

    setSaveState('saving')

    const timer = window.setTimeout(() => {
      void window.electronAPI.updatePersonality({
        kind: document.kind,
        content: draft,
      }).then((updated) => {
        onDocumentSaved(updated)
        setSaveState('saved')
      }).catch((error) => {
        console.error(`[个性设置] 保存 ${document.kind} 失败:`, error)
        setSaveState('error')
        toast.error(`保存 ${meta.title} 失败`)
      })
    }, SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [document.content, document.kind, draft, meta.title, onDocumentSaved])

  const handleReset = React.useCallback(async () => {
    if (!confirm(`确定恢复 ${meta.title} 的默认模板吗？当前内容会被覆盖。`)) {
      return
    }

    try {
      const updated = await window.electronAPI.resetPersonality(document.kind)
      onDocumentSaved(updated)
      setDraft(updated.content)
      setSaveState('saved')
      toast.success(`${meta.title} 已恢复默认`)
    } catch (error) {
      console.error(`[个性设置] 重置 ${document.kind} 失败:`, error)
      setSaveState('error')
      toast.error(`重置 ${meta.title} 失败`)
    }
  }, [document.kind, meta.title, onDocumentSaved])

  const handleOpenPath = React.useCallback(async () => {
    try {
      await window.electronAPI.openPersonalityPath(document.kind)
    } catch (error) {
      console.error(`[个性设置] 打开 ${document.kind} 路径失败:`, error)
      toast.error(`打开 ${meta.title} 路径失败`)
    }
  }, [document.kind, meta.title])

  return (
    <SettingsSection
      title={meta.title}
      description={meta.description}
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenPath}>
            <FolderOpen className="mr-1 size-4" />
            <span>在 Finder 中打开</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1 size-4" />
            <span>恢复默认</span>
          </Button>
        </div>
      }
    >
      <SettingsCard divided={false} className="p-4 space-y-3">
        <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">路径</div>
          <div className="mt-1 break-all font-mono text-[12px] leading-5 text-foreground/80">
            {document.path}
          </div>
        </div>

        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[320px] resize-y font-mono text-[13px] leading-6"
          spellCheck={false}
        />

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">修改后下一条消息生效</span>
          <span className={saveState === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
            {saveState === 'saving' && '正在保存...'}
            {saveState === 'saved' && '已保存'}
            {saveState === 'error' && '保存失败'}
          </span>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

// ===== 主组件 =====

export function PersonalitySettings(): React.ReactElement {
  const [state, setState] = React.useState<PersonalityState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [impression, setImpression] = React.useState<{ content?: string; updatedAt?: number } | null>(null)
  const [impressionLoading, setImpressionLoading] = React.useState(true)
  const [applyingImpression, setApplyingImpression] = React.useState(false)

  const loadState = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.electronAPI.getPersonalityState()
      setState(next)
    } catch (error) {
      console.error('[个性设置] 加载失败:', error)
      toast.error('加载个性配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadState()
  }, [loadState])

  const loadImpression = React.useCallback(async () => {
    setImpressionLoading(true)
    try {
      const next = await window.electronAPI.getMemoryImpression()
      setImpression(next)
    } catch (error) {
      console.error('[个性设置] 加载记忆画像失败:', error)
    } finally {
      setImpressionLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadImpression()
  }, [loadImpression])

  const handleDocumentSaved = React.useCallback((document: PersonalityDocument) => {
    setState((prev) => {
      if (!prev) return prev
      return document.kind === 'soul'
        ? { ...prev, soul: document }
        : { ...prev, user: document }
    })
  }, [])

  const handleApplyImpressionToUser = React.useCallback(async () => {
    const content = impression?.content?.trim()
    if (!state || !content) {
      return
    }

    setApplyingImpression(true)
    try {
      const nextContent = upsertMarkdownSection(
        state.user.content,
        '## Memory Impression',
        content,
      )
      const updated = await window.electronAPI.updatePersonality({
        kind: 'user',
        content: nextContent,
      })
      handleDocumentSaved(updated)
      toast.success('已把记忆画像写入 [USER] 用户画像')
    } catch (error) {
      console.error('[个性设置] 写入记忆画像失败:', error)
      toast.error('写入 [USER] 用户画像失败')
    } finally {
      setApplyingImpression(false)
    }
  }, [handleDocumentSaved, impression?.content, state])

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsSection
          title="个性"
          description="全局 personality 文件会在下一条消息进入 Agent static system prompt。"
        >
          <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
            正在加载个性文件...
          </SettingsCard>
        </SettingsSection>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="space-y-6">
        <SettingsSection title="个性" description="当前无法加载全局 personality 文件。">
          <SettingsCard divided={false} className="p-6 text-sm text-muted-foreground">
            请稍后重试。
          </SettingsCard>
        </SettingsSection>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* 自定义 System Prompt 管理 */}
      <SettingsSection
        title="自定义提示词"
        description="创建和管理自定义系统提示词。全局激活后替代默认的「输出与执行约束」，也可在对话工具栏中为单个会话覆盖。SOUL.md 和 USER.md 仍然生效。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadState()}
          >
            <RotateCcw className="mr-1 size-4" />
            <span>刷新</span>
          </Button>
        }
      >
        <SystemPromptManager />
      </SettingsSection>

      {/* 人格说明 */}
      <SettingsSection
        title="人格文件"
        description="全局 personality 文件会在下一条消息进入 Agent static system prompt。"
      >
        <SettingsCard divided={false} className="p-4 space-y-2 text-sm text-muted-foreground">
          <p>- personality 为全局设置，不区分会话或项目</p>
          <p>- 文件系统是唯一真相源，Renderer 不再持久化 prompt 内容</p>
          {state.legacyPromptArchivePath && (
            <p> - 旧 Prompt 配置已归档：{state.legacyPromptArchivePath}</p>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* SOUL.md 编辑器 */}
      <PersonalityDocumentEditor
        document={state.soul}
        meta={PERSONALITY_DOC_META.soul}
        onDocumentSaved={handleDocumentSaved}
      />

      {/* 记忆画像建议 */}
      <SettingsSection
        title="记忆画像建议"
        description="这里显示记忆系统沉淀出的全局用户画像摘要。需要时可一键写入 `[USER] 用户画像`。"
        action={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadImpression()} disabled={impressionLoading}>
              <Brain className="mr-1 size-4" />
              <span>{impressionLoading ? '刷新中…' : '刷新画像'}</span>
            </Button>
            <Button
              size="sm"
              onClick={() => void handleApplyImpressionToUser()}
              disabled={applyingImpression || !impression?.content?.trim()}
            >
              <Sparkles className="mr-1 size-4" />
              <span>{applyingImpression ? '写入中…' : '写入 [USER]'}</span>
            </Button>
          </div>
        )}
      >
        <SettingsCard divided={false} className="p-4 space-y-3">
          <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
            <div className="text-xs font-medium text-muted-foreground">最近更新时间</div>
            <div className="mt-1 text-sm text-foreground/80">
              {formatDateTime(impression?.updatedAt)}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
            {impressionLoading
              ? (
                <div className="text-sm text-muted-foreground">正在加载记忆画像...</div>
              )
              : impression?.content?.trim()
                ? (
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground font-sans">
                    {impression.content}
                  </pre>
                )
                : (
                  <div className="text-sm text-muted-foreground">
                    当前还没有可用的记忆画像摘要。先让记忆系统运行一段时间再回来查看。
                  </div>
                )}
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* USER.md 编辑器 */}
      <PersonalityDocumentEditor
        document={state.user}
        meta={PERSONALITY_DOC_META.user}
        onDocumentSaved={handleDocumentSaved}
      />
    </div>
  )
}

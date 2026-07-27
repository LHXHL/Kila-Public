import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { FileDialogResult } from '@kila/shared'
import { Paperclip, FolderOpen, Play, X, Zap } from 'lucide-react'
import { collectRecentProjects, type QuickTaskProjectOption } from './quick-task-utils'

export function QuickTaskApp(): React.ReactElement {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const [prompt, setPrompt] = React.useState('')
  const [projects, setProjects] = React.useState<QuickTaskProjectOption[]>([])
  const [projectPath, setProjectPath] = React.useState('')
  const [files, setFiles] = React.useState<FileDialogResult['files']>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const focusInput = React.useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  React.useEffect(() => {
    void window.electronAPI.listSessions()
      .then((sessions) => setProjects(collectRecentProjects(sessions)))
      .catch(() => {})
    focusInput()
    return window.electronAPI.onQuickTaskFocus(focusInput)
  }, [focusInput])

  const submit = React.useCallback(async () => {
    if (!prompt.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await window.electronAPI.submitQuickTask({
        prompt,
        projectPath: projectPath || undefined,
        attachments: files,
      })
      setPrompt('')
      setFiles([])
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      focusInput()
    } finally {
      setSubmitting(false)
    }
  }, [files, focusInput, projectPath, prompt, submitting])

  const chooseFiles = async (): Promise<void> => {
    const result = await window.electronAPI.pickQuickTaskFiles()
    setFiles((current) => [...current, ...result.files].slice(0, 20))
    focusInput()
  }

  const chooseProject = async (): Promise<void> => {
    const selected = await window.electronAPI.pickQuickTaskProject()
    if (!selected) return
    setProjects((current) => [selected, ...current.filter((item) => item.path !== selected.path)])
    setProjectPath(selected.path)
    focusInput()
  }

  return (
    <main className="h-screen bg-transparent p-2 text-foreground">
      <section className="flex h-full flex-col overflow-hidden rounded-2xl bg-background/95 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:ring-white/10">
        <header className="flex h-12 shrink-0 items-center justify-between px-4 [-webkit-app-region:drag]">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Zap className="size-4" />
            </span>
            {t('shell.quickTask.title')}
            <span className="text-xs font-normal text-muted-foreground">⌘⇧Space</span>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [-webkit-app-region:no-drag]"
            onClick={() => void window.electronAPI.hideQuickTask()}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                void window.electronAPI.hideQuickTask()
              } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={t('shell.quickTask.placeholder')}
            className="min-h-0 flex-1 resize-none bg-transparent px-1 py-3 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
          />

          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((file, index) => (
                <button
                  key={`${file.filename}-${index}`}
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  className="max-w-48 truncate rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  title={t('shell.quickTask.clickToRemove')}
                >
                  {file.filename} ×
                </button>
              ))}
            </div>
          )}

          {error && <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <footer className="flex items-center gap-2 border-t border-border/50 pt-3">
            <select
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              className="h-9 min-w-0 max-w-56 rounded-lg bg-muted px-2.5 text-xs outline-none"
              title={t('shell.quickTask.selectProject')}
            >
              <option value="">{t('shell.quickTask.tempProject')}</option>
              {projects.map((project) => <option key={project.path} value={project.path}>{project.name}</option>)}
            </select>
            <button type="button" onClick={() => void chooseProject()} className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground" title={t('shell.quickTask.browseProject')}>
              <FolderOpen className="size-4" />
            </button>
            <button type="button" onClick={() => void chooseFiles()} className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:text-foreground" title={t('composer.attachFile')}>
              <Paperclip className="size-4" />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={!prompt.trim() || submitting}
              onClick={() => void submit()}
              className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
            >
              <Play className="size-3.5 fill-current" />
              {submitting ? t('shell.quickTask.running') : t('shell.quickTask.run')}
            </button>
          </footer>
        </div>
      </section>
    </main>
  )
}

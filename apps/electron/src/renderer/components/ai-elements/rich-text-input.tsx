/**
 * AI Elements - TipTap 富文本输入组件
 *
 * 独立受控组件，不依赖 PromptInput Provider。
 *
 * 功能：
 * - StarterKit + Placeholder + Underline + Link + CodeBlockLowlight
 * - 可选 Mention 扩展（@ 引用文件、/ 触发 Skill、# 触发 MCP）
 * - HTML → plain text 序列化
 * - IME composition 处理
 * - Enter 提交 / Shift+Enter 换行
 * - 代码块内 Enter 换行例外
 * - 自动扩高
 */

import { forwardRef, useState, useEffect, useRef, useMemo, useCallback, useImperativeHandle } from 'react'
import type { JSONContent } from '@tiptap/core'
import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Mention from '@tiptap/extension-mention'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { common, createLowlight } from 'lowlight'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { createFileMentionSuggestion } from '@/components/file-browser/file-mention-suggestion'
import { createSkillMentionSuggestion, createMcpMentionSuggestion } from '@/components/agent/mention-suggestions'
import { useElementWidth } from '@/hooks/use-element-width'
import { getElementFontSpec } from '@/lib/pretext/font-spec'
import { normalizeMeasurementText } from '@/lib/pretext/measurement-text'
import { measurePreWrapText } from '@/lib/pretext/text-layout'
import { PredictiveCaretOverlay } from './PredictiveCaretOverlay'
import { htmlToPlainText, plainTextToDocument } from './rich-text-input-plain-text'
import { RichLinkNode } from './rich-link-node'
import { usePredictiveCaret } from './use-predictive-caret'

// 创建 lowlight 实例，使用常见语言
const lowlight = createLowlight(common)

// ===== 行数计算 =====

function fallbackLineCount(text: string): number {
  if (!text) return 0

  return text.split('\n').reduce((sum, line) => {
    if (!line) return sum + 1
    return sum + Math.max(1, Math.ceil(line.length / 40))
  }, 0)
}

// ===== 组件接口 =====

interface RichTextInputProps {
  /** 当前值（plain text） */
  value: string
  /** 值变更回调 */
  onChange: (value: string) => void
  /** 提交回调（Enter 键） */
  onSubmit: () => void
  /** 粘贴文件回调（拦截粘贴的文件） */
  onPasteFiles?: (files: File[]) => void
  /** 占位文字 */
  placeholder?: string
  /** 是否显示建议样式（斜体占位符） */
  suggestionActive?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 自动聚焦触发器（当此值变化时自动聚焦，通常传入session ID） */
  autoFocusTrigger?: string | null
  /** 是否支持手动折叠（内容较长时显示折叠按钮） */
  collapsible?: boolean
  /** 工作区根路径（启用 @ 引用文件功能时需要） */
  workspacePath?: string | null
  /** 会话 ID（启用 / Skill 和 # MCP 功能时需要） */
  capabilitySessionId?: string | null
  /** 附加目录路径列表（@ 引用时一并搜索） */
  attachedDirs?: string[]
  className?: string
}

export interface RichTextInputHandle {
  focus: () => void
  insertSkillMention: (item: { id: string; label: string }) => void
}

function getDocCharBefore(editor: TiptapEditor, position: number): string {
  if (position <= 0) return ''
  return editor.state.doc.textBetween(Math.max(position - 1, 0), position, '\n', '\n')
}

function getDocCharAfter(editor: TiptapEditor, position: number): string {
  const endPosition = editor.state.doc.content.size
  if (position >= endPosition) return ''
  return editor.state.doc.textBetween(position, Math.min(position + 1, endPosition), '\n', '\n')
}

function isWhitespace(char: string): boolean {
  return char === '' || /\s/.test(char)
}

function resolveSkillMentionInsertRange(editor: TiptapEditor): { from: number; to: number; focusPosition: number } {
  const endPosition = editor.state.doc.content.size
  if (!editor.isFocused) {
    return { from: endPosition, to: endPosition, focusPosition: endPosition }
  }

  const { selection } = editor.state
  return {
    from: selection.from,
    to: selection.to,
    focusPosition: selection.to,
  }
}

function buildSkillMentionContent(
  item: { id: string; label: string },
  options: { needsLeadingSpace: boolean; needsTrailingSpace: boolean },
): JSONContent[] {
  const content: JSONContent[] = []
  if (options.needsLeadingSpace) {
    content.push({ type: 'text', text: ' ' })
  }
  content.push({
    type: 'mention',
    attrs: {
      id: item.id,
      label: item.label,
      mentionSuggestionChar: '/',
    },
  })
  if (options.needsTrailingSpace) {
    content.push({ type: 'text', text: ' ' })
  }
  return content
}

function getSkillMentionSpacing(editor: TiptapEditor, from: number, to: number): {
  needsLeadingSpace: boolean
  needsTrailingSpace: boolean
} {
  const previousChar = getDocCharBefore(editor, from)
  const nextChar = getDocCharAfter(editor, to)
  return {
    needsLeadingSpace: !isWhitespace(previousChar),
    needsTrailingSpace: !isWhitespace(nextChar),
  }
}

function focusEditorAtPosition(editor: TiptapEditor, position: number): void {
  if (editor.isFocused) {
    editor.chain().focus().run()
    return
  }
  editor.chain().focus(position).run()
}

function insertSkillMentionAtSelection(
  editor: TiptapEditor,
  item: { id: string; label: string },
): void {
  const { from, to, focusPosition } = resolveSkillMentionInsertRange(editor)
  const spacing = getSkillMentionSpacing(editor, from, to)
  const content = buildSkillMentionContent(item, spacing)
  focusEditorAtPosition(editor, focusPosition)
  editor.commands.insertContentAt({ from, to }, content)
}

function getSkillMentionInsertPosition(editor: TiptapEditor): number {
  const endPosition = editor.state.doc.content.size
  return endPosition
}

/**
 * 富文本输入组件
 * - 基于 TipTap 的 WYSIWYG 编辑器
 * - 纯文本输入，不渲染 Markdown 快捷格式
 * - 无工具栏，纯净输入体验
 */
export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(function RichTextInput({
  value,
  onChange,
  onSubmit,
  onPasteFiles,
  placeholder = '有什么可以帮助到你的呢？',
  suggestionActive = false,
  className,
  disabled = false,
  autoFocusTrigger,
  collapsible = false,
  workspacePath,
  capabilitySessionId,
  attachedDirs = [],
}: RichTextInputProps, ref): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(false)
  // 手动折叠状态：用户主动折叠输入框
  const [isManuallyCollapsed, setIsManuallyCollapsed] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  // 跟踪编辑器自己设置的值，用于区分外部设置和内部更新
  const lastEditorValueRef = useRef<string>('')
  // 跟踪 IME 输入状态（中文输入法等）
  const isComposingRef = useRef(false)
  // 保持 onSubmit 引用最新
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  // 保持 onPasteFiles 引用最新
  const onPasteFilesRef = useRef(onPasteFiles)
  onPasteFilesRef.current = onPasteFiles
  // Mention 活跃状态（阻止 Enter 发送消息）
  const mentionActiveRef = useRef(false)
  // 工作区路径引用（给 Suggestion 使用）
  const workspacePathRef = useRef<string | null>(workspacePath ?? null)
  workspacePathRef.current = workspacePath ?? null
  // 附加目录路径引用（给 Suggestion 使用）
  const attachedDirsRef = useRef<string[]>(attachedDirs)
  attachedDirsRef.current = attachedDirs
  // 会话 ID 引用（给 Skill/MCP Suggestion 使用）
  const capabilitySessionIdRef = useRef<string | null>(capabilitySessionId ?? null)
  capabilitySessionIdRef.current = capabilitySessionId ?? null

  // 是否启用 Mention 功能（需要项目路径或会话能力上下文）
  const hasMentionSupport = !!(workspacePath || capabilitySessionId)

  // Mention Suggestion 配置（稳定引用，不随 workspacePath 变化重建）
  const mentionSuggestion = useMemo(
    () => createFileMentionSuggestion(workspacePathRef, mentionActiveRef, attachedDirsRef),
    [],
  )

  // Skill Suggestion 配置（/ 触发）
  const skillSuggestion = useMemo(
    () => createSkillMentionSuggestion(capabilitySessionIdRef, mentionActiveRef),
    [],
  )

  // MCP Suggestion 配置（# 触发）
  const mcpSuggestion = useMemo(
    () => createMcpMentionSuggestion(capabilitySessionIdRef, mentionActiveRef),
    [],
  )
  const { element: measurementElement, width: measurementWidth, setElement: setMeasurementElement } = useElementWidth<HTMLElement>()

  const attachMeasurementElement = useCallback((node: HTMLDivElement | null) => {
    editorHostRef.current = node
    const proseMirror = node?.querySelector<HTMLElement>('.ProseMirror') ?? null
    setMeasurementElement(proseMirror)
  }, [setMeasurementElement])

  const editor = useEditor({
    // 只启用富链接输入规则，继续禁用 StarterKit 的 Markdown 快捷格式。
    enableInputRules: [RichLinkNode],
    enablePasteRules: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 使用 CodeBlockLowlight 替代
        // TipTap v3 StarterKit 默认包含 Link 和 Underline
        // 禁用内置版本，使用下面单独配置的版本
        link: false,
        underline: false,
      }),
      Underline,
      RichLinkNode,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'rounded-md bg-muted p-3 font-mono text-sm',
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      // Mention 扩展：仅在 Agent 模式（有工作区）时启用
      // @ 引用文件、/ 触发 Skill、# 触发 MCP
      ...(hasMentionSupport ? [
        Mention.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              mentionSuggestionChar: {
                default: '@',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-suggestion-char') || '@',
                renderHTML: (attrs: Record<string, string>) => ({
                  'data-mention-suggestion-char': attrs.mentionSuggestionChar,
                }),
              },
            }
          },
        }).configure({
          HTMLAttributes: {},
          renderHTML({ node, suggestion }) {
            const char = suggestion?.char ?? node.attrs.mentionSuggestionChar ?? '@'
            const label = node.attrs.label ?? node.attrs.id
            let chipClass = 'mention-chip'
            if (char === '/') chipClass = 'skill-mention-chip'
            else if (char === '#') chipClass = 'mcp-mention-chip'
            return [
              'span',
              {
                'data-type': 'mention',
                'data-id': node.attrs.id,
                'data-label': node.attrs.label,
                'data-mention-suggestion-char': char,
                class: chipClass,
              },
              `${char === '@' ? '@' : ''}${label}`,
            ]
          },
          suggestions: [
            mentionSuggestion,
            skillSuggestion,
            mcpSuggestion,
          ],
        }),
      ] : []),
    ],
    content: plainTextToDocument(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: cn(
          'prose dark:prose-invert max-w-none focus:outline-none',
          'min-h-[48px] w-full text-[14px] leading-[1.6]',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_p]:my-0',
          '[&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3',
          '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0'
        ),
      },
      // 监听 IME 输入状态
      handleDOMEvents: {
        compositionstart: () => {
          isComposingRef.current = true
          setIsComposing(true)
          return false
        },
        compositionend: () => {
          isComposingRef.current = false
          setIsComposing(false)
          return false
        },
      },
      handlePaste: (view, event) => {
        // 拦截粘贴的文件（图片等）
        const clipboardFiles = event.clipboardData?.files
        if (clipboardFiles && clipboardFiles.length > 0 && onPasteFilesRef.current) {
          event.preventDefault()
          onPasteFilesRef.current(Array.from(clipboardFiles))
          return true
        }

        // 回退：从 clipboardData.items 中提取图片 blob
        const clipboardItems = event.clipboardData?.items
        if (clipboardItems && clipboardItems.length > 0 && onPasteFilesRef.current) {
          const imageFiles: File[] = []
          for (let i = 0; i < clipboardItems.length; i++) {
            const item = clipboardItems[i]
            if (item?.type.startsWith('image/') && item.kind === 'file') {
              const file = item.getAsFile()
              if (file) imageFiles.push(file)
            }
          }
          if (imageFiles.length > 0) {
            event.preventDefault()
            onPasteFilesRef.current(imageFiles)
            return true
          }
        }

        const plainText = event.clipboardData?.getData('text/plain')
        if (typeof plainText !== 'string') {
          return false
        }

        event.preventDefault()
        const html = plainTextToDocument(plainText)
        const container = document.createElement('div')
        container.innerHTML = html || '<p></p>'
        const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, {
          preserveWhitespace: true,
        })
        view.dispatch(view.state.tr.replaceSelection(slice))
        return true
      },
      handleKeyDown: (view, event) => {
        // Enter 提交，Shift+Enter 换行
        if (event.key === 'Enter' && !event.shiftKey) {
          // 如果在代码块中，允许正常换行
          const { state } = view
          const { $from } = state.selection
          const parent = $from.parent
          if (parent.type.name === 'codeBlock') {
            return false // 让 TipTap 处理
          }

          // 检查是否正在输入中文（IME 组合输入）
          if (isComposingRef.current || event.isComposing) {
            return false
          }

          // Mention 列表打开时，让 TipTap Mention 处理 Enter
          if (mentionActiveRef.current) {
            return false
          }

          event.preventDefault()
          onSubmitRef.current()
          return true
        }

        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      if (html === '<p></p>') {
        lastEditorValueRef.current = ''
        onChange('')
        setIsExpanded(false)
        setIsManuallyCollapsed(false)
      } else {
        const plainText = htmlToPlainText(html)
        lastEditorValueRef.current = plainText
        onChange(plainText)
      }
    },
  })

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!editor || disabled) return
      editor.chain().focus().run()
    },
    insertSkillMention: (item) => {
      if (!editor || disabled) return
      const fallbackPosition = getSkillMentionInsertPosition(editor)
      if (!editor.isFocused) {
        editor.chain().focus(fallbackPosition).run()
      }
      insertSkillMentionAtSelection(editor, item)
    },
  }), [editor, disabled])

  const predictiveCaretState = usePredictiveCaret({
    editor,
    hostElement: editorHostRef.current,
    scrollElement: containerRef.current,
    isComposing,
    disabled,
  })

  useEffect(() => {
    if (!editorHostRef.current) return
    const proseMirror = editorHostRef.current.querySelector<HTMLElement>('.ProseMirror')
    if (proseMirror && proseMirror !== measurementElement) {
      setMeasurementElement(proseMirror)
    }
  }, [editor, measurementElement, setMeasurementElement])

  useEffect(() => {
    if (!measurementElement) return

    measurementElement.classList.toggle('predictive-caret-active', !predictiveCaretState.useNativeCaret)

    return () => {
      measurementElement.classList.remove('predictive-caret-active')
    }
  }, [measurementElement, predictiveCaretState.useNativeCaret])

  // 同步外部 value 变化（清空时）
  useEffect(() => {
    if (!editor) return
    const controllerValue = value
    // 如果值是编辑器自己设置的，跳过同步
    if (controllerValue === lastEditorValueRef.current) {
      return
    }

    // 编辑器聚焦（用户正在输入）时，只有显式清空才允许回灌。
    // 否则 setContent 会重置光标到末尾，导致正在输入的字符被插入到错误位置，
    // 表现为"发出去后字符顺序都乱了"——尤其是 RichLink InputRule 触发 chip
    // 转换的瞬间，atom 更新与 onUpdate 之间会出现中间态不一致。
    if (editor.isFocused && controllerValue !== '') {
      lastEditorValueRef.current = controllerValue
      return
    }

    if (controllerValue === '') {
      editor.commands.clearContent()
      lastEditorValueRef.current = ''
      setIsExpanded(false)
      setIsManuallyCollapsed(false)
    } else {
      editor.commands.setContent(plainTextToDocument(controllerValue))
      lastEditorValueRef.current = controllerValue
    }
  }, [editor, value])

  // 同步 disabled 状态
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled)
    }
  }, [editor, disabled])

  // 动态更新 placeholder 文本
  useEffect(() => {
    if (!editor) return
    const placeholderExt = editor.extensionManager.extensions.find(
      (ext) => ext.name === 'placeholder'
    )
    if (placeholderExt) {
      placeholderExt.options.placeholder = placeholder
      // 触发 TipTap 重新渲染 placeholder
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, placeholder])

  // 自动聚焦：组件挂载时 + autoFocusTrigger 变化时
  useEffect(() => {
    if (editor && !disabled) {
      const timer = setTimeout(() => {
        editor.commands.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [editor, disabled, autoFocusTrigger])

  useEffect(() => {
    if (!value) {
      setIsExpanded(false)
      return
    }

    const normalizedText = normalizeMeasurementText(value)
    const fontSpec = getElementFontSpec(measurementElement)
    if (!measurementElement || measurementWidth <= 0 || !fontSpec) {
      setIsExpanded(fallbackLineCount(normalizedText) > 5)
      return
    }

    const { lineCount } = measurePreWrapText({
      text: normalizedText,
      widthPx: measurementWidth,
      font: fontSpec.font,
      lineHeightPx: fontSpec.lineHeightPx,
    })
    setIsExpanded((lineCount || fallbackLineCount(normalizedText)) > 5)
  }, [measurementElement, measurementWidth, value])

  // 是否显示折叠按钮：启用 collapsible 且内容已自动扩展
  const showCollapseToggle = collapsible && isExpanded

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-y-auto transition-[max-height] duration-200 ease-in-out',
        isManuallyCollapsed
          ? 'max-h-[60px]'
          : isExpanded ? 'max-h-[500px]' : 'max-h-[200px]',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <div ref={attachMeasurementElement} className="relative">
        <EditorContent editor={editor} className="w-full" />
        <PredictiveCaretOverlay state={predictiveCaretState} />
      </div>
      {/* 折叠/展开切换按钮 — sticky 悬浮在滚动区域内 */}
      {showCollapseToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="sticky bottom-1 float-right mr-2 z-10 p-0.5 rounded hover:bg-muted/80 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => setIsManuallyCollapsed((prev) => !prev)}
            >
              {isManuallyCollapsed ? (
                <ChevronsUpDown className="size-3.5" />
              ) : (
                <ChevronsDownUp className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isManuallyCollapsed ? '展开输入框' : '折叠输入框'}
          </TooltipContent>
        </Tooltip>
      )}
      <style>{`
        .ProseMirror {
          outline: none;
          cursor: text;
          padding: 12px 16px 4px;
          font-style: normal;
          caret-color: hsl(var(--primary));
        }
        .ProseMirror:focus {
          animation: kila-caret-breathe 1.4s ease-in-out infinite;
        }
        .ProseMirror.predictive-caret-active {
          caret-color: transparent;
          animation: none;
        }
        .ProseMirror p {
          font-style: normal;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
          opacity: 0.5;
          font-style: ${suggestionActive ? 'italic' : 'normal'};
        }
        .ProseMirror::-webkit-scrollbar {
          width: 3px;
        }
        @keyframes kila-caret-breathe {
          0%, 100% {
            caret-color: hsl(var(--primary) / 0.34);
          }
          50% {
            caret-color: hsl(var(--primary));
          }
        }
        .composer-rich-link-chip {
          --composer-link-bg: hsl(var(--kila-link-chip-background));
          --composer-link-fg: hsl(var(--kila-link-chip-foreground));
          max-width: min(100%, 34rem);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 0 1px;
          padding: 3px 10px;
          border-radius: 14px;
          background-color: var(--composer-link-bg);
          color: var(--composer-link-fg);
          box-shadow: 0 1px 2px hsl(var(--kila-shadow-low) / 0.08);
          font-size: 0.92em;
          font-weight: 500;
          line-height: 1.35;
          white-space: nowrap;
          vertical-align: -0.18em;
          cursor: text;
          transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
        }
        .composer-rich-link-chip:hover {
          --composer-link-bg: hsl(var(--kila-link-chip-hover));
        }
        .composer-rich-link-chip::before {
          content: '';
          width: 1.05em;
          height: 1.05em;
          flex-shrink: 0;
          background-color: currentColor;
          mask-size: contain;
          mask-position: center;
          mask-repeat: no-repeat;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20'/%3E%3C/svg%3E");
        }
        .composer-rich-link-chip[data-rich-link-kind='document']::before,
        .composer-rich-link-chip[data-rich-link-kind='spreadsheet']::before,
        .composer-rich-link-chip[data-rich-link-kind='presentation']::before,
        .composer-rich-link-chip[data-rich-link-kind='image']::before,
        .composer-rich-link-chip[data-rich-link-kind='video']::before,
        .composer-rich-link-chip[data-rich-link-kind='code']::before,
        .composer-rich-link-chip[data-rich-link-kind='local-file']::before {
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E");
        }
        .mention-chip {
          background-color: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .skill-mention-chip {
          background-color: hsl(var(--brand-soft));
          color: hsl(var(--brand-soft-foreground));
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .skill-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .mcp-mention-chip {
          background-color: hsl(var(--status-info-soft));
          color: hsl(var(--status-info-foreground));
          border-radius: 4px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .mcp-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='8' x='2' y='2' rx='2' ry='2'/%3E%3Crect width='20' height='8' x='2' y='14' rx='2' ry='2'/%3E%3Cline x1='6' x2='6.01' y1='6' y2='6'/%3E%3Cline x1='6' x2='6.01' y1='18' y2='18'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  )
})

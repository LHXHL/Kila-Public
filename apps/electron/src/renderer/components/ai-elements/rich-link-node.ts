import { InputRule, Node } from '@tiptap/core'
import type { RichLinkKind } from './rich-link-presentation'
import { createRichLinkPresentation } from './rich-link-presentation'
import { parseRichTextTokens } from './rich-link-text-parser'

interface RichLinkNodeAttributes {
  href: string
  label: string
  source: string
  kind: RichLinkKind
}

function createAttributes(source: string): RichLinkNodeAttributes | null {
  const tokens = parseRichTextTokens(source)
  const link = tokens.length === 1 && tokens[0]?.kind === 'link' ? tokens[0] : null
  if (!link) return null

  const presentation = createRichLinkPresentation(link.href, link.label)
  return {
    href: link.href,
    label: presentation.label,
    source: link.value,
    kind: presentation.kind,
  }
}

function createMarkdownLinkFinder(text: string) {
  const match = text.match(/\[[^\]\n]+\]\([^\s)]+\)$/)
  if (!match || match.index === undefined) return null
  const attributes = createAttributes(match[0])
  if (!attributes) return null
  return {
    text: match[0],
    index: match.index,
    data: attributes,
  }
}

function createBareLinkFinder(text: string) {
  const match = text.match(/(?:https?:\/\/|file:\/\/|sandbox:)[^\s<>"'`]+\s$/i)
  if (!match || match.index === undefined) return null
  const source = match[0].slice(0, -1)
  const attributes = createAttributes(source)
  if (!attributes) return null
  return {
    text: match[0],
    index: match.index,
    data: attributes,
  }
}

/** 输入框中的原子富链接节点：视觉上是胶囊，序列化时仍恢复用户原始文本。 */
export const RichLinkNode = Node.create({
  name: 'richLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-rich-link-href') ?? '',
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-rich-link-label') ?? '',
      },
      source: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-rich-link-source') ?? '',
      },
      kind: {
        default: 'web',
        parseHTML: (element) => element.getAttribute('data-rich-link-kind') ?? 'web',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="rich-link"]' }]
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-type': 'rich-link',
        'data-rich-link-href': node.attrs.href,
        'data-rich-link-label': node.attrs.label,
        'data-rich-link-source': node.attrs.source,
        'data-rich-link-kind': node.attrs.kind,
        class: 'composer-rich-link-chip',
        title: node.attrs.href,
      },
      node.attrs.label,
    ]
  },

  renderText({ node }) {
    return node.attrs.source || node.attrs.href
  },

  addInputRules() {
    const createRule = (find: typeof createMarkdownLinkFinder, appendSpace: boolean) => new InputRule({
      find,
      handler: ({ state, range, match }) => {
        const attributes = match.data as unknown as RichLinkNodeAttributes | undefined
        if (!attributes) return null

        // 安全闸门：当 range 内已经存在 richLink atom 节点时跳过本次转换。
        // ProseMirror 的 getTextContentFromNodes 会把 atom 节点的 renderText
        // （即完整的 URL/Markdown source）拼进 textBefore 参与 InputRule 匹配，
        // 导致 range.from 基于字符长度而非 atom nodeSize(=1) 回退，
        // replaceWith 会跨越并删除已有 chip 及周围文本，造成字符顺序错乱。
        let hasExistingRichLink = false
        state.doc.nodesBetween(range.from, range.to, (node) => {
          if (hasExistingRichLink) return false
          if (node.type.name === 'richLink') {
            hasExistingRichLink = true
            return false
          }
          return true
        })
        if (hasExistingRichLink) return null

        const richLinkNode = this.type.create(attributes)
        const transaction = state.tr.replaceWith(range.from, range.to, richLinkNode)
        if (appendSpace) {
          transaction.insertText(' ', range.from + richLinkNode.nodeSize)
        }
      },
    })

    return [
      createRule(createMarkdownLinkFinder, false),
      createRule(createBareLinkFinder, true),
    ]
  },
})

/**
 * 飞书消息上下文 → Agent user message 构造器。
 *
 * 注入桥接上下文 XML 块：bridge_context、quoted_message、
 * interactive_card、attached_files、group_extra、user_message。
 *
 * XML 块对用户不可见，教 Agent 理解飞书侧元数据。
 */

export interface QuotedMessage {
  messageId: string
  senderOpenId?: string
  senderName?: string
  createdAt?: number
  contentType: string
  content: string
  cardJson?: string
}

export interface BridgeContext {
  chatId: string
  chatType: 'p2p' | 'group' | 'topic'
  senderOpenId: string
  senderName?: string
  threadId?: string
  groupName?: string
}

export interface BuildOptions {
  userText: string
  context: BridgeContext
  quoted?: QuotedMessage
  attachedFilesBlock?: string
  groupExtraBlock?: string
}

/** 教 Agent 如何看待 bridge 注入的 XML 块。会被前置到每条 userMessage。 */
const BRIDGE_USER_MESSAGE_PRELUDE = `<!-- 你正在通过 Kila 飞书桥处理来自飞书的用户消息。bridge 会用 XML 块注入
当前对话的元数据。下面这些 XML 块**对用户不可见**，不要照抄到回复里。

可能出现的 XML 块：
- <bridge_context>：chat_id / chat_type / sender 等飞书侧元数据
- <quoted_message>：用户长按"回复"指向的那条消息（你的回答应该围绕它展开）
- <interactive_card>：被引用消息是卡片时，附上原 card JSON 供你理解结构
- <attached_files>：用户上传的图片/文件已保存到本地，给你绝对路径

用户的实际问题在这些块之后。回答时围绕用户问题展开；XML 块只用来理解上下文。

【飞书桥重要约束】
1. **禁用 AskUserQuestion 工具**：飞书桥目前没有交互问答的 UI 通道，调用这个工具
   会让会话卡死。如果信息不足，请基于现有信息给出最佳推断（可在回复里说明你的
   假设），或直接告知用户需要的额外信息让他们补充，让用户在下一条消息里补全。
   绝对不要调用 AskUserQuestion。
2. **附件优先用 Read 工具读取**：<attached_files> 给的是已保存到本地的绝对路径，
   你可以直接 Read（图片走多模态读取）/ 用 Bash 的 file/cat 等命令查看。
3. **回复格式**：飞书侧使用 markdown 富文本卡片渲染，可以放心用 markdown 格式。
-->`

export function buildAgentUserMessage(opts: BuildOptions): string {
  const parts: string[] = [BRIDGE_USER_MESSAGE_PRELUDE]

  parts.push(buildBridgeContextBlock(opts.context))

  if (opts.quoted) {
    parts.push(buildQuotedMessageBlock(opts.quoted))
    if (opts.quoted.cardJson) {
      parts.push(buildInteractiveCardBlock(opts.quoted.cardJson))
    }
  }

  if (opts.attachedFilesBlock && opts.attachedFilesBlock.trim()) {
    parts.push(opts.attachedFilesBlock.trim())
  }

  if (opts.groupExtraBlock && opts.groupExtraBlock.trim()) {
    parts.push(`<group_extra>\n${opts.groupExtraBlock.trim()}\n</group_extra>`)
  }

  parts.push(`<user_message>\n${opts.userText}\n</user_message>`)

  return parts.join('\n\n')
}

function buildBridgeContextBlock(ctx: BridgeContext): string {
  const lines = [
    `chat_id: ${ctx.chatId}`,
    `chat_type: ${ctx.chatType}`,
    `sender_id: ${ctx.senderOpenId}`,
  ]
  if (ctx.senderName) lines.push(`sender_name: ${ctx.senderName}`)
  if (ctx.threadId) lines.push(`thread_id: ${ctx.threadId}`)
  return `<bridge_context>\n${lines.join('\n')}\n</bridge_context>`
}

function buildQuotedMessageBlock(q: QuotedMessage): string {
  const attrs = [
    `id="${q.messageId}"`,
    q.senderOpenId ? `sender_id="${q.senderOpenId}"` : '',
    q.senderName ? `sender_name="${escapeAttr(q.senderName)}"` : '',
    q.createdAt ? `created_at="${new Date(q.createdAt).toISOString()}"` : '',
    `type="${q.contentType}"`,
  ].filter(Boolean).join(' ')
  return `<quoted_message ${attrs}>\n${q.content}\n</quoted_message>`
}

function buildInteractiveCardBlock(cardJson: string): string {
  return `<interactive_card>\n${cardJson}\n</interactive_card>`
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
}

/**
 * @mention 转换：Agent 输出中的 @Name → 飞书 <at> 标签
 */
export function convertMentions(
  text: string,
  mentionMap: Map<string, string>,
): string {
  if (mentionMap.size === 0) return text
  return text.replace(/@(\S+)/g, (match, name: string) => {
    const openId = mentionMap.get(name)
    if (!openId) return match
    return `<at user_id="${openId}">${name}</at>`
  })
}

export function buildGroupExtraBlock(groupName?: string): string {
  if (!groupName) return ''
  return `- 群组: ${groupName}`
}

/**
 * Discord Gateway 边界类型
 *
 * Gateway 帧和 Dispatch 事件负载来自网络，历史实现用 `any` 承接。
 * 这里按 Kila 实际读取的字段收窄，字段访问路径与原实现保持一致。
 * 参考：https://discord.com/developers/docs/topics/gateway-events
 */

/** WebSocket 帧事件：只用到 data */
export interface BridgeWebSocketEvent {
  data?: unknown
}

/** 适配器内部的 WebSocket 契约（真实 WebSocket 与测试替身共用） */
export interface BridgeWebSocket {
  addEventListener: (type: string, listener: (event: BridgeWebSocketEvent) => void) => void
  close: (code?: number, reason?: string) => void
  send: (data: string) => void
}

/** op 10 Hello 负载 */
export interface DiscordHelloData {
  heartbeat_interval?: number
}

/** MESSAGE_CREATE 的附件条目 */
export interface DiscordAttachmentData {
  id?: string
  filename?: string
  content_type?: string
  size?: number
  url?: string
}

/**
 * op 0 Dispatch 的事件负载。
 *
 * READY / RESUMED / MESSAGE_CREATE / INTERACTION_CREATE 共用一个可选字段集合：
 * Discord 按事件类型只下发其中一部分，运行时读取本来就是逐字段可选的。
 */
export interface DiscordDispatchData {
  /** READY */
  user?: { id?: string }
  session_id?: string
  resume_gateway_url?: string
  /** MESSAGE_CREATE / INTERACTION_CREATE */
  id?: string
  channel_id?: string
  guild_id?: string
  content?: string
  author?: { id?: string; username?: string; bot?: boolean }
  mentions?: Array<{ id?: string }>
  attachments?: DiscordAttachmentData[]
  /** INTERACTION_CREATE */
  token?: string
  data?: { custom_id?: string }
  member?: { user?: { id?: string } }
}

/**
 * Gateway 帧的 d 字段是多态的：
 * - op 9（Invalid Session）下发 boolean
 * - op 10 / op 0 下发对象负载
 */
export type DiscordGatewayFrameData = boolean | (DiscordHelloData & DiscordDispatchData)

export interface DiscordGatewayPayload {
  op: number
  d?: DiscordGatewayFrameData
  s?: number | null
  t?: string | null
}

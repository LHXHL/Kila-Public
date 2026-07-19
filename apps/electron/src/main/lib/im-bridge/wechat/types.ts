import type {
  BridgeOutboundMessage,
  BridgeAttachmentReference,
} from '../adapters/base-adapter'

export const WECHAT_CHANNEL = 'wechat' as const

export const DEFAULT_WECHAT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'

export type WeChatPeerType = 'user' | 'group'

export interface WeChatCredential {
  accountId: string
  botToken: string
  ilinkUserId: string
  ilinkBotId: string
  baseUrl: string
}

export interface WeChatContextEntry {
  accountId: string
  peerId: string
  contextToken: string
  lastSeenAt: number
  sessionId?: string
  typingTicket?: string
}

export interface WeChatDeferredOutboundEntry {
  id: string
  channelType: 'wechat'
  accountId: string
  peerId: string
  sessionId: string
  reason: 'scheduled_task' | 'permission_prompt' | 'system' | 'assistant' | 'command'
  payload: BridgeOutboundMessage
  createdAt: number
  expiresAt: number
}

export interface WeChatLoginTicket {
  accountId: string
  label: string
  ticket: string
  qrCodeDataUrl?: string
  status: 'waiting_scan' | 'scanned' | 'confirmed' | 'expired' | 'redirected' | 'error'
  createdAt: number
  updatedAt: number
  message?: string
  errorMessage?: string
}

export interface WeChatIlinkLoginResponse {
  ticket?: string
  qrcode?: string
  qrcode_img_url?: string
  qrcode_img_content?: string
  qrcode_url?: string
  url?: string
  status?: string
  message?: string
}

export interface WeChatIlinkLoginStatusResponse {
  status?: string
  message?: string
  bot_token?: string
  botToken?: string
  ilink_user_id?: string
  ilinkUserId?: string
  ilink_bot_id?: string
  ilinkBotId?: string
  baseurl?: string
  base_url?: string
  baseUrl?: string
  account_id?: string
  accountId?: string
  label?: string
}

export interface WeChatIlinkGetConfigResponse {
  typing_ticket?: string
  typingTicket?: string
}

export interface WeChatIlinkUpdateBatch {
  ret?: number
  errcode?: number
  errmsg?: string
  get_updates_buf?: string
  getUpdatesBuf?: string
  msgs?: WeChatIlinkRawMessage[]
  update_list?: WeChatIlinkRawMessage[]
  updates?: WeChatIlinkRawMessage[]
  messages?: WeChatIlinkRawMessage[]
}

export interface WeChatIlinkRawMessage {
  id?: string | number
  msg_id?: string | number
  message_id?: string | number
  from_user_id?: string
  to_user_id?: string
  message_type?: number
  message_state?: number
  from_user_name?: string
  fromUserName?: string
  fromUserId?: string
  peer_id?: string
  peerId?: string
  nickname?: string
  display_name?: string
  displayName?: string
  content?: string
  text?: string
  msg_type?: string | number
  msgType?: string | number
  context_token?: string
  contextToken?: string
  session_id?: string
  sessionId?: string
  typing_ticket?: string
  typingTicket?: string
  item_list?: WeChatIlinkMessageItem[]
  items?: WeChatIlinkMessageItem[]
  attachment_list?: WeChatIlinkMessageItem[]
}

export interface WeChatIlinkMessageItem {
  type?: string | number
  text_item?: { text?: string }
  image_item?: {
    url?: string
    aeskey?: string
    media?: {
      encrypt_query_param?: string
      aes_key?: string
      full_url?: string
    }
  }
  voice_item?: {
    text?: string
    playtime?: number
    media?: {
      encrypt_query_param?: string
      aes_key?: string
      full_url?: string
    }
  }
  file_item?: {
    file_name?: string
    len?: string
    media?: {
      encrypt_query_param?: string
      aes_key?: string
      full_url?: string
    }
  }
  video_item?: {
    video_size?: number
    media?: {
      encrypt_query_param?: string
      aes_key?: string
      full_url?: string
    }
  }
  msg_type?: string | number
  text?: string
  content?: string
  name?: string
  filename?: string
  file_name?: string
  media_type?: string
  mediaType?: string
  size?: number
  file_size?: number
  url?: string
  cdn_url?: string
  full_url?: string
  aes_key?: string
  aesKey?: string
  encrypt_query_param?: string
  encryptQueryParam?: string
  file_id?: string
  fileId?: string
  file_key?: string
  fileKey?: string
  remote_id?: string
  remoteId?: string
}

export interface ParsedWeChatInbound {
  message: {
    channelType: 'wechat'
    endpointKey: string
    chatId: string
    userId: string
    displayName?: string
    messageId: string
    text: string
    attachments: BridgeAttachmentReference[]
    providerContext: {
      wechat: {
        accountId: string
        peerId: string
        contextToken?: string
        sessionId?: string
        typingTicket?: string
      }
    }
  }
  context?: WeChatContextEntry
}

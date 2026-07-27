/**
 * Telegram Bot API 边界类型
 *
 * getUpdates 返回的 Update 对象来自网络，历史实现用 `Record<string, any>` 承接。
 * 这里按 Kila 实际读取的字段收窄，字段访问路径与原实现保持一致。
 * 参考：https://core.telegram.org/bots/api#update
 */

/** 聊天对象：只用到 id 与 type */
export interface TelegramChat {
  id?: number | string
  type?: string
}

/** 用户对象：只用到 id 与 username */
export interface TelegramUser {
  id?: number | string
  username?: string
}

/** 文档附件 */
export interface TelegramDocument {
  file_id?: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

/** 图片附件的一档尺寸（photo 数组按分辨率升序，最后一项最清晰） */
export interface TelegramPhotoSize {
  file_id?: string
  file_size?: number
}

export interface TelegramMessage {
  message_id?: number
  text?: string
  caption?: string
  chat?: TelegramChat
  from?: TelegramUser
  document?: TelegramDocument
  photo?: TelegramPhotoSize[]
}

/** 内联按钮回调（权限提示的允许/拒绝） */
export interface TelegramCallbackQuery {
  id?: string
  data?: string
  from?: TelegramUser
  message?: { chat?: TelegramChat }
}

export interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

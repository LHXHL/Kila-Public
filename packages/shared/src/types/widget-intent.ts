export interface WidgetDraftIntentSource {
  widgetKey: string
  messageId?: string
  pinId?: string
}

export interface WidgetDraftIntent {
  type: 'draft_message'
  prompt: string
  label?: string
  source: WidgetDraftIntentSource
}

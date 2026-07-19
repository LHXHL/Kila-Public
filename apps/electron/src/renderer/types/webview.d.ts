import type * as React from 'react'

export interface KilaWebviewElement extends HTMLElement {
  src: string
  partition: string
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  goBack(): void
  goForward(): void
  reload(): void
  loadURL(url: string): Promise<void>
  addEventListener(type: string, listener: (event: any) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: any) => void, options?: boolean | EventListenerOptions): void
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<KilaWebviewElement>, KilaWebviewElement> & {
        src?: string
        partition?: string
        allowpopups?: boolean | 'true' | 'false'
        webpreferences?: string
      }
    }
  }
}

export {}

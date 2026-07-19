import type { WebContents } from 'electron'
import { BrowserWindow } from 'electron'

export function broadcastSessionChannel(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const webContents: WebContents = win.webContents
    if (webContents.isDestroyed()) continue
    webContents.send(channel, payload)
  }
}

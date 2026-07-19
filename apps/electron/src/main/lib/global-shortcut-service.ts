import { globalShortcut } from 'electron'
import { createSession } from './session-manager'
import { openSessionInMainWindow } from './settings-window-manager'

type ShortcutAction = () => void | Promise<void>

const registeredAccelerators: string[] = []

function registerShortcut(accelerator: string, action: ShortcutAction): void {
  if (globalShortcut.isRegistered(accelerator)) return
  const ok = globalShortcut.register(accelerator, () => {
    Promise.resolve(action()).catch((error) => {
      console.error(`[GlobalShortcut] 快捷键执行失败 ${accelerator}:`, error)
    })
  })
  if (ok) {
    registeredAccelerators.push(accelerator)
  } else {
    console.warn(`[GlobalShortcut] 注册失败: ${accelerator}`)
  }
}

export function registerGlobalShortcuts(options: {
  showMainWindow: () => void
  toggleQuickTask: () => void
}): void {
  registerShortcut('CommandOrControl+Shift+K', options.showMainWindow)
  registerShortcut('CommandOrControl+Shift+Space', options.toggleQuickTask)
  registerShortcut('CommandOrControl+Shift+N', () => {
    const session = createSession({ title: '新会话' })
    openSessionInMainWindow({
      sessionId: session.id,
      title: session.title,
    })
  })
}

export function unregisterGlobalShortcuts(): void {
  for (const accelerator of registeredAccelerators) {
    globalShortcut.unregister(accelerator)
  }
  registeredAccelerators.length = 0
}

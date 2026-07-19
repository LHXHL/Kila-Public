import { ipcRenderer } from 'electron'
import type { FileDialogResult, QuickTaskSubmitInput, QuickTaskSubmitResult } from '@kila/shared'

export interface QuickTaskPreloadApi {
  submitQuickTask: (input: QuickTaskSubmitInput) => Promise<QuickTaskSubmitResult>
  hideQuickTask: () => Promise<void>
  onQuickTaskFocus: (callback: () => void) => () => void
  pickQuickTaskFiles: () => Promise<FileDialogResult>
  pickQuickTaskProject: () => Promise<{ path: string; name: string } | null>
}

export function createQuickTaskApi(): QuickTaskPreloadApi {
  return {
    submitQuickTask: (input) => ipcRenderer.invoke('quick-task:submit', input),
    hideQuickTask: () => ipcRenderer.invoke('quick-task:hide'),
    onQuickTaskFocus: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('quick-task:focus', listener)
      return () => ipcRenderer.removeListener('quick-task:focus', listener)
    },
    pickQuickTaskFiles: () => ipcRenderer.invoke('quick-task:pick-files'),
    pickQuickTaskProject: () => ipcRenderer.invoke('quick-task:pick-project'),
  }
}

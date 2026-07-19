import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { settingsDirtyAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { Panel } from '@/components/app-shell/Panel'
import { SettingsPanel } from './SettingsPanel'

export function SettingsWindowApp(): React.ReactElement {
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const settingsDirty = useAtomValue(settingsDirtyAtom)
  const settingsDirtyRef = React.useRef(settingsDirty)

  React.useEffect(() => {
    settingsDirtyRef.current = settingsDirty
  }, [settingsDirty])

  React.useEffect(() => {
    const context = window.electronAPI.getWindowContext()
    if (context.settingsTab) {
      setSettingsTab(context.settingsTab)
    }

    return window.electronAPI.onSettingsNavigate((tab) => {
      if (settingsDirtyRef.current && !window.confirm('当前设置尚未保存。放弃这些更改并切换页面？')) return
      setSettingsTab(tab)
    })
  }, [setSettingsTab])

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!settingsDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [settingsDirty])

  return (
    <>
      <div className="titlebar-drag-region fixed left-0 right-0 top-0 h-[50px] z-[var(--kila-z-titlebar)]" />

      <div className="h-screen w-screen overflow-hidden bg-muted p-2.5">
        <Panel
          variant="grow"
          className="surface-panel relative z-[var(--kila-z-panel)] bg-[hsl(var(--workspace))]"
        >
          <SettingsPanel />
        </Panel>
      </div>
    </>
  )
}

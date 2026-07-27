import * as React from 'react'
import { TooltipProvider } from './components/ui/tooltip'

const AppShell = React.lazy(() => import('./components/app-shell/AppShell').then((module) => ({ default: module.AppShell })))
const SettingsWindowApp = React.lazy(() => import('./components/settings/SettingsWindowApp').then((module) => ({ default: module.SettingsWindowApp })))
const QuickTaskApp = React.lazy(() => import('./components/quick-task/QuickTaskApp').then((module) => ({ default: module.QuickTaskApp })))

function AppRouteFallback(): React.ReactElement {
  return <div className="h-screen bg-background" />
}

export default function App(): React.ReactElement {
  const windowMode = window.electronAPI.getWindowMode()

  if (windowMode === 'quick-task') {
    return (
      <TooltipProvider delayDuration={200}>
        <React.Suspense fallback={<AppRouteFallback />}>
          <QuickTaskApp />
        </React.Suspense>
      </TooltipProvider>
    )
  }

  if (windowMode === 'settings') {
    return (
      <TooltipProvider delayDuration={200}>
        <React.Suspense fallback={<AppRouteFallback />}>
          <SettingsWindowApp />
        </React.Suspense>
      </TooltipProvider>
    )
  }

  // 环境检测不再阻塞主界面 — 缺少环境只影响工具调用，纯对话可正常使用
  return (
    <TooltipProvider delayDuration={200}>
      <React.Suspense fallback={<AppRouteFallback />}>
        <AppShell />
      </React.Suspense>
    </TooltipProvider>
  )
}

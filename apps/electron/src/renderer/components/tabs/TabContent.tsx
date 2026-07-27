/**
 * TabContent — 标签内容渲染器
 *
 * 所有会话标签统一渲染 `SessionView`。
 * Tab 只负责定位 sessionId，所有会话统一渲染为 Agent 模式。
 */

import type * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { tabsAtom } from '@/atoms/tab-atoms'
import { SessionView } from '@/components/session/SessionView'

export interface TabContentProps {
  tabId: string
}

export function TabContent({ tabId }: TabContentProps): React.ReactElement {
  const { t } = useTranslation()
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((candidate) => candidate.id === tabId)

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('tabs.content.missingTab')}
      </div>
    )
  }

  return <SessionView sessionId={tab.sessionId} key={tab.sessionId} />
}

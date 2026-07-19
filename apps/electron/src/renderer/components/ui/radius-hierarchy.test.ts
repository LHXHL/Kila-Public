import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function readRendererSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('圆角层级', () => {
  test('Given 普通控件 When 渲染基础样式 Then 使用克制的 control 圆角', () => {
    const buttonSource = readRendererSource('./button.tsx')
    const inputSource = readRendererSource('./input.tsx')
    const selectSource = readRendererSource('./select.tsx')
    const tabSource = readRendererSource('../tabs/TabBarItem.tsx')

    expect(buttonSource).toContain('rounded-lg text-sm')
    expect(buttonSource).not.toContain('rounded-xl text-sm')
    expect(inputSource).toContain('w-full rounded-lg border')
    expect(selectSource).toContain('whitespace-nowrap rounded-lg border')
    expect(tabSource).toContain('select-none rounded-lg border')
  })

  test('Given 状态元数据 When 展示标签 Then 使用小圆角而不是通用胶囊', () => {
    const globalsSource = readRendererSource('../../styles/globals.css')
    const badgeSource = readRendererSource('./badge.tsx')

    expect(globalsSource).toContain('--kila-control-radius-sm: 6px;')
    expect(globalsSource).toContain('border-radius: var(--kila-control-radius-sm);')
    expect(badgeSource).toContain('items-center rounded-md border')
    expect(badgeSource).not.toContain('items-center rounded-full border')
  })

  test('Given 长文本标签与筛选入口 When 展示辅助信息 Then 避免胶囊化', () => {
    const tokenUsageSource = readRendererSource('../settings/TokenUsageSettings.tsx')
    const skillDetailSource = readRendererSource('../settings/SkillDetailDialog.tsx')
    const toolActivitySource = readRendererSource('../agent/ToolActivityItem.tsx')

    expect(tokenUsageSource).toContain("'rounded-lg bg-[hsl(var(--brand-soft))]")
    expect(tokenUsageSource).not.toContain("'rounded-full bg-[hsl(var(--brand-soft))]")
    expect(skillDetailSource).toContain('max-w-full rounded-md border')
    expect(toolActivitySource).toContain('rounded-md px-2 py-1 text-[11px]')
  })

  test('Given 进度与通知点 When 展示连续状态 Then 仍保留完整圆形', () => {
    const contextSource = readRendererSource('../composer/ContextUsageIndicator.tsx')
    const pendingSource = readRendererSource('../agent/GlobalPendingRequestsButton.tsx')

    expect(contextSource).toContain("'h-full rounded-full transition-all duration-300'")
    expect(pendingSource).toContain('rounded-full bg-[hsl(var(--status-warning))]')
  })
})

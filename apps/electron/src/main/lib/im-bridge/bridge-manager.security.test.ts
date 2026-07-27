/**
 * BridgeManager 安全不变量
 *
 * `BridgeManager` 在模块加载期就会实例化四个 adapter（含 Electron safeStorage / app 路径），
 * 无法在纯 bun 测试里构造。这里改为对源码做结构性断言，锁死两条最贵的回归：
 * 1. 飞书入站不得再硬编码 `permissionModeOverride: 'auto'`
 * 2. 统一准入闸门必须发生在创建绑定 / 投递 Agent 之前
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, 'bridge-manager.ts'), 'utf-8')

describe('BridgeManager 权限模式不变量', () => {
  test('Given 源码 When 检查权限覆盖 Then 不存在硬编码的 auto 全放行', () => {
    expect(source).not.toContain("permissionModeOverride: 'auto'")
    expect(source).not.toContain("{ permissionModeOverride: 'auto' as const }")
  })

  test('Given 源码 When 检查权限模式来源 Then 只经由 resolveBridgePermissionMode 决策', () => {
    expect(source).toContain('resolveBridgePermissionMode')
    expect(source).toContain('permissionDecision.mode')
  })
})

describe('BridgeManager 入站准入不变量', () => {
  test('Given 源码 When 检查入站流程 Then 统一闸门先于绑定创建与 Agent 投递', () => {
    const guardIndex = source.indexOf('evaluateInboundGuard({')
    const bindingIndex = source.indexOf('this.channelRouter.resolveOrCreateBinding({')
    const dispatchIndex = source.indexOf('this.headlessBridge.sendMessage({')

    expect(guardIndex).toBeGreaterThan(-1)
    expect(bindingIndex).toBeGreaterThan(guardIndex)
    expect(dispatchIndex).toBeGreaterThan(guardIndex)
  })

  test('Given 源码 When 闸门拒绝 Then 走统一的 rejectInboundMessage（回提示 + 写审计）后立即返回', () => {
    expect(source).toContain('if (!guard.allowed) {')
    expect(source).toContain('await rejectInboundMessage({')

    const rejection = readFileSync(join(import.meta.dir, 'security', 'inbound-rejection.ts'), 'utf-8')
    expect(rejection).toContain('auditLog.appendChannelError({')
    expect(rejection).toContain('auditLog.appendOutboundMessage({')
    expect(rejection).toContain('adapter.sendMessage({')
  })

  test('Given 源码 When 检查附件上限 Then 不再有 MAX_SAFE_INTEGER 兜底缺口', () => {
    expect(source).not.toContain('Number.MAX_SAFE_INTEGER')
  })

  test('Given 源码 When 审批回调进入 Then 携带 channelType 与 userId 供身份校验', () => {
    expect(source).toContain('userId: event.action.userId')
    expect(source).toContain('channelType: event.action.channelType')
  })
})

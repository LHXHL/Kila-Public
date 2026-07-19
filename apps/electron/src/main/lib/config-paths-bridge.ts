/**
 * IM Bridge 路径工具
 *
 * 管理 IM Bridge 的配置、绑定、附件和审计日志路径。
 * 从 config-paths.ts 中按领域拆出。
 */

import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { getConfigDir } from './config-paths'

export function getImBridgeDir(): string {
  const dir = join(getConfigDir(), 'im-bridge')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getImBridgeConfigPath(): string {
  return join(getImBridgeDir(), 'config.json')
}

export function getImBridgeBindingsPath(): string {
  return join(getImBridgeDir(), 'bindings.json')
}

export function getImBridgeRuntimePath(): string {
  return join(getImBridgeDir(), 'runtime.json')
}

export function getImBridgeFilesDir(): string {
  const dir = join(getImBridgeDir(), 'files')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getImBridgeSessionFilesDir(sessionId: string): string {
  const dir = join(getImBridgeFilesDir(), sessionId)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getImBridgeAuditDir(): string {
  const dir = join(getImBridgeDir(), 'audit')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getImBridgeWechatDir(): string {
  const dir = join(getImBridgeDir(), 'wechat')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

export function getImBridgeWechatAccountsPath(): string {
  return join(getImBridgeWechatDir(), 'accounts.json')
}

export function getImBridgeWechatCredentialsPath(): string {
  return join(getImBridgeWechatDir(), 'credentials.json')
}

export function getImBridgeWechatContextsPath(): string {
  return join(getImBridgeWechatDir(), 'contexts.json')
}

export function getImBridgeWechatDeferredOutboundPath(): string {
  return join(getImBridgeWechatDir(), 'deferred-outbound.json')
}

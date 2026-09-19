import type { ErrorCode, TypedError } from '@kila/shared'

interface RuntimeErrorMetadata {
  title: string
  action: string
  canRetry: boolean
}

const RUNTIME_ERROR_METADATA: Partial<Record<ErrorCode, RuntimeErrorMetadata>> = {
  runtime_start_failed: { title: 'Agent Runtime 启动失败', action: '重试', canRetry: true },
  runtime_handshake_failed: { title: 'Runtime 握手失败', action: '重试或重启应用', canRetry: true },
  runtime_protocol_mismatch: { title: 'Runtime 版本不兼容', action: '更新或重装应用', canRetry: false },
  runtime_protocol_desync: { title: 'Runtime 通信失步', action: '重试', canRetry: true },
  runtime_protocol_payload_too_large: { title: 'Runtime 数据超限', action: '减少附件或新建会话', canRetry: false },
  runtime_crashed: { title: 'Agent Runtime 已崩溃', action: '检查副作用后重试', canRetry: true },
  runtime_unresponsive: { title: 'Agent Runtime 无响应', action: '检查副作用后重试', canRetry: true },
  runtime_resource_exhausted: { title: 'Agent Runtime 内存超限', action: '缩短会话或压缩后重试', canRetry: true },
  runtime_capacity_queued: { title: '正在等待运行资源', action: '等待或停止其他任务', canRetry: true },
  runtime_sidecar_locked: { title: '会话运行状态被占用', action: '等待或重启应用', canRetry: true },
  runtime_sidecar_dirty: { title: '会话运行状态需要恢复', action: '安全重建后重试', canRetry: true },
  runtime_sidecar_corrupt: { title: '会话运行状态损坏', action: '使用显式恢复', canRetry: false },
  runtime_transfer_missing: { title: 'Runtime 输入已丢失', action: '重试', canRetry: true },
  runtime_transfer_invalid_path: { title: 'Runtime 输入路径非法', action: '报告问题', canRetry: false },
  runtime_transfer_hash_mismatch: { title: 'Runtime 输入校验失败', action: '重试或检查磁盘', canRetry: false },
  runtime_transfer_too_large: { title: 'Runtime 输入过大', action: '减少附件或历史', canRetry: false },
  runtime_transfer_expired: { title: 'Runtime 输入已过期', action: '重试', canRetry: true },
  runtime_transfer_invalid_manifest: { title: 'Runtime 输入清单损坏', action: '重试或报告问题', canRetry: false },
  runtime_config_changed_while_active: { title: '运行中不能切换配置', action: '停止后重试', canRetry: true },
  runtime_stale_config_revision: { title: 'Runtime 配置已过期', action: '重试', canRetry: true },
  runtime_config_revision_conflict: { title: 'Runtime 配置冲突', action: '重启应用', canRetry: false },
  tool_update_consumer_stalled: { title: '工具输出传输阻塞', action: '检查命令后重试', canRetry: true },
}

export function isRuntimeErrorCode(code: ErrorCode): boolean {
  return Boolean(RUNTIME_ERROR_METADATA[code])
}

export function createRuntimeTypedError(
  code: ErrorCode,
  message: string,
  details?: string[],
): TypedError {
  const metadata = RUNTIME_ERROR_METADATA[code]
  if (!metadata) {
    throw new Error(`不是 Runtime error code: ${code}`)
  }
  return {
    code,
    title: metadata.title,
    message,
    actions: [
      { key: 'r', label: metadata.action, action: metadata.canRetry ? 'retry' : 'settings' },
    ],
    canRetry: metadata.canRetry,
    retryDelayMs: metadata.canRetry ? 1000 : undefined,
    details,
    originalError: message,
  }
}

/** 将 Supervisor/transfer 层的带 code 错误统一收敛为 UI 可识别的 Runtime error。 */
export function createRuntimeTypedErrorFromUnknown(error: unknown): TypedError {
  const message = error instanceof Error ? error.message : String(error)
  const matched = /^([a-z0-9_]+):\s*(.*)$/s.exec(message)
  const code = matched?.[1] as ErrorCode | undefined
  if (code && isRuntimeErrorCode(code)) {
    return createRuntimeTypedError(code, matched?.[2] || message)
  }
  return createRuntimeTypedError('runtime_start_failed', message)
}

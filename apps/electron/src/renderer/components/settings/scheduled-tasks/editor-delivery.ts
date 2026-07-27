/**
 * 定时任务编辑器的投递与结果校验工具
 *
 * 编辑器把「投递目标」和「结果校验规则」当成可增删的集合来维护，
 * 相关的纯函数集中放在这里。
 */

import type {
  BridgeBinding,
  ScheduledTaskDelivery,
  ScheduledTaskResultVerifier,
} from '@kila/shared'
import type { TFunction } from 'i18next'

export interface DeliveryTarget {
  endpointKey: string
  channelType: BridgeBinding['channelType']
}

export function getDeliveryTargets(delivery: ScheduledTaskDelivery): DeliveryTarget[] {
  if (delivery.kind === 'bridge_binding') {
    return [{ endpointKey: delivery.endpointKey, channelType: delivery.channelType }]
  }
  if (delivery.kind === 'bridge_bindings') {
    return delivery.targets
  }
  return []
}

export function setDeliveryTarget(
  delivery: ScheduledTaskDelivery,
  binding: BridgeBinding,
  enabled: boolean,
): ScheduledTaskDelivery {
  const nextTargets = getDeliveryTargets(delivery)
    .filter((target) => target.endpointKey !== binding.endpointKey)
  if (enabled) {
    nextTargets.push({
      endpointKey: binding.endpointKey,
      channelType: binding.channelType,
    })
  }
  if (nextTargets.length === 0) return { kind: 'none' }
  return {
    kind: 'bridge_bindings',
    targets: nextTargets,
    failurePolicy: delivery.kind === 'bridge_bindings' ? delivery.failurePolicy : 'all',
  }
}

/** 摘要里的投递描述：单目标显示绑定名，多目标显示数量 */
export function describeEditorDelivery(
  t: TFunction,
  delivery: ScheduledTaskDelivery,
  bindings: BridgeBinding[],
): string {
  if (delivery.kind === 'none') return t('settingsTasks.delivery.none')
  const targets = getDeliveryTargets(delivery)
  if (targets.length === 0) return t('settingsTasks.delivery.none')
  if (targets.length === 1) {
    const target = targets[0]!
    const binding = bindings.find((item) => item.endpointKey === target.endpointKey)
    return binding
      ? `${binding.displayName || binding.endpointKey} · ${binding.channelType}`
      : `${target.endpointKey} · ${target.channelType}`
  }
  return t('settingsTasks.delivery.multipleTargets', { count: targets.length })
}

export function hasVerifier(
  verifiers: ScheduledTaskResultVerifier[],
  kind: ScheduledTaskResultVerifier['kind'],
): boolean {
  return verifiers.some((verifier) => verifier.kind === kind)
}

export function readFileVerifierPath(verifiers: ScheduledTaskResultVerifier[]): string {
  const verifier = verifiers.find((item) => item.kind === 'file_exists')
  return verifier?.kind === 'file_exists' ? verifier.path : ''
}

/** 摘要里的校验规则描述，规则名是代码标识符，不做翻译 */
export function describeVerifiers(t: TFunction, verifiers: ScheduledTaskResultVerifier[]): string {
  if (verifiers.length === 0) return t('settingsTasks.editor.noVerifier')
  return verifiers.map((verifier) => {
    switch (verifier.kind) {
      case 'reply_non_empty':
        return 'reply'
      case 'bridge_delivery_success':
        return 'bridge'
      case 'file_exists':
        return `file:${verifier.path}`
    }
  }).join(' · ')
}

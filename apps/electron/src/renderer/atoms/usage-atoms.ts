/**
 * Token 用量格式化工具
 *
 * 原先的会话用量快照链（sessionUsageSnapshotsAtom / syncUsageSnapshotAtom /
 * currentSessionUsageAtom / contextUsagePercentAtom）唯一消费方 SessionUsageBadge 已移除，
 * 快照同步在每次流式 flush 都做整表复制却无人读取，因此整链删除。
 * 上下文用量展示由 composer 的 ContextUsageIndicator 经 agentContextStatusAtomFamily 承担。
 */

/** 格式化 token 数量为人类可读字符串 */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

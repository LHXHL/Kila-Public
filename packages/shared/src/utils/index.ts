/**
 * Shared utility functions for kila
 */

// Placeholder - will be expanded as needed
export function noop(): void {
  // no-op
}

export { diffCapabilities } from './capabilities-diff'
export type { CapabilityChange } from './capabilities-diff'
export {
  mapChannelProviderToPiProvider,
  resolveModelCapabilities,
} from './resolve-model-capabilities'
export type {
  CapabilitySource,
  ModelCapabilities,
  ResolveModelCapabilitiesInput,
} from './resolve-model-capabilities'
export {
  capabilitiesToMetadataOverride,
  getAllModels,
  lookupModel,
  matchModelById,
  mergeModelMetadataOverride,
  normalizeModelMetadataOverride,
  resolveModelMetadata,
} from '../model-catalog'
export type {
  AbilityStatus,
  MetadataResolutionSource,
  ModelAbilities,
  ModelCatalogEntry,
  ModelMetadata,
  ModelPricing,
  ResolveModelMetadataInput,
  ResolvedModelMetadata,
} from '../model-catalog'
export {
  CODEX_GPT_54_55_CONTEXT_WINDOW,
  CODEX_GPT_54_MINI_CONTEXT_WINDOW,
  CODEX_GPT_56_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  inferCodexAlignedGPT5ContextWindow,
  inferContextWindow,
  supports1MContext,
} from './context-window'
export {
  buildSessionContextSnapshot,
  estimateSessionContext,
} from './estimate-session-context'
export type {
  EstimateSessionContextInput,
  SessionContextCalibrationSnapshot,
  SessionContextEstimate,
  SessionContextSnapshot,
  SessionContextSnapshotSegmentSummary,
} from './estimate-session-context'
export {
  buildSessionTurnReplayPlan,
  buildAssistantTurnReplayPlan,
  createOptimisticReplayUserMessage,
} from './session-turn-replay'
export type { AssistantTurnReplayPlan, SessionTurnReplayPlan } from './session-turn-replay'
export {
  legacyAgentMessageToSessionMessage,
  sessionMessageToLegacyAgentMessage,
  withLegacyAttachedFilesBlock,
} from './legacy-session-adapters'
export { compactAgentEventsForPersistence } from './agent-events-compact'
export {
  getThinkingBudgetTokens,
  isThinkingLevelEnabled,
  resolveThinkingConfig,
  resolveThinkingLevel,
  thinkingLevelToLegacyAgentSettings,
} from './thinking-level'
export type { ResolvedThinkingConfig } from './thinking-level'
export {
  buildGlobalSkillMentionId,
  parseGlobalSkillMentionId,
  formatGlobalSkillMentionLabel,
} from './global-skill-mention'
export type { ParsedGlobalSkillMention } from './global-skill-mention'

// Typed IPC utilities
export { typedHandle, typedInvoke, buildTypedApi } from './typed-ipc'

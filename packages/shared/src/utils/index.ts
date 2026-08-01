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

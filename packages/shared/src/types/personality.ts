export type PersonalityDocKind = 'soul' | 'user'

export type UserProfileAutomationSection = 'inferredProfile' | 'openQuestions'

export interface UserProfileAutomationState {
  path: string
  locked: boolean
  sections: Record<UserProfileAutomationSection, { locked: boolean }>
  updatedAt?: number
  lastAppliedAt?: number
  lastSource?: 'memory'
  inferredProfile: string
  openQuestions: string
}

export interface PersonalityDocument {
  kind: PersonalityDocKind
  path: string
  content: string
}

export interface PersonalityState {
  soul: PersonalityDocument
  user: PersonalityDocument
  userProfileAutomation: UserProfileAutomationState
  legacyPromptArchivePath?: string
}

export interface PersonalityUpdateInput {
  kind: PersonalityDocKind
  content: string
}

export const PERSONALITY_IPC_CHANNELS = {
  GET_STATE: 'personality:get-state',
  UPDATE: 'personality:update',
  RESET: 'personality:reset',
  OPEN_PATH: 'personality:open-path',
} as const

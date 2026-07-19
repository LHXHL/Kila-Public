/**
 * 全局 Personality IPC 处理器
 */

import { PERSONALITY_IPC_CHANNELS } from '@kila/shared'
import type { PersonalityState, PersonalityDocument, PersonalityDocKind, PersonalityUpdateInput } from '@kila/shared'
import { handle } from './shared'
import {
  getPersonalityState,
  openPersonalityPath,
  resetPersonality,
  updatePersonality,
} from '../lib/personality-manager'

export function registerPersonalityHandlers(): void {
  handle(
    PERSONALITY_IPC_CHANNELS.GET_STATE,
    async (): Promise<PersonalityState> => {
      return getPersonalityState()
    }
  )

  handle(
    PERSONALITY_IPC_CHANNELS.UPDATE,
    async (_, input: PersonalityUpdateInput): Promise<PersonalityDocument> => {
      return updatePersonality(input)
    }
  )

  handle(
    PERSONALITY_IPC_CHANNELS.RESET,
    async (_, kind: PersonalityDocKind): Promise<PersonalityDocument> => {
      return resetPersonality(kind)
    }
  )

  handle(
    PERSONALITY_IPC_CHANNELS.OPEN_PATH,
    async (_, kind: PersonalityDocKind): Promise<void> => {
      return openPersonalityPath(kind)
    }
  )
}

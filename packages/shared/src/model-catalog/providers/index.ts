import { ANTHROPIC_MODELS } from './anthropic'
import { DEEPSEEK_MODELS } from './deepseek'
import { GOOGLE_MODELS } from './google'
import { MINIMAX_MODELS } from './minimax'
import { OPENAI_MODELS } from './openai'
import { XIAOMI_MIMO_MODELS } from './xiaomimimo'
import { ZHIPU_MODELS } from './zhipu'

export const BUILTIN_MODEL_CATALOG = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GOOGLE_MODELS,
  ...DEEPSEEK_MODELS,
  ...ZHIPU_MODELS,
  ...MINIMAX_MODELS,
  ...XIAOMI_MIMO_MODELS,
] as const

export {
  ANTHROPIC_MODELS,
  DEEPSEEK_MODELS,
  GOOGLE_MODELS,
  MINIMAX_MODELS,
  OPENAI_MODELS,
  XIAOMI_MIMO_MODELS,
  ZHIPU_MODELS,
}

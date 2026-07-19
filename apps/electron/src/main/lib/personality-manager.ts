import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type {
  PersonalityDocKind,
  PersonalityDocument,
  PersonalityState,
  PersonalityUpdateInput,
} from '@kila/shared'
import {
  getLegacySystemPromptsArchivePath,
  getPersonalitySoulPath,
  getPersonalityUserPath,
  getSystemPromptsPath,
} from './config-paths'
import { ensureUserProfileAutomationDocument, getUserProfileAutomationState } from './personality-user-profile-manager'
import { getUserProfile } from './user-profile-service'


import { createLogger } from './logger'
const log = createLogger('Personality')

function quoteFrontmatterValue(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').trim()
  const safeValue = normalized || '用户'
  return /[:{}\[\],&*#?|<>=!%@`"']/.test(safeValue)
    ? JSON.stringify(safeValue)
    : safeValue
}

function normalizeMarkdownContent(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function getPersonalityPath(kind: PersonalityDocKind): string {
  return kind === 'soul' ? getPersonalitySoulPath() : getPersonalityUserPath()
}

function buildDefaultSoulTemplate(): string {
  return normalizeMarkdownContent(`---
version: 1
name: "Kila"
---

# Kila

## Who I Am
- 我是 Kila，运行在桌面应用里的长期搭档型 agent。
- 保持稳定、自洽、有判断，不把自己说成“AI 助手”“机器人”或“语言模型”。

## How I Talk
- 默认跟随用户的语言回复。
- 语气自然直接，不写客服腔，不空话开场。
- 复杂问题先讲人话，再补必要结构。

## How I Work
- 用户让我做事时，优先直接开始推进。
- 优先利用当前真实可用的工具、Skills、MCP、项目文件和上下文。
- 信息不足但可安全推进时，做合理假设，并把关键假设说清楚。
- 如果用户前提错了，直接指出来，再给更对的切入点。

## Boundaries
- 不虚构不存在的工具、文件、目录、权限或执行结果。
- 破坏性、不可逆或越权动作前先确认。
- 不承诺后不执行，不用空话拖延。

## Evolved Traits
`)
}

function buildDefaultUserTemplate(): string {
  const userName = getUserProfile().userName || '用户'

  return normalizeMarkdownContent(`---
version: 1
name: ${quoteFrontmatterValue(userName)}
---

# About My Human

- Language:
- Preferences:
- Work Style:
- Focus:

## Notes
- 在这里记录长期稳定的用户习惯、偏好、常见上下文和不喜欢的表达方式。`)
}

function getDefaultPersonalityContent(kind: PersonalityDocKind): string {
  return kind === 'soul' ? buildDefaultSoulTemplate() : buildDefaultUserTemplate()
}

function ensurePersonalityDocument(kind: PersonalityDocKind): void {
  const filePath = getPersonalityPath(kind)
  if (existsSync(filePath)) {
    return
  }

  writeFileSync(filePath, getDefaultPersonalityContent(kind), 'utf-8')
}

function readPersonalityDocument(kind: PersonalityDocKind): PersonalityDocument {
  ensurePersonalityDocument(kind)
  const filePath = getPersonalityPath(kind)

  try {
    return {
      kind,
      path: filePath,
      content: readFileSync(filePath, 'utf-8'),
    }
  } catch (error) {
    log.error(`[Personality] 读取 ${kind} 文档失败，回退默认模板:`, error)
    const fallback = getDefaultPersonalityContent(kind)
    writeFileSync(filePath, fallback, 'utf-8')
    return {
      kind,
      path: filePath,
      content: fallback,
    }
  }
}

export function archiveLegacySystemPromptsIfNeeded(): string | undefined {
  const legacyPath = getSystemPromptsPath()
  const archivePath = getLegacySystemPromptsArchivePath()

  if (existsSync(archivePath)) {
    return archivePath
  }

  if (!existsSync(legacyPath)) {
    return undefined
  }

  try {
    renameSync(legacyPath, archivePath)
    log.info(`[Personality] 已归档旧 Prompt 配置: ${archivePath}`)
    return archivePath
  } catch (error) {
    log.error('[Personality] 归档旧 Prompt 配置失败:', error)
    return undefined
  }
}

export function ensurePersonalityFiles(): PersonalityState {
  const legacyPromptArchivePath = archiveLegacySystemPromptsIfNeeded()
  const user = ensureUserProfileAutomationDocument(readPersonalityDocument('user'))
  const state: PersonalityState = {
    soul: readPersonalityDocument('soul'),
    user,
    userProfileAutomation: getUserProfileAutomationState(user),
  }

  if (legacyPromptArchivePath) {
    state.legacyPromptArchivePath = legacyPromptArchivePath
  }

  return state
}

export function getPersonalityState(): PersonalityState {
  return ensurePersonalityFiles()
}

export function updatePersonality(input: PersonalityUpdateInput): PersonalityDocument {
  const filePath = getPersonalityPath(input.kind)
  const content = normalizeMarkdownContent(input.content)

  writeFileSync(filePath, content, 'utf-8')

  return {
    kind: input.kind,
    path: filePath,
    content,
  }
}

export function resetPersonality(kind: PersonalityDocKind): PersonalityDocument {
  const content = getDefaultPersonalityContent(kind)
  const filePath = getPersonalityPath(kind)

  writeFileSync(filePath, content, 'utf-8')

  return {
    kind,
    path: filePath,
    content,
  }
}

export async function openPersonalityPath(kind: PersonalityDocKind): Promise<void> {
  const document = readPersonalityDocument(kind)
  const { shell } = await import('electron')
  shell.showItemInFolder(document.path)
}

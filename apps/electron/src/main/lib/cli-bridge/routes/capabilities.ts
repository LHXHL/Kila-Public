import type { ServerResponse } from 'node:http'
import { sendJson } from '../http'
import {
  getAllGlobalAgentCapabilities,
  getAllGlobalAgentSkills,
  toggleGlobalAgentMcpServer,
  toggleGlobalAgentSkill,
} from '../../global-agent-config-manager'

export function handleCliBridgeCapabilities(response: ServerResponse): void {
  sendJson(response, 200, getAllGlobalAgentCapabilities())
}

export function handleCliBridgeToggleMcpServer(
  response: ServerResponse,
  serverName: string,
  enabled: boolean,
): void {
  sendJson(response, 200, {
    server: toggleGlobalAgentMcpServer(serverName, enabled),
  })
}

export function handleCliBridgeToggleSkill(
  response: ServerResponse,
  skillSlug: string,
  enabled: boolean,
): void {
  const currentSkill = getAllGlobalAgentSkills().find((skill) => skill.slug === skillSlug)
  if (!currentSkill) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  if (currentSkill.enabled !== enabled) {
    toggleGlobalAgentSkill(skillSlug, enabled)
  }

  const updatedSkill = getAllGlobalAgentSkills().find((skill) => skill.slug === skillSlug)
  if (!updatedSkill) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }

  sendJson(response, 200, {
    skill: updatedSkill,
  })
}

import { connectToBridgeOrThrow } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag } from '../args'
import { printHint, withHint } from '../format/hints'
import { printJson } from '../format/json-output'
import { formatTable, truncate } from '../format/tables'

export async function runChannelsCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const channels = (await client.listChannels()).channels

  if (asJson) {
    printJson({ channels })
    return 0
  }

  const table = formatTable(
    ['ID', 'NAME', 'PROVIDER', 'ENABLED', 'MODELS'],
    channels.map((channel) => [
      channel.id.slice(0, 8),
      truncate(channel.name, 24),
      channel.provider,
      channel.enabled ? 'yes' : 'no',
      String(channel.models.filter((model) => model.enabled).length),
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('运行 `kila mcp enable <name>` 或 `kila mcp disable <name>` 修改全局 MCP 状态')
  return 0
}

export async function runMcpListCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const capabilities = await client.getCapabilities()

  if (asJson) {
    printJson({ mcpServers: capabilities.mcpServers })
    return 0
  }

  const table = formatTable(
    ['NAME', 'TYPE', 'ENABLED'],
    capabilities.mcpServers.map((server) => [
      truncate(server.name, 32),
      server.type,
      server.enabled ? 'yes' : 'no',
    ]),
  )
  process.stdout.write(`${table}\n`)
  return 0
}

async function runToggleMcpCommand(
  enabled: boolean,
  args: ParsedArgs,
): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const reference = args.positionals[0]
  if (!reference) {
    throw new Error(withHint(
      '缺少 MCP server 名称。',
      '`kila mcp list` 查看可用 MCP',
    ))
  }

  const serverName = await client.resolveMcpServerName(reference)
  const response = await client.toggleMcpServer(serverName, enabled)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] ${enabled ? 'enabled' : 'disabled'} MCP server ${response.server.name}\n`)
  return 0
}

export async function runSkillsListCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const capabilities = await client.getCapabilities()

  if (asJson) {
    printJson({ skills: capabilities.skills })
    return 0
  }

  const table = formatTable(
    ['SLUG', 'NAME', 'ENABLED'],
    capabilities.skills.map((skill) => [
      truncate(skill.slug, 28),
      truncate(skill.name, 28),
      skill.enabled ? 'yes' : 'no',
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('运行 `kila skills enable <slug>` 或 `kila skills disable <slug>` 修改全局 Skill 状态')
  return 0
}

async function runToggleSkillCommand(
  enabled: boolean,
  args: ParsedArgs,
): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const reference = args.positionals[0]
  if (!reference) {
    throw new Error(withHint(
      '缺少 skill slug 或名称。',
      '`kila skills list` 查看可用 Skills',
    ))
  }

  const skillSlug = await client.resolveSkillSlug(reference)
  const response = await client.toggleSkill(skillSlug, enabled)

  if (asJson) {
    printJson(response)
    return 0
  }

  process.stdout.write(`[kila] ${enabled ? 'enabled' : 'disabled'} skill ${response.skill.slug}\n`)
  return 0
}

export function runMcpEnableCommand(args: ParsedArgs): Promise<number> {
  return runToggleMcpCommand(true, args)
}

export function runMcpDisableCommand(args: ParsedArgs): Promise<number> {
  return runToggleMcpCommand(false, args)
}

export function runSkillEnableCommand(args: ParsedArgs): Promise<number> {
  return runToggleSkillCommand(true, args)
}

export function runSkillDisableCommand(args: ParsedArgs): Promise<number> {
  return runToggleSkillCommand(false, args)
}

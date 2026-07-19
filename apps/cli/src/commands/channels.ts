import { connectToBridgeOrThrow } from '../client/bridge-client'
import type { ParsedArgs } from '../args'
import { getBooleanFlag } from '../args'
import { printHint, withHint } from '../format/hints'
import { printJson } from '../format/json-output'
import { formatTable, truncate } from '../format/tables'

export async function runProvidersCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const response = await client.listProviders()

  if (asJson) {
    printJson(response)
    return 0
  }

  const table = formatTable(
    ['PROVIDER', 'LABEL', 'CHANNELS', 'ENABLED', 'MODELS'],
    response.providers.map((provider) => [
      provider.provider,
      truncate(provider.label, 24),
      String(provider.channelCount),
      String(provider.enabledChannelCount),
      `${provider.enabledModelCount}/${provider.modelCount}`,
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('运行 `kila channel show <id>` 查看详情，或 `kila channel models <id>` 查看模型')
  return 0
}

export async function runChannelShowCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const channelRef = args.positionals[0]
  if (!channelRef) {
    throw new Error(withHint(
      '缺少 channel id 或名称。',
      '`kila channels` 查看可用渠道',
    ))
  }

  const channelId = await client.resolveChannelId(channelRef)
  const response = await client.getChannel(channelId)

  if (asJson) {
    printJson(response)
    return 0
  }

  const { channel } = response
  process.stdout.write(`ID: ${channel.id}\n`)
  process.stdout.write(`Name: ${channel.name}\n`)
  process.stdout.write(`Provider: ${channel.provider}\n`)
  process.stdout.write(`Base URL: ${channel.baseUrl}\n`)
  process.stdout.write(`Enabled: ${channel.enabled ? 'yes' : 'no'}\n`)
  process.stdout.write(`Models: ${channel.enabledModelCount}/${channel.models.length}\n`)
  printHint(`运行 \`kila channel models ${channel.id}\` 查看该渠道下的模型`)
  return 0
}

export async function runChannelModelsCommand(args: ParsedArgs): Promise<number> {
  const client = await connectToBridgeOrThrow()
  const asJson = getBooleanFlag(args, 'json')
  const channelRef = args.positionals[0]
  if (!channelRef) {
    throw new Error(withHint(
      '缺少 channel id 或名称。',
      '`kila channels` 查看可用渠道',
    ))
  }

  const channelId = await client.resolveChannelId(channelRef)
  const response = await client.listChannelModels(channelId)

  if (asJson) {
    printJson(response)
    return 0
  }

  const table = formatTable(
    ['MODEL ID', 'NAME', 'ENABLED'],
    response.models.map((model) => [
      truncate(model.id, 40),
      truncate(model.name, 32),
      model.enabled ? 'yes' : 'no',
    ]),
  )
  process.stdout.write(`${table}\n`)
  printHint('配合 `kila run --channel <id> --model <model-id>` 使用')
  return 0
}

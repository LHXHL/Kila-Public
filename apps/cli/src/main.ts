#!/usr/bin/env node

import { parseArgs } from './args'

const HELP_TEXT = `Usage:
  kila status [--json]
  kila version [--json]
  kila doctor [--json]
  kila run [prompt] [--session <id>] [--resume [<id>]] [--cwd <path>] [--channel <id-or-name>] [--model <modelId>] [--permission-mode <mode>] [--json] [--no-stream] [--verbose]
  kila sessions [--limit <n>] [--json]
  kila session create [--title <title>] [--cwd <path>] [--channel <id-or-name>] [--model <modelId>] [--json]
  kila session show <id-or-prefix> [--json]
  kila session messages <id-or-prefix> [--limit <n>] [--json]
  kila session switch <id-or-prefix> [--json]
  kila session stop <id-or-prefix> [--json]
  kila session rename <id-or-prefix> <title> [--json]
  kila session update <id-or-prefix> [--channel <id-or-name>] [--model <modelId>] [--thinking <level>] [--history <turns|infinite>] [--json]
  kila session delete <id-or-prefix> --yes [--json]
  kila channels [--json]
  kila channel show <id-or-name> [--json]
  kila channel models <id-or-name> [--json]
  kila providers [--json]
  kila config list
  kila config get <path> [--json]
  kila config set <path> <value> [--json] [--json-value] [--file <path>]
  kila mcp list [--json]
  kila mcp enable <name> [--json]
  kila mcp disable <name> [--json]
  kila skills list [--json]
  kila skills enable <slug-or-name> [--json]
  kila skills disable <slug-or-name> [--json]
  kila task list [--json]
  kila task show <id-or-prefix> [--json]
  kila task create --name <name> (--prompt <text> | --prompt-file <path>) --channel <id-or-name> (--session <id> | --cwd <path>) (--at <iso> | --every <minutes> | --cron <expr> | --loop) [--model <modelId>] [--json]
  kila task update <id-or-prefix> [patch flags...] [--json]
  kila task start <id-or-prefix> [--json]
  kila task stop <id-or-prefix> [--json]
  kila task run <id-or-prefix> [--json]
  kila task history <id-or-prefix> [--limit <n>] [--json]
  kila task delete <id-or-prefix> --yes [--json]
  kila task runtime [--json]
  kila report daily [--date <YYYY-MM-DD>] [--json]
  kila soul [--json]
  kila soul set (--file <path> | --stdin) [--json]
  kila user [--json]
  kila user set (--file <path> | --stdin) [--json]
  kila completion <bash|zsh|fish>`

function compactArgs(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

async function run(): Promise<number> {
  const argv = process.argv.slice(2)
  const [command, subcommand, ...rest] = argv

  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(`${HELP_TEXT}\n`)
    return command ? 0 : 1
  }

    const dispatch = await import('./main_dispatch')

  switch (command) {
    case 'status':
      return dispatch.runStatusCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'version':
      return dispatch.runVersionCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'doctor':
      return dispatch.runDoctorCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'run':
      return dispatch.runRunCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'sessions':
      return dispatch.runSessionsCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'session':
      if (subcommand === 'create') {
        return dispatch.runSessionCreateCommand(parseArgs(rest))
      }
      if (subcommand === 'show') {
        return dispatch.runSessionShowCommand(parseArgs(rest))
      }
      if (subcommand === 'messages') {
        return dispatch.runSessionMessagesCommand(parseArgs(rest))
      }
      if (subcommand === 'switch') {
        return dispatch.runSessionSwitchCommand(parseArgs(rest))
      }
      if (subcommand === 'stop') {
        return dispatch.runSessionStopCommand(parseArgs(rest))
      }
      if (subcommand === 'rename') {
        return dispatch.runSessionRenameCommand(parseArgs(rest))
      }
      if (subcommand === 'update') {
        return dispatch.runSessionUpdateCommand(parseArgs(rest))
      }
      if (subcommand === 'delete') {
        return dispatch.runSessionDeleteCommand(parseArgs(rest))
      }
      throw new Error(`未知 session 子命令: ${subcommand ?? '(missing)'}`)
    case 'channels':
      return dispatch.runChannelsCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'channel':
      if (subcommand === 'show') {
        return dispatch.runChannelShowCommand(parseArgs(rest))
      }
      if (subcommand === 'models') {
        return dispatch.runChannelModelsCommand(parseArgs(rest))
      }
      throw new Error(`未知 channel 子命令: ${subcommand ?? '(missing)'}`)
    case 'providers':
      return dispatch.runProvidersCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'config':
      if (subcommand === 'list') {
        return dispatch.runConfigListCommand(parseArgs(rest))
      }
      if (subcommand === 'get') {
        return dispatch.runConfigGetCommand(parseArgs(rest))
      }
      if (subcommand === 'set') {
        return dispatch.runConfigSetCommand(parseArgs(rest))
      }
      throw new Error(`未知 config 子命令: ${subcommand ?? '(missing)'}`)
    case 'mcp':
      if (subcommand === 'list') {
        return dispatch.runMcpListCommand(parseArgs(rest))
      }
      if (subcommand === 'enable') {
        return dispatch.runMcpEnableCommand(parseArgs(rest))
      }
      if (subcommand === 'disable') {
        return dispatch.runMcpDisableCommand(parseArgs(rest))
      }
      throw new Error(`未知 mcp 子命令: ${subcommand ?? '(missing)'}`)
    case 'skills':
      if (subcommand === 'list') {
        return dispatch.runSkillsListCommand(parseArgs(rest))
      }
      if (subcommand === 'enable') {
        return dispatch.runSkillEnableCommand(parseArgs(rest))
      }
      if (subcommand === 'disable') {
        return dispatch.runSkillDisableCommand(parseArgs(rest))
      }
      throw new Error(`未知 skills 子命令: ${subcommand ?? '(missing)'}`)
    case 'task':
      if (subcommand === 'list') {
        return dispatch.runTaskListCommand(parseArgs(rest))
      }
      if (subcommand === 'show') {
        return dispatch.runTaskShowCommand(parseArgs(rest))
      }
      if (subcommand === 'create') {
        return dispatch.runTaskCreateCommand(parseArgs(rest))
      }
      if (subcommand === 'update') {
        return dispatch.runTaskUpdateCommand(parseArgs(rest))
      }
      if (subcommand === 'start') {
        return dispatch.runTaskStartCommand(parseArgs(rest))
      }
      if (subcommand === 'stop') {
        return dispatch.runTaskStopCommand(parseArgs(rest))
      }
      if (subcommand === 'run') {
        return dispatch.runTaskRunCommand(parseArgs(rest))
      }
      if (subcommand === 'history') {
        return dispatch.runTaskHistoryCommand(parseArgs(rest))
      }
      if (subcommand === 'delete') {
        return dispatch.runTaskDeleteCommand(parseArgs(rest))
      }
      if (subcommand === 'runtime') {
        return dispatch.runTaskRuntimeCommand(parseArgs(rest))
      }
      throw new Error(`未知 task 子命令: ${subcommand ?? '(missing)'}`)
    case 'report':
      if (subcommand === 'daily') {
        return dispatch.runReportDailyCommand(parseArgs(rest))
      }
      throw new Error(`未知 report 子命令: ${subcommand ?? '(missing)'}`)
    case 'soul':
      if (subcommand === 'set') {
        return dispatch.runSoulSetCommand(parseArgs(rest))
      }
      return dispatch.runSoulCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'user':
      if (subcommand === 'set') {
        return dispatch.runUserSetCommand(parseArgs(rest))
      }
      return dispatch.runUserCommand(parseArgs(compactArgs([subcommand, ...rest])))
    case 'completion':
      return dispatch.runCompletionCommand(parseArgs(compactArgs([subcommand, ...rest])))
    default:
      throw new Error(`未知命令: ${command}`)
  }
}

run()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })

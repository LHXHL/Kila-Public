import type { ParsedArgs } from '../args'

const TOP_LEVEL_COMMANDS = [
  'status',
  'version',
  'doctor',
  'run',
  'sessions',
  'session',
  'channels',
  'channel',
  'providers',
  'config',
  'mcp',
  'skills',
  'task',
  'report',
  'soul',
  'user',
  'completion',
]

function renderBashCompletion(): string {
  return `# bash completion for kila
_kila() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words=("\${COMP_WORDS[@]}")
  cword="\${COMP_CWORD}"

  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${TOP_LEVEL_COMMANDS.join(' ')}" -- "$cur") )
    return 0
  fi

  case "\${words[1]}" in
    status|version|doctor|channels|providers)
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      return 0
      ;;
    config)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list get set" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--json --json-value --file" -- "$cur") )
      return 0
      ;;
    sessions)
      COMPREPLY=( $(compgen -W "--limit --json" -- "$cur") )
      return 0
      ;;
    session)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "create show messages switch stop rename delete" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--limit --title --cwd --channel --model --yes --json" -- "$cur") )
      return 0
      ;;
    channel)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "show models" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      return 0
      ;;
    run)
      COMPREPLY=( $(compgen -W "--session --resume --cwd --channel --model --permission-mode --json --no-stream --verbose" -- "$cur") )
      return 0
      ;;
    mcp)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list enable disable" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      return 0
      ;;
    skills)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list enable disable" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      return 0
      ;;
    task)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list show create update start stop run history delete runtime" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--json --name --prompt --prompt-file --channel --session --cwd --at --every --cron --loop --model --thinking --history-turns --tools --dirs --verify --permission-mode --bridge-target --bridge-targets --bridge-endpoint --bridge-channel --bridge-failure-policy --ai-can-exit --notify-missed --limit --yes" -- "$cur") )
      return 0
      ;;
    report)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "daily" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--date --json" -- "$cur") )
      return 0
      ;;
    soul|user)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "set --json" -- "$cur") )
        return 0
      fi
      if [[ "\${words[2]}" == "set" ]]; then
        COMPREPLY=( $(compgen -W "--file --stdin --json" -- "$cur") )
        return 0
      fi
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      return 0
      ;;
  esac
}

complete -F _kila kila
`
}

function renderZshCompletion(): string {
  return `#compdef kila

local -a top_level_commands
top_level_commands=(
  'status:Show bridge status'
  'version:Show CLI and app version'
  'doctor:Run diagnostics'
  'run:Run a prompt through the desktop runtime'
  'sessions:List recent sessions'
  'session:Session subcommands'
  'channels:List channels'
  'channel:Inspect a channel'
  'providers:List provider coverage'
  'config:Read or write app settings'
  'mcp:MCP subcommands'
  'skills:Skill subcommands'
  'task:Scheduled task subcommands'
  'report:Reporting subcommands'
  'soul:Read or write SOUL.md'
  'user:Read or write USER.md'
  'completion:Print shell completion'
)

if (( CURRENT == 2 )); then
  _describe -t commands 'kila commands' top_level_commands
  return
fi

case "\${words[2]}" in
  status|version|doctor|channels|providers)
    _arguments '--json[Output JSON]'
    ;;
  config)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'config commands' 'list:List config' 'get:Get config value' 'set:Set config value'
      return
    fi
    _arguments '--json[Output JSON]' '--json-value[Treat value as JSON]' '--file[Read config value from file]:file:_files'
    ;;
  sessions)
    _arguments '--limit[Maximum sessions to return]:limit:' '--json[Output JSON]'
    ;;
  session)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'session commands' \
        'create:Create empty session' \
        'show:Show session metadata' \
        'messages:Show session messages' \
        'switch:Set active CLI session' \
        'stop:Stop session runtime' \
        'rename:Rename session' \
        'delete:Delete session'
      return
    fi
    _arguments '--limit[Maximum messages to return]:limit:' '--title[Session title]:title:' '--cwd[Project path]:path:_files -/' '--channel[Channel id or name]:channel:' '--model[Model id]:model:' '--yes[Confirm delete]' '--json[Output JSON]'
    ;;
  channel)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'channel commands' 'show:Show channel' 'models:List channel models'
      return
    fi
    _arguments '--json[Output JSON]'
    ;;
  run)
    _arguments \
      '--session[Resume an existing session]:session:' \
      '--resume[Resume last CLI-touched session or explicit session]:session:' \
      '--cwd[Use this directory for a new session]:path:_files -/' \
      '--channel[Channel id or name]:channel:' \
      '--model[Model id]:model:' \
      '--permission-mode[Permission mode]:mode:(auto smart)' \
      '--json[Output JSON]' \
      '--no-stream[Suppress live text streaming]' \
      '--verbose[Show verbose events]'
    ;;
  mcp)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'mcp commands' 'list:List MCP servers' 'enable:Enable an MCP server' 'disable:Disable an MCP server'
      return
    fi
    _arguments '--json[Output JSON]'
    ;;
  skills)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'skills commands' 'list:List skills' 'enable:Enable a skill' 'disable:Disable a skill'
      return
    fi
    _arguments '--json[Output JSON]'
    ;;
  task)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'task commands' \
        'list:List tasks' \
        'show:Show task' \
        'create:Create task' \
        'update:Update task' \
        'start:Enable task' \
        'stop:Disable task' \
        'run:Run task now' \
        'history:Show run history' \
        'delete:Delete task' \
        'runtime:Show scheduler runtime'
      return
    fi
    _arguments '--json[Output JSON]' '--name[Task name]:name:' '--prompt[Prompt text]:prompt:' '--prompt-file[Prompt file]:file:_files' '--channel[Channel id or name]:channel:' '--session[Session id]:session:' '--cwd[Project path]:path:_files -/' '--at[Run at ISO datetime]:datetime:' '--every[Run every N minutes]:minutes:' '--cron[Cron expression]:expr:' '--loop[Loop mode]' '--model[Model id]:model:' '--thinking[Thinking level]:level:(none low medium high xhigh)' '--history-turns[History turns]:turns:' '--tools[Enabled tools CSV]:tools:' '--dirs[Additional directories CSV]:dirs:' '--verify[Verifiers CSV]:verify:' '--permission-mode[Permission mode]:mode:(auto smart)' '--bridge-target[Bridge target channel:endpointKey]:target:' '--bridge-targets[Bridge targets CSV]:targets:' '--bridge-endpoint[Legacy bridge endpoint]:endpoint:' '--bridge-channel[Legacy bridge channel]:channel:(telegram discord feishu wechat)' '--bridge-failure-policy[Bridge delivery failure policy]:policy:(all any)' '--ai-can-exit[Allow AI self-stop]' '--notify-missed[Notify missed run]' '--limit[Maximum history rows]:limit:' '--yes[Confirm delete]'
    ;;
  report)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'report commands' 'daily:Show daily report'
      return
    fi
    _arguments '--date[Date in YYYY-MM-DD]:date:' '--json[Output JSON]'
    ;;
  soul|user)
    if (( CURRENT == 3 )); then
      _describe -t subcommands 'personality commands' 'set:Write document content'
      return
    fi
    if [[ "\${words[3]}" == 'set' ]]; then
      _arguments '--file[Read content from file]:file:_files' '--stdin[Read content from stdin]' '--json[Output JSON]'
      return
    fi
    _arguments '--json[Output JSON]'
    ;;
  completion)
    _arguments '1:shell:(bash zsh fish)'
    ;;
esac
`
}

function renderFishCompletion(): string {
  return `complete -c kila -f

complete -c kila -n '__fish_use_subcommand' -a 'status version doctor run sessions session channels channel providers config mcp skills task report soul user completion'

complete -c kila -n '__fish_seen_subcommand_from status version doctor channels providers' -l json

complete -c kila -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from list get set' -a 'list get set'
complete -c kila -n '__fish_seen_subcommand_from config' -l json
complete -c kila -n '__fish_seen_subcommand_from config' -l json-value
complete -c kila -n '__fish_seen_subcommand_from config' -l file -r

complete -c kila -n '__fish_seen_subcommand_from sessions' -l limit
complete -c kila -n '__fish_seen_subcommand_from sessions' -l json

complete -c kila -n '__fish_seen_subcommand_from run' -l session
complete -c kila -n '__fish_seen_subcommand_from run' -l resume
complete -c kila -n '__fish_seen_subcommand_from run' -l cwd -r
complete -c kila -n '__fish_seen_subcommand_from run' -l channel -r
complete -c kila -n '__fish_seen_subcommand_from run' -l model -r
complete -c kila -n '__fish_seen_subcommand_from run' -l permission-mode -a 'auto smart'
complete -c kila -n '__fish_seen_subcommand_from run' -l json
complete -c kila -n '__fish_seen_subcommand_from run' -l no-stream
complete -c kila -n '__fish_seen_subcommand_from run' -l verbose

complete -c kila -n '__fish_seen_subcommand_from session; and not __fish_seen_subcommand_from create show messages switch stop rename delete' -a 'create show messages switch stop rename delete'
complete -c kila -n '__fish_seen_subcommand_from session' -l limit
complete -c kila -n '__fish_seen_subcommand_from session' -l title -r
complete -c kila -n '__fish_seen_subcommand_from session' -l cwd -r
complete -c kila -n '__fish_seen_subcommand_from session' -l channel -r
complete -c kila -n '__fish_seen_subcommand_from session' -l model -r
complete -c kila -n '__fish_seen_subcommand_from session' -l yes
complete -c kila -n '__fish_seen_subcommand_from session' -l json

complete -c kila -n '__fish_seen_subcommand_from channel; and not __fish_seen_subcommand_from show models' -a 'show models'
complete -c kila -n '__fish_seen_subcommand_from channel' -l json

complete -c kila -n '__fish_seen_subcommand_from mcp; and not __fish_seen_subcommand_from list enable disable' -a 'list enable disable'
complete -c kila -n '__fish_seen_subcommand_from mcp' -l json

complete -c kila -n '__fish_seen_subcommand_from skills; and not __fish_seen_subcommand_from list enable disable' -a 'list enable disable'
complete -c kila -n '__fish_seen_subcommand_from skills' -l json

complete -c kila -n '__fish_seen_subcommand_from task; and not __fish_seen_subcommand_from list show create update start stop run history delete runtime' -a 'list show create update start stop run history delete runtime'
complete -c kila -n '__fish_seen_subcommand_from task' -l json
complete -c kila -n '__fish_seen_subcommand_from task' -l name -r
complete -c kila -n '__fish_seen_subcommand_from task' -l prompt -r
complete -c kila -n '__fish_seen_subcommand_from task' -l prompt-file -r
complete -c kila -n '__fish_seen_subcommand_from task' -l channel -r
complete -c kila -n '__fish_seen_subcommand_from task' -l session -r
complete -c kila -n '__fish_seen_subcommand_from task' -l cwd -r
complete -c kila -n '__fish_seen_subcommand_from task' -l at -r
complete -c kila -n '__fish_seen_subcommand_from task' -l every -r
complete -c kila -n '__fish_seen_subcommand_from task' -l cron -r
complete -c kila -n '__fish_seen_subcommand_from task' -l loop
complete -c kila -n '__fish_seen_subcommand_from task' -l model -r
complete -c kila -n '__fish_seen_subcommand_from task' -l thinking -a 'none low medium high xhigh'
complete -c kila -n '__fish_seen_subcommand_from task' -l history-turns -r
complete -c kila -n '__fish_seen_subcommand_from task' -l tools -r
complete -c kila -n '__fish_seen_subcommand_from task' -l dirs -r
complete -c kila -n '__fish_seen_subcommand_from task' -l verify -r
complete -c kila -n '__fish_seen_subcommand_from task' -l permission-mode -a 'auto smart'
complete -c kila -n '__fish_seen_subcommand_from task' -l bridge-target -r
complete -c kila -n '__fish_seen_subcommand_from task' -l bridge-targets -r
complete -c kila -n '__fish_seen_subcommand_from task' -l bridge-endpoint -r
complete -c kila -n '__fish_seen_subcommand_from task' -l bridge-channel -a 'telegram discord feishu wechat'
complete -c kila -n '__fish_seen_subcommand_from task' -l bridge-failure-policy -a 'all any'
complete -c kila -n '__fish_seen_subcommand_from task' -l ai-can-exit
complete -c kila -n '__fish_seen_subcommand_from task' -l notify-missed
complete -c kila -n '__fish_seen_subcommand_from task' -l limit -r
complete -c kila -n '__fish_seen_subcommand_from task' -l yes

complete -c kila -n '__fish_seen_subcommand_from report; and not __fish_seen_subcommand_from daily' -a 'daily'
complete -c kila -n '__fish_seen_subcommand_from report' -l date -r
complete -c kila -n '__fish_seen_subcommand_from report' -l json

complete -c kila -n '__fish_seen_subcommand_from soul user; and not __fish_seen_subcommand_from set' -a 'set'
complete -c kila -n '__fish_seen_subcommand_from soul user' -l json
complete -c kila -n '__fish_seen_subcommand_from set' -l file -r
complete -c kila -n '__fish_seen_subcommand_from set' -l stdin
complete -c kila -n '__fish_seen_subcommand_from set' -l json

complete -c kila -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
`
}

export async function runCompletionCommand(args: ParsedArgs): Promise<number> {
  const shell = args.positionals[0]
  if (!shell) {
    throw new Error('缺少 shell 类型: bash | zsh | fish')
  }

  let script: string
  switch (shell) {
    case 'bash':
      script = renderBashCompletion()
      break
    case 'zsh':
      script = renderZshCompletion()
      break
    case 'fish':
      script = renderFishCompletion()
      break
    default:
      throw new Error(`不支持的 shell: ${shell}`)
  }

  process.stdout.write(script)
  if (!script.endsWith('\n')) {
    process.stdout.write('\n')
  }
  return 0
}

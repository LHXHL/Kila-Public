/**
 * 将 Pi runtime 的 snake_case/lowercase 工具名与历史 PascalCase 名称统一。
 *
 * 只归一化 Kila 已知工具；未知 MCP/Skill 工具保留原名，避免破坏外部工具标识。
 */
const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  agent: 'Agent',
  ask_user_question: 'AskUserQuestion',
  askuserquestion: 'AskUserQuestion',
  bash: 'Bash',
  edit: 'Edit',
  generate_image: 'generate_image',
  generateimage: 'generate_image',
  glob: 'Glob',
  grep: 'Grep',
  kill_shell: 'KillShell',
  killshell: 'KillShell',
  notebook_edit: 'NotebookEdit',
  notebookedit: 'NotebookEdit',
  read: 'Read',
  skill: 'Skill',
  task: 'Task',
  task_create: 'TaskCreate',
  task_get: 'TaskGet',
  task_list: 'TaskList',
  task_output: 'TaskOutput',
  task_update: 'TaskUpdate',
  taskcreate: 'TaskCreate',
  taskget: 'TaskGet',
  tasklist: 'TaskList',
  taskoutput: 'TaskOutput',
  taskupdate: 'TaskUpdate',
  team_create: 'TeamCreate',
  teamcreate: 'TeamCreate',
  todo_read: 'TodoRead',
  todo_write: 'TodoWrite',
  todoread: 'TodoRead',
  todowrite: 'TodoWrite',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  write: 'Write',
}

export function normalizeAgentToolName(toolName: string): string {
  const trimmed = toolName.trim()
  if (!trimmed) return ''
  return TOOL_NAME_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

export function isAgentToolName(toolName: string, expectedCanonicalName: string): boolean {
  return normalizeAgentToolName(toolName) === expectedCanonicalName
}

export function isSubagentToolName(toolName: string): boolean {
  const normalized = normalizeAgentToolName(toolName)
  return normalized === 'Task' || normalized === 'Agent'
}

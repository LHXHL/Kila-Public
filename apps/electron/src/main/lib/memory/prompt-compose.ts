/** 纯函数：组装运行时上下文、记忆正文和当前用户输入。 */
export function composeAgentPrompt(dynamicContext: string, memoryText: string, userContent: string): string {
  return `${dynamicContext}\n\n${memoryText}${userContent}`
}

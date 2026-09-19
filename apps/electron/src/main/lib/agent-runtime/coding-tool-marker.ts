/** coding tool 与 ToolHost 之间的无副作用标记，避免桥接层加载完整工具工厂。 */
export const KILA_CODING_TOOL = Symbol.for('kila.codingTool')

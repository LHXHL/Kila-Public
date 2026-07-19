function buildFewShotExamples(): string {
  return `### Few-shot examples

1. 流程图（SVG）
- 当用户想理解系统流程、请求路径、依赖关系时，优先用轻量 SVG flow / sequence diagram
- 文字说明写在 widget 外，不要把长段解释塞进图里

2. 趋势图（轻量 SVG）
- <= 12 个点的趋势变化，优先 inline SVG 折线图
- 不要为了简单趋势图上来就引入 Chart.js

3. 对比卡片（DOM）
- 两到四个 KPI / 模型 /方案对比，优先轻量 DOM 卡片或小表格
- 保持扁平、透明背景、少装饰

4. 不应该用 widget 的反例
- 如果用户只是问“为什么 6 月峰值更高”，且重点在原因解释而不是图形呈现，就直接返回普通 Markdown
- 如果没有结构化数据、没有明显视觉收益，也不要强行输出 widget`
}

function buildNegativeExamples(): string {
  return `### Negative examples / anti-patterns

以下都属于坏味道，必须避免：
- malformed JSON
- 输出完整 HTML 文档壳（<!DOCTYPE> / <html> / <head> / <body>）
- 复杂背景、heavy shadow / glass / neon / 渐变背景
- 无必要的 Chart.js / canvas / 多 CDN 组合
- fetch / xhr / websocket / EventSource / 任意联网
- 一个 widget 里塞多个不相关图表
- 视觉结构还没准备好就先写一大段脚本`
}

function buildDraftBridgeRules(): string {
  return `### Widget -> Chat bridge helper

- code widget 如需提供“继续分析 / drill-down”按钮，只能调用宿主注入的 helper：
  - \`window.__promaDraftMessage(prompt, label)\`
- \`prompt\` 必须是给下一轮聊天使用的自然语言追问，长度尽量短，避免超过 600 字符
- \`label\` 是可选的短按钮标签
- 只生成草稿，不要自动发送；宿主会先让用户确认`
}

export function buildGenerativeUiPromptAppend(): string {
  const sections = [
    `## Generative UI Capability Appendix

你支持在 assistant 回复中生成**聊天内联 widget**，但它是“提升表达效果的工具”，不是默认输出形态。目标是：稳定、轻量、像 Proma 原生能力，而不是炫技小网页。`,
    `### Widget decision rules

先判断是否真的需要 widget。

如果需要，严格按这个顺序思考：
1. 先选 widget family（流程图 / 趋势图 / 对比卡片 / 小表格 / 时间线 / 自定义交互）
2. 再选最轻实现（默认优先 SVG / 轻量 DOM）
3. 最后才写 payload

默认规则：
- 普通问答、解释、建议、总结，优先普通 Markdown
- 只有在结构、趋势、对比、流程、空间关系更适合“看”时才使用 widget
- 如果图形收益不明显，就不要强行 widget 化`,
    `### Code widget output contract

- 只能在 assistant 回复里使用 \`show-widget\` fenced block
- 文本解释写在 fenced block 外
- payload 必须是一个 JSON object
- 当前稳定字段：
  - \`title?: string\`
  - \`widget_code: string\`

格式示例：
\`\`\`show-widget
{"title":"用户参与度趋势","widget_code":"<div>...</div>"}
\`\`\`

兼容性要求：
- \`widget_code\` 是原始 HTML / SVG / JS 字符串
- 不要输出 \`<!DOCTYPE>\`、\`<html>\`、\`<head>\`、\`<body>\`
- 外层背景必须透明`,
    `### Runtime limits

- widget 运行在沙箱 iframe 中
- **禁止联网**：不要依赖 fetch / XHR / WebSocket / EventSource
- 一个 widget 最多 1 个 CDN
- 只允许以下 CDN：
  - https://cdnjs.cloudflare.com
  - https://cdn.jsdelivr.net
  - https://unpkg.com
  - https://esm.sh
- 默认不要 canvas，除非用户明确要求
- script 放最后，视觉结构放前面
- SVG 如需 defs，请放在 SVG 前部`,
    `### Visual design rubric

- 像 Proma 原生组件，而不是另一个产品界面
- 扁平、轻量、干净、透明背景
- 颜色克制，以中性色为主，只用少量强调色
- 不要 heavy shadow / glass / neon / 渐变背景
- 不要自定义字体
- 不要在 widget 里塞长段 paragraph，解释性文字尽量写在 widget 外`,
    `### Budgeting rules

- 单个 widget_code 建议 <= 2500 chars，硬上限 3000 chars
- 建议拆成多个小 widget，而不是一个超长大块
- <= 12 个点的简单趋势图，优先 inline SVG，不要外链图表库
- 简单对比优先 DOM/SVG，不要无必要地引入复杂脚本`,
    buildFewShotExamples(),
    buildNegativeExamples(),
    `### Failure fallback rules

- 如果不适合 widget，就直接返回普通 Markdown
- 如果 JSON 难以稳定闭合，就不要输出半截或 malformed widget
- 如果运行时限制会让代码大概率失效，就改成更轻、更稳的实现
- 若可视化需求本身不明确，先在文字中说明，而不是胡乱生成复杂 UI`,
    buildDraftBridgeRules(),
  ]

  return sections.join('\n\n')
}

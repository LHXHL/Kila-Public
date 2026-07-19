# Kila Native-Feel 待修复清单

> 基于 2026-05-15 复查结果，以下项目在首轮修复后仍未解决。
> 按投入产出比排序，分为"快速修"、"中等投入"、"需架构决策"三档。

---

## 🔴 快速修（每个 < 1 小时）

### 1. 系统字体前置（#34）

**现状**：`Inter` 排在 `-apple-system` 前面，导致 macOS 上不使用系统原生字体。

**文件**：`apps/electron/tailwind.config.js`

**修改**：
```javascript
// 改前
fontFamily: {
  sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
}
// 改后
fontFamily: {
  sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'Inter', 'sans-serif'],
}
```

---

### 2. 首帧闪烁（#2）

**现状**：`ready-to-show` 时直接 `show()`，macOS 上可能出现 1 帧空白。

**文件**：`apps/electron/src/main/index.ts`

**修改**：
```typescript
// 改前
mainWindow.once('ready-to-show', () => {
  mainWindow?.show()
})

// 改后：给 WebKit 一帧时间完成首帧渲染
mainWindow.once('ready-to-show', () => {
  setTimeout(() => {
    mainWindow?.show()
  }, 50)
})
```

---

### 3. select-none 扩展（#22）

**现状**：仅 7 个 UI 组件使用 `select-none`，标题、按钮文本等仍可被选中。

**范围**：扫描所有标题（h1-h6）、按钮文本、标签文本组件，统一添加 `select-none`。

**优先文件**：
- 各种 `*Title.tsx`、`*Header.tsx` 组件
- `TabBarItem.tsx`（已有，确认覆盖）
- 消息列表中的非内容区域

---

## 🟡 中等投入（每个 1-4 小时）

### 4. 隐藏窗口节流处理（#49/#51）

**现状**：macOS 上 WebKit 会自动节流隐藏窗口的 rAF 和定时器，导致热键唤起时首帧卡顿。

**文件**：`apps/electron/src/main/index.ts`

**修改方案**：
```typescript
// 在 createWindow() 中添加
if (process.platform === 'darwin') {
  // 禁用 WebKit 的 occlusion detection，避免隐藏时被节流
  mainWindow.on('ready-to-show', () => {
    // @ts-expect-error — private API, stable for ~10 years
    mainWindow?.setBackgroundColor('#00000000')
  })
}
```

更完整的方案（参考 native-feel-skill `references/03-webview-survival.md` A.1）：
```swift
// macOS 原生壳中
window.setValue(false, forKey: "windowOcclusionDetectionEnabled")
```

Electron 中需通过 `BrowserWindow` 的内部 API 或插件实现，或在 preload 中注入 keepWarm 循环：
```typescript
// preload 中
function keepWarm() {
  requestAnimationFrame(keepWarm)
}
keepWarm()
```

---

### 5. ⌘M 最小化行为（#12）

**现状**：`titleBarStyle: 'hiddenInset'` 下 ⌘M 行为需要验证。

**验证方法**：手动测试 ⌘M 是否最小化窗口。如果不工作，需要在菜单中显式绑定：
```typescript
// menu.ts 中确认 minimize role 存在
{ role: 'minimize' }
```

---

### 6. 绿色按钮 zoom 行为（#13）

**现状**：macOS 上 green button 默认行为是 maximize（全屏或最大化），应为 zoom（窗口自适应内容大小）。

**文件**：`apps/electron/src/main/index.ts`

**说明**：Electron 的 `hiddenInset` 模式下 green button 行为取决于 `fullscreen` 设置。需要测试当前行为，如果点绿色按钮进入全屏，需要设置：
```typescript
mainWindow = new BrowserWindow({
  // ...
  fullscreenable: false, // 禁止绿色按钮全屏，改为 zoom
})
```

---

### 7. Escape 键全局行为（#29）

**现状**：Radix Dialog 自带 Escape 关闭，但其他场景（popover、dropdown、搜索）未验证。

**验证清单**：
- [ ] 搜索框 Escape 清空并关闭
- [ ] popover Escape 关闭
- [ ] dropdown Escape 关闭
- [ ] 消息输入框 Escape 聚焦到搜索或取消当前操作

---

## 🔵 需架构决策（投入较大或需讨论）

### 8. IME 拼音输入（#26）

**现状**：未见 IME 相关处理代码。

**风险**：Electron 的 Chromium 内核通常 IME 兼容性不错，但以下场景需测试：
- 消息输入框中拼音输入法的候选窗口位置
- 搜索框中拼音输入
- 输入法切换时的焦点行为

**操作**：需要实际用拼音输入法（macOS 原生 + 第三方如搜狗）测试上述场景。

---

### 9. 完整键盘导航（#27）

**现状**：有 `focus-visible:ring` 样式，但 Tab 遍历的完整性未验证。

**验证方法**：
1. 打开应用，不碰鼠标
2. 用 Tab 遍历所有可交互元素
3. 用 Enter/Space 激活
4. 用 Escape 关闭弹出层
5. 记录卡住或跳过的区域

**需要修复的可能场景**：
- 侧边栏文件树的展开/折叠
- 会话列表的导航
- 工具调用结果的展开/折叠

---

### 10. type-ahead 列表跳转（#30）

**现状**：未见实现。

**场景**：在会话列表、文件列表、模型选择等长列表中，按字母键应跳转到匹配项。

**实现**：需要在列表组件中添加 keydown 监听，维护 type-ahead buffer，匹配并滚动到目标项。

---

### 11. 标签文本不可全选（#22 扩展）

**现状**：部分组件有 `select-none`，但未全局覆盖。

**全局方案**：在 `globals.css` 中添加：
```css
/* 默认禁止选择，可交互元素单独允许 */
* {
  user-select: none;
}
input, textarea, [contenteditable], .selectable {
  user-select: text;
}
```

**风险**：可能影响代码块、消息内容等需要选择的区域，需要逐一排除。

---

### 12. 网络超时统一策略（#54）

**现状**：未见统一超时处理，不同 API 调用可能有不同的超时行为。

**方案**：
- 在 IPC 层或 fetch wrapper 中设置默认 10s 超时
- 超时后在 UI 中显示 toast 错误
- 对 AI 推理等长操作单独设置更长超时

---

### 13. 空闲内存优化（#46）

**现状**：Electron + AI 后端 + Node 进程，空闲时可能超过 500MB。

**可能的优化**：
- 延迟加载非首屏组件（React.lazy）
- 空闲时释放 AI 模型上下文
- 减少 Jotai atom 的初始值大小
- 使用 `v8.setFlagsFromString('--max-old-space-size=512')` 限制 V8 堆

**注意**：这是 Electron 应用的固有限制，"优化"而非"解决"。

---

### 14. 无障碍完整支持（#66-70）

**现状**：有 17 处 aria-label，但缺少：
- VoiceOver/Narrator 完整导航测试
- `aria-live` 区域（消息到达播报）
- 颜色对比度 WCAG AA 验证
- 系统字号放大后可用性
- 全键盘操作验证

**建议分阶段**：
1. 先加 `aria-live="polite"` 到消息列表区域
2. 给所有图标按钮补 `aria-label`
3. 测试并修复对比度不足的颜色
4. 用 macOS VoiceOver 走一遍主流程

---

### 15. 崩溃报告（#63）

**现状**：未集成 crash reporter。

**方案**：
```bash
npm install @sentry/electron
```

```typescript
// main/index.ts
import * as Sentry from '@sentry/electron'
Sentry.init({ dsn: 'YOUR_DSN' })
```

**替代方案**：如果不想引入外部服务，至少在 `app.on('render-process-gone')` 中记录崩溃日志到文件。

---

### 16. 文件关联（#57）

**现状**：未配置文件类型关联。

**场景**：双击 `.kila-session` 或 `.kila-skill` 文件时打开 Kila。

**文件**：`apps/electron/electron-builder.yml`

**修改**：
```yaml
fileAssociations:
  - ext: kila-session
    name: Kila Session
    mimeType: application/x-kila-session
```

---

### 17. 原生拖放（#58）

**现状**：未见原生拖放实现。

**场景**：
- 拖拽文件到消息输入框作为附件
- 拖拽文件到应用图标打开

**说明**：已有 `attachment-service.ts` 处理文件选择，拖放是其自然扩展。

---

### 18. 剪贴板多格式（#59）

**现状**：未见 clipboard 多格式写入。

**场景**：复制消息内容时，应同时写入纯文本 + 富文本（RTF/HTML）。

**修改**：
```typescript
import { clipboard, Clipboard } from 'electron'
clipboard.write({
  text: plainText,
  rtf: rtfContent,
  html: htmlContent,
})
```

---

## 总结

| 档位 | 项目数 | 预计总工时 |
|------|--------|-----------|
| 🔴 快速修 | 3 | ~2 小时 |
| 🟡 中等投入 | 4 | ~8 小时 |
| 🔵 需架构决策 | 11 | ~3-5 天 |

**建议优先级**：先做快速修 3 项（字体、首帧、select-none），再做中等投入的 4 项，其余按需安排。

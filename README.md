# Kila

Kila 是一个面向通用场景的本地优先 AI Agent 桌面工作台，基于 Electron、React 和 Pi runtime 构建。

每个 Session 绑定一个项目目录，让对话、文件操作、工具调用、MCP 与 Skills 在同一上下文中协作，适用于软件开发、内容创作、资料整理、数据处理和日常自动化等任务。

[English README](./README.en.md)

## 核心能力

- **本地优先**：会话、配置和项目数据保存在本机
- **统一工作区**：在一个界面中完成对话、文件浏览、编辑和预览
- **Pi Agent Runtime**：支持流式输出、工具调用、上下文压缩、任务中止与恢复
- **多模型渠道**：支持 Anthropic、OpenAI、Google、Ollama 及兼容端点
- **MCP 与 Skills**：按项目扩展工具和可复用工作流
- **长期 Session**：保留项目上下文，持续推进复杂任务
- **多入口协作**：支持桌面端、CLI bridge 和飞书桥接

## 使用场景

- 阅读、修改和重构代码
- 整理资料、撰写内容和生成文档
- 处理表格、PDF 等本地文件
- 调用外部工具完成检索、分析和自动化任务
- 为不同项目配置独立的模型、MCP、Skills 和权限

## 工作方式

```text
Kila Session
├─ 项目目录：文件与命令的工作上下文
├─ Session JSONL：用户可见的消息、附件和元数据
├─ Pi sidecar：运行时状态、turn tree 与 compaction
└─ Project profile：MCP、Skills 与权限配置
```

Kila 使用 Pi `0.82.1` canonical runtime。产品层 Session 与 Pi AgentSession 一一对应，同时分别维护用户数据和运行时状态，因此应用重启或长对话压缩后仍可继续当前任务。

## 快速开始

### 环境要求

- [Bun](https://bun.sh/)
- Git `>= 2.0`

### 本地开发

```bash
bun install
bun run dev
```

首次启动后：

1. 在“设置 > 渠道管理”中添加模型渠道
2. 创建 Session 并选择项目目录
3. 按需配置模型、MCP、Skills 和权限
4. 开始任务

## 常用命令

```bash
bun run dev              # 开发模式
bun run typecheck        # 类型检查
bun test                 # 运行测试
bun run electron:build   # 构建桌面应用
```

桌面应用启动后，可以通过 CLI 复用同一套 Session 和 Agent runtime：

```bash
kila status
kila run "总结这个项目"
kila sessions
kila channels
kila mcp list
kila skills list
```

## 项目结构

```text
kila/
├─ apps/electron/   # Electron 主进程、Preload 与 React 渲染进程
├─ apps/cli/        # CLI bridge
└─ packages/
   ├─ core/         # Provider 适配器与基础服务
   ├─ shared/       # 共享类型、配置与 IPC 协议
   └─ ui/           # 共享 UI 组件
```

## 本地数据

Kila 默认将数据保存在 `~/.kila/`：

```text
~/.kila/
├─ sessions.json
├─ sessions/*.jsonl
├─ pi-sessions/
├─ project-profiles/
├─ global-agent/
├─ channels.json
└─ settings.json
```

采用 JSON 配置与 JSONL 消息日志，不依赖本地数据库，便于查看、备份和迁移。

# Kila

Kila is a local-first AI agent desktop workspace for general-purpose work, built with Electron, React, and the Pi runtime.

Each Session is connected to a project directory, bringing conversations, file operations, tool calls, MCP, and Skills into one shared context. It is designed for software development, writing, research, document processing, and everyday automation.

[中文 README](./README.md)

## Core Capabilities

- **Local-first**: Sessions, configuration, and project data stay on your machine
- **Unified workspace**: Chat, browse, edit, and preview files in one interface
- **Pi Agent Runtime**: Streaming, tool calls, context compaction, cancellation, and recovery
- **Multiple model providers**: Anthropic, OpenAI, Google, Ollama, and compatible endpoints
- **MCP and Skills**: Extend each project with tools and reusable workflows
- **Long-lived Sessions**: Preserve context while working through complex tasks
- **Multiple access points**: Desktop app, CLI bridge, and Feishu bridge

## Use Cases

- Read, modify, and refactor code
- Organize research, write content, and generate documents
- Process spreadsheets, PDFs, and other local files
- Use external tools for search, analysis, and automation
- Configure models, MCP servers, Skills, and permissions per project

## How It Works

```text
Kila Session
├─ Project directory: working context for files and commands
├─ Session JSONL: user-visible messages, attachments, and metadata
├─ Pi sidecar: runtime state, turn tree, and compaction
└─ Project profile: MCP, Skills, and permission settings
```

Kila uses the Pi `0.80.10` canonical runtime. A product Session maps to one Pi AgentSession, while user data and runtime state remain separate. This allows tasks to resume after restarting the app or compacting a long conversation.

## Quick Start

### Requirements

- [Bun](https://bun.sh/)
- Git `>= 2.0`

### Local Development

```bash
bun install
bun run dev
```

After the first launch:

1. Add a model provider under **Settings > Channels**
2. Create a Session and select a project directory
3. Configure the model, MCP, Skills, and permissions as needed
4. Start working

## Common Commands

```bash
bun run dev              # Development mode
bun run typecheck        # Type checking
bun test                 # Run tests
bun run electron:build   # Build the desktop app
```

With the desktop app running, the CLI can reuse the same Session and Agent runtime:

```bash
kila status
kila run "Summarize this project"
kila sessions
kila channels
kila mcp list
kila skills list
```

## Project Structure

```text
kila/
├─ apps/electron/   # Electron main process, Preload, and React renderer
├─ apps/cli/        # CLI bridge
└─ packages/
   ├─ core/         # Provider adapters and core services
   ├─ shared/       # Shared types, configuration, and IPC contracts
   └─ ui/           # Shared UI components
```

## Local Data

Kila stores its data under `~/.kila/` by default:

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

Configuration uses JSON and messages use JSONL. No local database is required, making the data easy to inspect, back up, and migrate.

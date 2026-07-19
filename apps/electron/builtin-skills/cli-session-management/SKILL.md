---
name: cli-session-management
description: Use when the user wants to inspect, continue, switch, rename, stop, or delete Kila sessions from the CLI. Trigger on requests like “查看会话 / 继续刚才那个 session / 停掉这个 session / 删掉旧会话 / 看消息记录”.
---

# CLI Session Management

## Overview

Use this skill for session lifecycle work through `kila`.

**Announce at start:** "I'm using the cli-session-management skill to manage Kila sessions through the CLI."

This skill turns loose session commands into a stable operator workflow.

## When to Use

Use this skill when the user asks to:
- list recent sessions
- inspect one session
- continue a prior session
- read session messages
- create a session before running
- rename, stop, switch, or delete a session

## Command Surface

- `kila sessions [--limit <n>]`
- `kila session create ...`
- `kila session show <id-or-prefix>`
- `kila session messages <id-or-prefix> [--limit <n>]`
- `kila session switch <id-or-prefix>`
- `kila session stop <id-or-prefix>`
- `kila session rename <id-or-prefix> <title>`
- `kila session delete <id-or-prefix> --yes`
- `kila run --session <id-or-prefix> ...`
- `kila run --resume [<id-or-prefix>] ...`

## Core Workflow

### Inspect before mutate
Before renaming, stopping, or deleting a session:
1. Run `kila session show <id-or-prefix>` when the target is not already clear.
2. If the user is asking about contents, run `kila session messages <id-or-prefix>`.
3. Then perform the mutation.

### Prefer exact session references
- Prefix matching is acceptable only when unambiguous.
- If multiple sessions could match, stop and ask the user which one they want.
- Do not guess based on title similarity alone.

## Hard Rules

### Delete confirmation is mandatory
- Never delete a session without explicit user intent.
- Use `--yes` only after the user has clearly confirmed deletion.
- If the user says "clean up old sessions", list candidates first instead of deleting immediately.

### Stop before destructive follow-up
- If the user wants to delete or replace an active session context, stop it first via `kila session stop <id>`.
- Do not assume the runtime is already idle.

### Session history is the truth
- When the user asks what happened in a session, inspect `kila session messages` instead of summarizing from memory.

## Intent Mapping

### "Continue the last thing"
1. Prefer `kila run --resume` if the user means the most recent CLI-touched session.
2. Prefer `kila sessions` + `kila session show` if the target is ambiguous.

### "Show me what happened in that session"
1. Run `kila session show <id>` for metadata.
2. Run `kila session messages <id> [--limit N]` for transcript excerpts.

### "Start a fresh thread for this project"
1. Use `kila session create --cwd <path> ...` when the user wants a named empty session first.
2. Otherwise use `kila run ... --cwd <path>` for direct execution.

### "Rename / archive / delete this session"
1. Inspect first if needed.
2. Rename via `kila session rename ...`.
3. Delete only after explicit confirmation.

## Output Rules

- For `kila sessions`, summarize the likely target session instead of dumping raw tables back to the user.
- For destructive actions, state the exact session id being changed.
- After `kila run`, mention the session id the user can use to continue.

## Fallbacks

- If `--resume` cannot resolve a recent session, fall back to `kila sessions` and ask the user to pick one.
- If bridge state looks stale, run `kila status` before concluding the session is unavailable.

---
name: cli-scheduler
description: Use when the user wants to create, inspect, run, stop, or reason about scheduled tasks and recurring automation from the Kila CLI. Trigger on requests like “定时提醒 / 每天跑一次 / 每小时检查 / 夜间汇报 / 发到 Discord”.
---

# CLI Scheduler

## Overview

Use this skill for scheduled and repeatable automation through `kila task *`.

**Announce at start:** "I'm using the cli-scheduler skill to manage Kila scheduled tasks through the CLI."

The goal is not just to expose task commands, but to choose the correct scheduling shape, execution target, and delivery behavior from user intent.

## When to Use

Use this skill when the user asks to:
- remind later or repeat work on a schedule
- run a prompt against a session or project automatically
- send task output to a bridge target
- inspect task history or runtime health
- pause, resume, or delete automation

## Command Surface

- `kila task list`
- `kila task show <id-or-prefix>`
- `kila task create ...`
- `kila task update <id-or-prefix> ...`
- `kila task start <id-or-prefix>`
- `kila task stop <id-or-prefix>`
- `kila task run <id-or-prefix>`
- `kila task history <id-or-prefix>`
- `kila task delete <id-or-prefix> --yes`
- `kila task runtime`

## Intent to Schedule Mapping

### One-time reminder or run later
Use `--at <iso>`.

### Fixed interval polling or heartbeat
Use `--every <minutes>`.

### Calendar-based recurrence
Use `--cron <expr>` and add `--tz <iana-tz>` when timezone precision matters.

### Continuous loop until stopped
Use `--loop` only when the user explicitly wants an always-on worker.

## Execution Target Rules

### Continue an existing conversation
Use `--session <id>`.
- Best when the task should keep the same context, model, and transcript continuity.
- Higher risk if the session is noisy or user-facing.

### Spawn isolated runs for a project
Use `--cwd <path>`.
- Best when each run should be independent.
- Prefer this for recurring analysis, monitoring, or report generation.

Do not guess between `--session` and `--cwd`. If the user's intent does not make continuity requirements clear, ask.

## Delivery Rules

### Local-only result
Omit bridge delivery flags.

### Deliver to remote bridge target
Use both:
- `--bridge-endpoint <key>`
- `--bridge-channel <telegram|discord|feishu|wechat>`

Never provide only one of the two.

### Deliver to multiple bridge targets
Prefer repeated `--bridge-target <channel>:<endpointKey>` flags.
- Supported channels: `telegram`, `discord`, `feishu`, `wechat`.
- Endpoint keys may contain `:`; split only on the first colon.
- Use `--bridge-failure-policy all` when every target must receive the result.
- Use `--bridge-failure-policy any` only when at least one successful delivery is acceptable.

## Read Before Write

Before mutating or deleting a task:
1. Run `kila task show <id-or-prefix>`.
2. If recent outcomes matter, run `kila task history <id-or-prefix>`.
3. Then start, stop, update, run, or delete.

## Hard Rules

### Delete confirmation is mandatory
- Never delete a task without explicit confirmation.
- Use `--yes` only after that confirmation.

### `--loop` is a dangerous default
- Do not choose `--loop` for vague requests like "watch this" or "check this regularly".
- Prefer `--every` unless the user explicitly wants a continuously restarting task.

### Timezone ambiguity must be surfaced
- If the user says "every day at 9" and timezone matters, ask which timezone unless a clear project or user timezone is already part of the request.

### Session vs project must be explicit
- `--session` and `--cwd` are different execution semantics.
- If the user is asking for a recurring reminder, monitor, or report, prefer `--cwd` unless transcript continuity is the point.

## Recommended Creation Flow

1. Determine schedule shape: `--at` / `--every` / `--cron` / `--loop`.
2. Determine execution target: `--session` or `--cwd`.
3. Determine delivery: local or bridge.
4. Determine channel/model overrides only if the default is unsuitable.
5. Create the task.
6. If the user asks for confidence checks, inspect with `kila task show` or `kila task runtime`.

## Intent Mapping Examples

### "Remind me tomorrow morning"
- Likely `--at <iso>`.
- Ask for timezone or exact time if missing.
- Usually prefer `--cwd` for a new isolated run unless the reminder must append to an existing session.

### "Check this repo every 30 minutes"
- Use `--every 30` with `--cwd <path>`.
- Avoid `--loop` unless the user explicitly wants immediate rerun behavior.

### "Run this against the current thread nightly"
- Use `--cron ... --session <id>`.
- Explain that future outputs will continue inside that session.

### "Send this summary to Discord every weekday"
- Use `--cron ... --bridge-endpoint ... --bridge-channel discord`.
- Confirm destination and timezone before creating it.

### "Send this summary to Discord and WeChat every weekday"
- Use `--cron ... --bridge-target discord:<endpointKey> --bridge-target wechat:<endpointKey>`.
- Keep the default `--bridge-failure-policy all` unless the user explicitly accepts partial delivery.

## Output Rules

When reporting a task change, include:
- task id
- schedule type
- execution target type
- whether delivery is local or bridge-backed

If task history shows repeated failures, say so explicitly and recommend `kila task runtime` or task inspection before editing blindly.

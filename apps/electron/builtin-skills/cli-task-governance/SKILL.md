---
name: cli-task-governance
description: Use when the user is deciding whether work should stay ad hoc or be promoted into a reusable Kila scheduled task, and when an existing task should be updated or retired. Trigger on requests like “这个要不要做成自动化 / 别重复建任务 / 更新现有任务 / 停掉这个自动任务”.
---

# CLI Task Governance

## Overview

Use this skill to decide when recurring or operational work should become an explicit `kila task`.

**Announce at start:** "I'm using the cli-task-governance skill to decide whether this work should be managed as a Kila task."

This is not a generic TODO system. It is governance for Kila scheduled tasks.

## When to Use

Use this skill when the user asks to:
- automate a recurring prompt or workflow
- keep rerunning the same check, report, or reminder
- revise an existing automation instead of creating duplicates
- clean up stale or noisy scheduled tasks
- understand whether a task should target a session or a project

## Promotion Rules

Promote work into a scheduled task when one or more are true:
- the same prompt should run more than once
- the work needs a clock, interval, or loop
- the work should deliver somewhere later without a human present
- the work should preserve run history and runtime status

Keep work as a one-off `kila run` when all are true:
- the user only wants it once
- there is no future trigger
- there is no need for task history or delivery automation

## Read Before Create or Update

Before creating a new task for an existing automation idea:
1. Run `kila task list`.
2. If there may already be a matching task, run `kila task show <id-or-prefix>`.
3. Prefer updating a close existing task over creating a duplicate.

Before editing or deleting a task:
1. Run `kila task show <id-or-prefix>`.
2. Run `kila task history <id-or-prefix>` if recent outcomes matter.

## Hard Rules

### Do not create duplicate automations blindly
- If a task with the same purpose already exists, update it instead of cloning it unless the user explicitly wants two parallel automations.

### Retire stale tasks explicitly
- If the user says an automation is no longer wanted, prefer `kila task stop` first.
- Use `kila task delete --yes` only after explicit confirmation.

### Manual runs are not proof of healthy automation
- If a task works when run manually but fails on schedule, inspect history and runtime rather than declaring it fixed.

## Intent Mapping

### "I keep asking you to do this every day"
- Recommend promoting it to `kila task create`.
- Ask for schedule shape and execution target.

### "This automation is wrong now"
- Inspect with `kila task show`.
- Update the existing task rather than creating a new one unless the semantics changed completely.

### "I don't need this anymore"
- Stop first.
- Delete only after confirmation.

### "Should this be a task or a normal run?"
- Choose `kila task` if repeatability, delivery, or history matters.
- Choose `kila run` if the work is one-off and interactive.

## Output Rules

- Explain why work is being promoted to a task or kept as a one-off run.
- When updating an existing task, state that you intentionally avoided creating a duplicate.
- When retiring a task, distinguish between stop and delete.

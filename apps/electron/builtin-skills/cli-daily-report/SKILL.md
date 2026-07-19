---
name: cli-daily-report
description: Use when the user wants a concise activity summary for Kila sessions and scheduled tasks for today or a specific day. Trigger on requests like “今天做了什么 / 今日汇总 / 昨天跑了多少任务 / 某天的活动报告”.
---

# CLI Daily Report

## Overview

Use `kila report daily` as the scene-level command for daily activity summaries.

**Announce at start:** "I'm using the cli-daily-report skill to generate a Kila activity summary through the CLI."

This skill exists to stop agents from reconstructing activity manually from raw sessions and task logs when a built-in summary command already exists.

## When to Use

Use this skill when the user asks:
- what happened today
- how active Kila was today
- how many sessions or scheduled runs happened
- for a daily operations summary
- for a summary for a specific date

## Command Surface

- `kila report daily`
- `kila report daily --date <YYYY-MM-DD>`

## Default Behavior

- If the user says "today", use `kila report daily`.
- If the user names a date, use `kila report daily --date <YYYY-MM-DD>`.
- If the user asks for a broader retrospective across many dates, this skill is not enough by itself; say that the built-in command is daily-scoped.

## Hard Rules

### Prefer the report command over manual reconstruction
- Do not start from `kila sessions` + `kila task history` unless the user asks for drill-down detail after the report.
- Use the scene-level report first, then drill into raw data only if needed.

### Daily report is summary-first
- Relay totals and trends first.
- Only quote specific sessions or tasks if the user asks for investigation.

## Recommended Flow

1. Run the daily report command.
2. Summarize session activity:
   - active sessions
   - created sessions
   - user messages
   - assistant messages
   - scheduled-task sourced messages
3. Summarize task activity:
   - total runs
   - success count
   - error count
   - skipped count
   - stopped-by-ai count
4. If the report suggests anomalies, offer follow-up drill-down with `kila sessions`, `kila task list`, or `kila task history`.

## Intent Mapping

### "What did Kila do today?"
- Run `kila report daily`.
- Give a concise natural-language summary.

### "How did automation perform today?"
- Run `kila report daily`.
- Focus on task run totals and failures.
- Offer drill-down if failures are non-zero.

### "What happened on 2026-04-25?"
- Run `kila report daily --date 2026-04-25`.

## Output Rules

- Lead with the date covered.
- Keep the first response summary-sized, not log-sized.
- If there were failures, call them out directly.
- If counts are all zero, say that clearly instead of padding.

## Fallbacks

- If the report command fails, say that the built-in daily summary is unavailable, then fall back to narrower inspection commands only if the user still wants a manual summary.

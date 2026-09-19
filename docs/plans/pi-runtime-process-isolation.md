# Pi Runtime 进程隔离实施方案

> 状态：实施合同  
> 最终架构：每个运行中或短期热保留的 Session 独占一个 Electron utility process  
> 唯一 Adapter：`RemotePiAgentAdapter`  
> 回退方式：仅允许 Git revert / 版本回退；不保留 local adapter、backend feature flag 或运行时 fallback

## 0. 实施准入结论

本方案分为“阶段零：边界先行实现”和“Runtime 迁移阶段”。

**阶段零完成前，禁止开始 utility process、Runtime RPC 或 `RemotePiAgentAdapter` 开发。** 阶段零必须先交付并合并以下能力：

1. Kila 自有 `read`、`write`、`edit`、`bash` 四个 coding tools；
2. ToolHost executor 与工具描述/执行分离；
3. Runtime transfer bundle 文件协议；
4. Pi run journal、安全提交点、dirty sidecar quarantine/rebuild；
5. runtime-specific `ErrorCode` 与 UI 映射；
6. `resetAgentSession`、`disposeSessionRuntime`、`clearPiSessionState` 生命周期接口；
7. Runtime 数量、spawn 并发和 RSS 基准测量。

阶段零通过本文定义的测试和退出条件后，后续阶段不得再重新选择工具边界、数据传输方式、sidecar 恢复策略或 fallback 策略，直接按合同实施。

---

## 1. 问题与目标

Kila 当前在 Electron 主进程内创建并持有所有 Pi `AgentSession`：

```text
Electron Main
  └─ AgentService
      └─ AgentOrchestrator
          └─ PiAgentAdapter
              ├─ AgentSession(session-a)
              ├─ AgentSession(session-b)
              └─ AgentSession(session-c)
```

任意 Session 的 Pi SDK 死循环、同步阻塞、原生依赖崩溃、Provider stream 卡死或内存膨胀，都可能影响整个桌面应用。改造完成后必须满足：

- Electron 主进程不加载 Pi runtime，不创建 Pi `AgentSession`；
- 每个真正运行或 hot-idle 的 Session 使用独立 PID；
- 单 Runtime 崩溃、卡死或超内存不影响主应用和其他 Session；
- Renderer、CLI、IM Bridge 继续使用现有 Session 和流式事件协议；
- Kila JSONL 由主进程单写，Pi sidecar 由对应 Runtime 单写；
- 工具、权限、MCP、Bash、retry、compaction、steer、follow-up 行为不退化；
- Runtime 异常后不自动重放 prompt 或副作用工具；
- dirty sidecar 不直接恢复；
- 最终生产代码只保留 `RemotePiAgentAdapter`。

### 1.1 非目标

本次不做：

- 不新增 `grep/find/ls` 独立工具。Pi `0.82.1` 当前 `createCodingTools()` 实际暴露 `read/bash/edit/write` 四个工具，本次只做行为等价迁移；
- 不修改产品 Session JSONL 格式以外的 UI 数据模型；
- 不修改 Pi sidecar 内部格式；
- 不把 MCP Manager、Permission、AskUser、ProcessRegistry 搬入 Runtime；
- 不引入数据库；
- 不自动恢复崩溃中的活跃 run；
- 不保留主进程本地 Pi 执行路径。

---

## 2. 最终架构与进程所有权

```text
Electron Main（控制面 + ToolHost）
├─ SessionService / IPC / CLI / IM Bridge
├─ AgentService
├─ AgentOrchestrator / runAgentStream
├─ RuntimeSupervisor
├─ RemotePiAgentAdapter
├─ ToolRegistry / ToolHost
├─ Kila coding tools: read/write/edit/bash
├─ Permission / AskUser
├─ MCP Manager
├─ ProcessRegistry
└─ Kila Session / JSONL / run journal

Pi Runtime Process（每个 active Session 一个）
├─ RuntimeServer
├─ PiRuntimeCore
├─ Pi AgentSession
├─ Pi SessionManager / sidecar
├─ ModelRuntime / CredentialStore
├─ retry / compaction / runtime context
├─ Pi event → AgentEvent mapper
└─ proxy AgentTools
```

### 2.1 active Session 的精确定义

本方案中的 active runtime 指状态属于：

```text
starting | preparing | running | draining | hot-idle
```

规则：

- 历史 Session 不创建 Runtime；
- 只有 `run.start` 可以 lazy spawn；
- stopped Session 上的 steer/follow-up 不允许隐式 spawn；
- 无 Runtime 时 `waitForIdle` 立即成功；
- 无 Runtime 时 reset/dispose/delete 保持幂等；
- queued-for-slot Session 尚未获得 Runtime PID，不计 active runtime；
- hot-idle 到期或被 LRU 选中后退出并变为 stopped。

### 2.2 主进程拥有

- 产品 Session、JSONL、消息安全边界和 run journal；
- `AgentOrchestrator`、`runAgentStream()`、产品终态、usage、memory、goal-loop；
- RuntimeSupervisor、spawn 队列、心跳、RSS、退出；
- Kila 自有 coding tools 和所有产品工具；
- ToolHost、ToolRegistry、工具幂等和取消；
- Permission、AskUser、MCP、ProcessRegistry；
- Renderer/CLI/IM 事件路由。

### 2.3 Runtime 拥有

- Pi ESM 模块；
- `AgentSession`、`SessionManager`、`SettingsManager`、`DefaultResourceLoader`；
- `CredentialStore`、`ModelRuntime`、Provider stream；
- retry、overflow recovery、compaction、runtime context fingerprint；
- sidecar `runtime.lock`；
- proxy tools；
- Pi 原始事件到 Kila `AgentEvent` 的转换。

Runtime 不允许写 Kila JSONL，不允许 import Electron UI API，不允许直接持有 MCP client、Permission、AskUser 或 `ChildProcess`。

---

## 3. 阶段零 A：Kila 自有 Coding Tools

### 3.1 最终决策

主进程不再调用 `@earendil-works/pi-coding-agent` 的 `createCodingTools()`、`createReadTool()`、`createWriteTool()`、`createEditTool()` 或 `createBashTool()`。

Kila 在 `apps/electron/src/main/lib/agent-tools/coding/` 实现四个等价工具：

```text
agent-tools/coding/
├─ schemas.ts
├─ path-policy.ts
├─ read-tool.ts
├─ write-tool.ts
├─ edit-tool.ts
├─ bash-tool.ts
├─ truncation.ts
└─ index.ts
```

共享输入/结果类型放在：

```text
packages/shared/src/types/coding-tools.ts
```

主进程 ToolHost 执行这些工具；Runtime 只根据 descriptor 创建 proxy `AgentTool`。

### 3.2 工具合同

#### `read`

```ts
interface ReadToolInput {
  path: string
  offset?: number
  limit?: number
}
```

- 权限类别：`read`；
- 相对路径以 Session `cwd` 解析；
- offset 为 1-based 行号，默认 1；limit 默认 2000，范围 1..10000；
- 文本使用 UTF-8，检测 BOM；非法 UTF-8 返回 `coding_read_invalid_encoding`；
- 图片只返回受控文件引用和 MIME，不在 Tool RPC 中发送 base64；
- 文本单次最大返回 256KiB，超出时返回前段内容和 `{ truncated, nextOffset }`；
- 路径必须通过 `file-access-policy.ts` 的 allowed roots + realpath 校验。

#### `write`

```ts
interface WriteToolInput {
  path: string
  content: string
}
```

- 权限类别：`write`；
- 目标必须位于 allowed roots；
- 对不存在路径按“最近存在父目录 realpath + 剩余相对路径”校验，防符号链接逃逸；
- 父目录递归创建；
- 使用同目录临时文件 + fsync + rename 原子覆盖；
- 单次 content 最大 8MiB，超出返回 `coding_write_too_large`；
- 返回 `{ bytesWritten, path }`。

#### `edit`

```ts
interface EditToolInput {
  path: string
  edits: Array<{ oldText: string; newText: string }>
}
```

- 权限类别：`write`；
- 顺序应用 edits；
- 每个 `oldText` 必须恰好匹配一次；零匹配返回 `coding_edit_not_found`，多匹配返回 `coding_edit_ambiguous`；
- 任一 edit 失败则不写文件；
- 最终写入使用同目录临时文件 + fsync + rename；
- 返回 `{ diff, patch, firstChangedLine }`；
- 输入文件最大 16MiB，最大 edits 100。

#### `bash`

```ts
interface BashToolInput {
  command: string
  timeout?: number
}
```

- 权限类别：`execute`；
- command 最大 128KiB；
- timeout 默认 120000ms，范围 1000..600000ms；
- shell 继续使用 `shell-resolver.ts` 的唯一真相源；
- 必须接入 `processRegistry`，保留当前 sessionId/toolCallId、后台任务、输出查询和停止语义；
- stdout/stderr 合并为有序 byte stream，按 UTF-8 增量解码；
- Runtime crash、run abort、Session delete 时按 sessionId/toolCallId abort；
- 返回 `{ exitCode, output, truncation?, fullOutputPath? }`；
- 主结果最大 256KiB，完整大输出继续由 ProcessRegistry 管理，不经 Tool RPC 全量传输。

### 3.3 Tool descriptor

```ts
interface RuntimeToolDescriptorV1 {
  version: 1
  toolId: string
  name: string
  label?: string
  description: string
  parameters: Record<string, unknown>
  source: 'kila-coding' | 'kila' | 'mcp' | 'runtime'
  permission: 'read' | 'write' | 'execute' | 'interactive'
  resultKinds: Array<'text' | 'image-ref' | 'resource' | 'structured' | 'mixed'>
  supportsStreaming: boolean
}
```

ToolRegistry 唯一键：

```text
(appBootId, bootId, sessionId, generation, runId, toolId, toolCallId)
```

保存 pending Promise、approvedArgs、AbortController、最后 update 序号和 terminal result/error。重复 `tool.call` 返回同一 pending/terminal 结果，不重复执行。

### 3.4 Permission 参数一致性

`tool.call` 携带 `requestedArgs`。Permission 结果产生 `approvedArgs`：

- ToolHost 只执行 `approvedArgs`；
- `tool_start`、审计、UI 和最终 `tool_result.input` 均展示 `approvedArgs`；
- 参数被修改时记录 `argsModified: true`，不得把 requestedArgs 伪装成实际执行参数；
- 拒绝、超时、非法 approvedArgs 均不执行工具。

### 3.5 阶段零 A 退出条件

- 四工具不 import Pi SDK；
- parity fixture 与当前 Pi 四工具的输入、成功结果、错误和截断语义一致；
- `agent-orchestrator-context.ts` 不再调用 `loadPiCodingAgent/createCodingTools/createBashTool`；
- 工具名冲突规则仍由 `agent-tool-names.ts` 管理；
- BDD 测试覆盖路径逃逸、原子写、edit 零/多匹配、Bash abort/timeout/background。

---

## 4. 阶段零 B：Transfer Bundle 协议

### 4.1 最终决策

完整 history、system prompt、图片、工具 schema 不通过单条 MessagePort 消息发送。主进程为每次 run 生成受控 transfer bundle，`run.start` 只传 bundle 引用。

目录：

```text
~/.kila/runtime-transfer/{runId}/
├─ manifest.json
├─ bootstrap.json
├─ tools.json
└─ attachments/
```

权限：目录 `0700`，文件 `0600`。路径由 `config-paths.ts` 统一生成，禁止业务代码手拼。

### 4.2 Manifest

```ts
interface RuntimeTransferManifestV1 {
  version: 1
  appBootId: string
  sessionId: string
  runId: string
  generation: number
  createdAt: number
  expiresAt: number
  files: Array<{
    relativePath: string
    size: number
    sha256: string
    kind: 'bootstrap' | 'tools' | 'image' | 'attachment'
  }>
  totalSize: number
}
```

限制：

- bundle 总大小最大 64MiB；
- 单文件最大 32MiB；
- 单图片最大 20MiB；
- bootstrap JSON 最大 16MiB；
- tools JSON 最大 8MiB；
- 附件数量最大 32；
- 超限返回 `runtime_transfer_too_large`，不得隐式截断历史。

### 4.3 写入与读取

主进程：

1. 写入唯一临时目录；
2. 每个文件写完 fsync；
3. 计算 SHA-256；
4. 最后写 manifest 并 fsync；
5. rename 为 `{runId}` 正式目录；
6. `run.start` 发送 `{ bundlePath, manifestSha256, configRevision }`。

Runtime：

1. realpath 校验 bundle 必须位于 `runtime-transfer` 根目录；
2. 校验目录名等于 runId；
3. 校验 manifest hash、版本、appBootId/sessionId/runId/generation；
4. 拒绝绝对 relativePath、`..`、符号链接和非普通文件；
5. 校验每个 size/hash 和总大小；
6. 校验成功后读取 bootstrap/tools；
7. 图片使用文件引用传入 Pi prompt，只有 Pi API 需要时才在 Runtime 内读取/编码。

Runtime 发出 `run.accepted` 表示 bundle 校验成功并取得 run 所有权。发出 `run.submitted` 后主进程删除 bundle。accepted 前失败由主进程立即清理；应用启动清理超过 24 小时或 appBootId 不匹配的遗留 bundle。

### 4.4 错误码

- `runtime_transfer_missing`
- `runtime_transfer_invalid_path`
- `runtime_transfer_hash_mismatch`
- `runtime_transfer_too_large`
- `runtime_transfer_expired`
- `runtime_transfer_invalid_manifest`

任何 transfer 错误均在打开 sidecar 和调用 Provider 前失败。

---

## 5. 阶段零 C：Dirty Sidecar、安全提交点与重建

### 5.1 风险模型

Runtime 在 run 中崩溃时，Pi sidecar 可能包含 user message、tool call、缺失的 tool result 或半截 assistant message。此类 sidecar 不允许直接恢复，即使产品层没有自动重放 prompt。

### 5.2 Run journal

每个 sidecar 目录包含 Kila 管理的：

```text
~/.kila/pi-sessions/{sessionId}/kila-run-journal.json
```

```ts
interface PiRunJournalV1 {
  version: 1
  sessionId: string
  runId?: string
  state: 'clean' | 'preparing' | 'submitted' | 'settled-awaiting-persist' | 'dirty'
  safeProductMessageId?: string
  safePiEntryId?: string
  appBootId: string
  bootId: string
  generation: number
  updatedAt: number
}
```

Runtime 持有 `runtime.lock` 后才可写 journal。写入必须走临时文件 + fsync + rename。

### 5.3 完整 run 时序

```text
Main 写 transfer bundle
Main → Runtime: run.start
Runtime 校验 bundle、锁、sidecar/journal
Runtime → Main: run.accepted
Runtime 写 journal(state=preparing, 上一个 safe boundary)
Runtime 调用 AgentSession.prompt()
Runtime 写 journal(state=submitted)
Runtime → Main: run.submitted
Runtime → Main: run.event*
Runtime 完成 Pi settle
Runtime 写 journal(state=settled-awaiting-persist)
Runtime → Main: run.settled(finalEventSequence, candidatePiEntryId)
Main 消费到 finalEventSequence
Main 完成 JSONL、usage、memory、产品终态持久化
Main → Runtime: run.persisted(safeProductMessageId)
Runtime 写 journal(state=clean, safeProductMessageId, safePiEntryId)
Runtime → Main: run.persisted_ack
```

`run.settled` 不是安全提交点；只有 `run.persisted_ack` 后才形成新的安全边界。

如果 `run.persisted` 或 ACK 丢失，journal 保持 `settled-awaiting-persist`。下一次启动时主进程用产品 JSONL 检查 `safeProductMessageId` 是否已完整持久化：一致则补发 persist/修复 clean；不一致则按 dirty 处理，不猜测成功。

### 5.4 异常与 quarantine

以下情况将 journal 视为 dirty：

- Runtime 在 `preparing/submitted/settled-awaiting-persist` 状态退出；
- 主进程失联导致 Runtime parent watchdog abort 后退出；
- journal 缺失但 sidecar 最后修改时间晚于最后安全提交记录；
- journal JSON/hash/字段损坏；
- Pi sidecar 解析失败。

下一 Runtime 在创建 `SessionManager` 前执行：

1. 获取或回收 `runtime.lock`；
2. 读取 journal；
3. dirty 时释放当前目录锁并将整个 sidecar 原子移动到：

```text
~/.kila/pi-sessions-quarantine/{sessionId}/{timestamp}-{runId-or-unknown}/
```

4. quarantine 目录设为只读诊断保留，不自动删除；
5. 创建新的 sidecar 目录并重新获取 lock；
6. 从 Kila JSONL 只读取截至 `safeProductMessageId` 的已提交消息；
7. 排除崩溃 run 的 user message、partial assistant、tool call/result、status 和 retry 事件；
8. 使用现有 history converter 初始化新 Pi session；
9. 写 clean journal；
10. 用户下一次显式发送才开始新 run。

崩溃 run 的 partial 内容继续保留在 Kila JSONL/UI 中，并标记运行中断，但不得导入重建后的 Pi history。

### 5.5 安全边界来源

主进程在每个产品 run 完成时持久化 run receipt：

```ts
interface AgentRunReceipt {
  runId: string
  sessionId: string
  outcome: 'success' | 'stopped' | 'error'
  lastMessageId: string
  fullyPersisted: boolean
  completedAt: number
}
```

只有 `fullyPersisted=true` 且收到 Runtime settled 的 receipt 可成为 `safeProductMessageId`。该 receipt 使用 JSONL 事件或独立原子索引保存，不能只放内存。

---

## 6. 阶段零 D：生命周期合同

### 6.1 三个明确操作

| 操作 | 前置条件 | 行为 | 后置条件 | 幂等 |
|---|---|---|---|---|
| `resetAgentSession` | Runtime 存活且无 active run | dispose 当前 AgentSession，保留 utility、runtime.lock 和 sidecar；按当前配置重建或延迟到下次 run | Runtime ready，无 AgentSession 或已重建 | 是 |
| `disposeSessionRuntime` | 任意 | abort run/tools，等待 settle，dispose AgentSession，flush journal，释放 runtime.lock，协议 shutdown，等待 process exit；超时 `UtilityProcess.kill()` 后仍等待 exit | 无 RuntimeRecord、无进程、无有效锁 | 是 |
| `clearPiSessionState` | `disposeSessionRuntime` 已确认 exit，且 lock 不存在或已验证 stale | 删除 sidecar；quarantine 保留 | 当前 sidecar 不存在 | 是 |

`clearPiSessionState` 发现有效 lock 时必须返回 `runtime_sidecar_locked`，不得强删。

### 6.2 调用矩阵

| 场景 | reset | dispose | clear sidecar |
|---|---:|---:|---:|
| config signature 变化 | ✅ | ❌ | ❌ |
| idle LRU 回收 | ❌ | ✅ | ❌ |
| app quit | ❌ | ✅ | ❌ |
| rewind | ❌ | ✅ | ✅，随后从产品 JSONL 重建 |
| regenerate | ❌ | ✅ | ✅，随后从产品 JSONL 重建 |
| delete | ❌ | ✅ | ✅ |
| runtime crash | ❌ | 进程已退出，完成记录清理 | ❌，dirty sidecar quarantine |

### 6.3 删除 tombstone

删除开始前在 Session 索引原子持久化 `deleting` tombstone。流程：

1. 拒绝 start/steer/follow-up；
2. `disposeSessionRuntime`；
3. `clearPiSessionState`；
4. 清理 ProcessRegistry、project changes、memory、preview、Permission、AskUser、watcher、附件；
5. 最后删除产品 JSONL 和索引；
6. 发 renderer deleted。

应用启动扫描 tombstone 并幂等续作。删除失败保留 tombstone/error，禁止恢复成普通 Session。

---

## 7. Runtime 配置合同

### 7.1 不新增独立 `runtime.configure`

每次 `run.start` 的 bootstrap 包含：

```ts
interface RuntimeConfigV1 {
  configRevision: number
  configFingerprint: string
  credentialRevision: number
  channel: SerializedChannel
  model: SerializedModelConfig
  systemPrompt: string
  cwd: string
  toolDescriptorsHash: string
  thinkingLevel: ThinkingLevel
}
```

`configFingerprint` 覆盖 channel provider/api/baseUrl、model/api/compat、systemPrompt、cwd、tools、thinking 和 compaction 设置，不包含 API Key 明文。主进程对同 Session 单调递增 `configRevision`。

### 7.2 变化处理

- 仅 `credentialRevision`/API Key 变化：调用 `updateKilaModelRuntimeApiKey` 等价逻辑，热更新 CredentialStore，不重建 AgentSession；
- fingerprint 相同：复用 AgentSession；
- fingerprint 不同且 idle：执行 `resetAgentSession`，保留 sidecar，按新配置重建；模型/thinking 变化继续追加 Pi model/thinking entry；
- fingerprint 不同且 active run：`run.rejected(runtime_config_changed_while_active)`；
- configRevision 小于 Runtime 已知版本：`run.rejected(runtime_stale_config_revision)`；
- 相同 revision 但 fingerprint 不同：协议错误 `runtime_config_revision_conflict`。

现有 orchestrator 对运行中 channel/model 切换的拒绝继续保留，Runtime 再做第二层防护。

---

## 8. 跨进程协议

### 8.1 身份与序列

握手：

- 主进程每次应用启动生成 `appBootId`；
- 每次 fork 生成 `spawnNonce`；
- `runtime.handshake` 携带 appBootId/spawnNonce，不要求 bootId；
- Runtime 返回原 spawnNonce、新 bootId、PID、Pi 版本；
- nonce 不匹配的 ready 直接拒绝。

序列固定为三层：

1. `commandSequence`：Main→Runtime，按 Runtime 严格递增；
2. `controlSequence`：Runtime→Main，按 Runtime 严格递增，heartbeat/fatal/request response/run lifecycle/tool call/ack 都参与；
3. `eventSequence`：仅 `run.event`，按 run 严格递增并对应产品落盘顺序。

重复序号丢弃；跳号进入 protocol desync，停止接收新 run 并收敛当前 run 为 `runtime_protocol_desync`。requestId 只负责关联响应，不能替代顺序。

### 8.2 Run 生命周期消息

```text
run.start
→ run.rejected | run.accepted
→ run.submitted
→ run.event*
→ run.settled
→ run.persisted
→ run.persisted_ack
```

- `run.rejected`：未取得执行权，包含 typed error；
- `run.accepted`：bundle/配置/锁/sidecar 检查通过；
- `run.submitted`：已调用 Pi prompt，Provider 是否实际收到不可证明；
- accepted 或 submitted 后失败都不得自动重放；
- `run.settled` 携带 finalEventSequence；
- Main 只有消费并持久化到 finalEventSequence 后才发 persisted；
- Runtime pending proxy tools 必须为零或已经进入明确 detached-background 状态才允许 settled。

### 8.3 Tool 更新与 ACK

方向固定：

```text
Main → Runtime: tool.update
Runtime → Main: tool.update_ack
Runtime → Main: tool.cancel_request
Main → Runtime: tool.cancelled
Main → Runtime: tool.result | tool.error
```

每个 toolCall：

- Main 按 50ms 或累计 32KiB（先到者）合并 update；
- update 带 `updateSequence` 和累计字节数；
- Runtime 消费并交给 Pi `onUpdate` 后返回 ACK；
- Main 未确认窗口上限 1MiB；达到上限时暂停可暂停的 source；
- 不可暂停来源只保留最新 256KiB 尾部，并发送一次 `truncated: backpressure_limit`；
- ACK 超时 10 秒将工具标记 `tool_update_consumer_stalled` 并 abort run；
- terminal result 前必须 flush 所有 update，并等待最后 ACK 或明确截断。

### 8.4 消息大小

- 普通控制消息最大 256KiB；
- run bootstrap 不走消息体，走 transfer bundle；
- tool result 大于 256KiB 时写入 `runtime-transfer/{runId}/tool-results/{toolCallId}`，消息只传受控引用/hash/size；
- image 一律传受控文件引用，不传 base64；
- MessagePort 收到超限消息直接 `runtime_protocol_payload_too_large`。

---

## 9. Runtime 错误码

在 `packages/shared/src/types/agent.ts` 的 `ErrorCode` 增加：

| ErrorCode | retryable | UI 标题 | 用户动作 | 产生层 |
|---|---:|---|---|---|
| `runtime_start_failed` | true | Agent Runtime 启动失败 | 重试 | Supervisor |
| `runtime_handshake_failed` | true | Runtime 握手失败 | 重试/重启应用 | Client |
| `runtime_protocol_mismatch` | false | Runtime 版本不兼容 | 更新或重装 | Client |
| `runtime_protocol_desync` | true | Runtime 通信失步 | 重试 | Transport |
| `runtime_protocol_payload_too_large` | false | Runtime 数据超限 | 新会话/减少附件 | Transport |
| `runtime_crashed` | true | Agent Runtime 已崩溃 | 检查副作用后重试 | Supervisor |
| `runtime_unresponsive` | true | Agent Runtime 无响应 | 检查副作用后重试 | Supervisor |
| `runtime_resource_exhausted` | true | Agent Runtime 内存超限 | 缩短会话/压缩后重试 | Supervisor |
| `runtime_capacity_queued` | true | 正在等待运行资源 | 等待/停止其他任务 | Supervisor |
| `runtime_sidecar_locked` | true | 会话运行状态被占用 | 等待或重启应用 | Lock |
| `runtime_sidecar_dirty` | true | 会话运行状态需要恢复 | 自动安全重建后重试 | RuntimeCore |
| `runtime_sidecar_corrupt` | false | 会话运行状态损坏 | 使用显式恢复 | RuntimeCore |
| `runtime_transfer_missing` | true | Runtime 输入已丢失 | 重试 | Transfer |
| `runtime_transfer_invalid_path` | false | Runtime 输入路径非法 | 报告问题 | Transfer |
| `runtime_transfer_hash_mismatch` | false | Runtime 输入校验失败 | 重试/磁盘检查 | Transfer |
| `runtime_transfer_too_large` | false | Runtime 输入过大 | 减少附件或历史 | Transfer |
| `runtime_transfer_expired` | true | Runtime 输入已过期 | 重试 | Transfer |
| `runtime_config_changed_while_active` | true | 运行中不能切换配置 | 停止后重试 | RuntimeCore |
| `runtime_stale_config_revision` | true | Runtime 配置已过期 | 重试 | RuntimeCore |
| `runtime_config_revision_conflict` | false | Runtime 配置冲突 | 重启应用 | RuntimeCore |
| `tool_update_consumer_stalled` | true | 工具输出传输阻塞 | 检查命令后重试 | ToolHost |

同步修改 typed error action、renderer 文案和 BDD 映射测试。未知 Runtime error 不得降级成成功终态。

---

## 10. Runtime 资源预算

默认值和允许范围：

| 配置 | 默认 | 范围 |
|---|---:|---:|
| 最大 running Runtime | 4 | 1..8 |
| 最大 spawn 并发 | 2 | 1..4 |
| 最大 hot-idle Runtime | 2 | 0..4 |
| hot-idle 时间 | 300 秒 | 30..1800 秒 |
| RSS 采样周期 | 10 秒 | 5..60 秒 |
| RSS soft limit | 512MiB | 256..2048MiB |
| RSS hard limit | 1024MiB | 512..4096MiB，且必须大于 soft |

调度：

- running 达上限时 run 进入主进程 FIFO 队列，不 spawn；
- 队列按提交时间严格 FIFO，不做隐藏优先级；
- 队列等待期间发 `runtime_capacity_queued` 状态事件，不作为终态错误；
- 获得 slot 后最多同时 spawn 2 个；
- hot-idle 超过 2 个时按 `lastUsedAt` LRU dispose；
- 新 run 需要 slot 时先回收最老 hot-idle，再决定排队。

RSS：

- soft limit 连续 3 次超限：running 仅告警并请求下一安全点压缩；hot-idle 立即 dispose；
- hard limit 连续 2 次超限：abort run、清理工具、`UtilityProcess.kill()`、收敛 `runtime_resource_exhausted`；
- macOS/Linux 优先读取进程 RSS；Windows 使用可用的进程指标接口；获取失败时只执行进程数量预算，每个 PID 只记录一次诊断，不因监控失败中止 run。

验收：

- 4 Session：允许 4 running，无排队；
- 8 Session：4 running + 4 queued，主进程和 Renderer 保持响应；
- 16 Session：4 running + 12 queued，无额外 utility process；
- 记录每场景主进程 RSS、每 Runtime RSS、首 token、队列等待和退出后内存回落。

---

## 11. Runtime 与 Sidecar 生命周期

### 11.1 sidecar 排他锁

`~/.kila/pi-sessions/{sessionId}/runtime.lock` 使用 `O_CREAT | O_EXCL` 原子创建，内容：

```ts
{ pid, parentPid, processStartTime, appBootId, bootId, generation }
```

必须在创建 `SessionManager` 前获取。锁存在时校验 PID、进程启动时间和父进程；任一无法可靠确认 stale 时返回 `runtime_sidecar_locked`。内存 lease 不能替代文件锁。

### 11.2 卡死和 kill

Electron 39 `UtilityProcess` 只有 `kill()`：

1. 心跳每 5 秒；15 秒无心跳标记 unresponsive；
2. 发送 `run.abort`，等待 5 秒；
3. 发送 `runtime.shutdown`，等待 3 秒；
4. 仍未退出只调用一次 `UtilityProcess.kill()`；
5. 必须等待 `exit` 后才能释放主进程 lease 或删除 sidecar；
6. 未收到 exit 时保持 fenced 状态，禁止启动同 Session 新 Runtime。

### 11.3 应用退出

`before-quit` 使用单一 `shutdownPromise + allowQuit`：

1. preventDefault，拒绝新 run；
2. 同时 abort ToolRegistry、Permission、AskUser、Bash/MCP 当前工作；
3. 发送 active run abort；
4. 等 run settled barrier，总超时 8 秒；
5. 请求 Runtime shutdown；
6. 等 exit 3 秒；
7. 未退出调用 kill 并继续等 exit；
8. shutdown MCP Manager；
9. allowQuit=true，再次 app.quit。

重复 quit、更新安装退出和系统关机复用同一个 Promise，不重复 abort/kill。

---

## 12. 精确代码改造清单

### 12.1 Shared

新增：

```text
packages/shared/src/types/coding-tools.ts
packages/shared/src/types/agent-runtime-protocol.ts
packages/shared/src/types/agent-runtime-transfer.ts
packages/shared/src/types/agent-run-receipt.ts
```

修改：

- `packages/shared/src/types/agent.ts`：新增 Runtime ErrorCode/TypedError action；
- shared exports：导出协议纯类型，不 import Pi 包。

### 12.2 主进程

新增：

```text
apps/electron/src/main/lib/agent-runtime/
├─ runtime-supervisor.ts
├─ runtime-client.ts
├─ runtime-transport.ts
├─ runtime-capacity.ts
├─ runtime-transfer-store.ts
├─ runtime-errors.ts
├─ session-runtime-lease.ts
├─ tool-host.ts
└─ tool-registry.ts

apps/electron/src/main/lib/agent-tools/coding/
├─ schemas.ts
├─ path-policy.ts
├─ read-tool.ts
├─ write-tool.ts
├─ edit-tool.ts
├─ bash-tool.ts
├─ truncation.ts
└─ index.ts

apps/electron/src/main/lib/adapters/remote-pi-agent-adapter.ts
apps/electron/src/main/lib/agent-run-receipt-store.ts
```

修改：

- `agent-service.ts`：固定实例化 Remote adapter/Supervisor；
- `agent-orchestrator.ts`：runId、configRevision、capacity queue、异步 stopAll；
- `agent-orchestrator-context.ts`：删除 Pi coding tool 创建，注册 Kila tools，产出 transfer bundle；
- `agent-orchestrator-stream.ts`：eventSequence、settled→persisted barrier、Runtime typed error；
- `pi-tools-bridge.ts`：descriptor/executor 分离；
- `process-registry.ts`：完整复合 key、session/run abort；
- `session-cleanup-service.ts`：调用三段生命周期；
- `pi-session-state.ts`：仅无 Runtime/lock 时删除；
- `config-paths.ts`：transfer、quarantine、journal/receipt 路径；
- `app-lifecycle.ts` / `main/index.ts`：shutdown barrier。

### 12.3 Utility Runtime

新增：

```text
apps/electron/src/utility/
├─ pi-runtime.ts
├─ pi-runtime-server.ts
├─ pi-runtime-core.ts
├─ proxy-agent-tools.ts
├─ sidecar-lock.ts
├─ sidecar-recovery.ts
└─ parent-watchdog.ts
```

现有 `pi-agent-adapter.ts` 拆分：

- event mapper 移到可被 Utility 使用的纯模块；
- AgentSession/model/compaction/runtime-context 逻辑移入 RuntimeCore；
- 主进程不再引用 Pi adapter/runtime 模块。

### 12.4 静态边界闸门

新增测试：

- `apps/electron/src/main/**` 禁止 value import `@earendil-works/pi-agent-core`、`pi-coding-agent`、`pi-ai`；
- 仅 shared 的 `import type` 可例外；
- 构建后扫描 `dist/main.cjs`，禁止出现 `createAgentSession`、`SessionManager.continueRecent`、`class PiAgentAdapter`；
- `dist/pi-runtime.cjs` 必须包含 Runtime entry，并保持 Pi packages external。

---

## 13. 构建与打包合同

### 13.1 输出和启动路径

固定输出：

```text
apps/electron/dist/main.cjs
apps/electron/dist/preload.cjs
apps/electron/dist/pi-runtime.cjs
```

主进程使用：

```ts
const runtimeEntry = join(__dirname, 'pi-runtime.cjs')
utilityProcess.fork(runtimeEntry, [], {
  env: {
    ...process.env,
    KILA_EXTERNAL_MODULES_DIR: join(process.resourcesPath, 'ext-modules', 'node_modules'),
  },
})
```

开发环境 loader 仍允许 workspace `node_modules`；packaged 环境必须优先 `process.resourcesPath/ext-modules/node_modules`。

### 13.2 package scripts

`apps/electron/package.json` 增加：

```json
{
  "build:pi-runtime": "bun run scripts/build-bundle.ts pi-runtime",
  "watch:pi-runtime": "bun run scripts/build-bundle.ts pi-runtime --watch"
}
```

并修改：

- `dev:electron`：并行 `watch:main`、`watch:pi-runtime`、`watch:preload`、Electron；
- `build`：顺序包含 `build:pi-runtime`；
- `start/pack/dist/dist:mac/dist:win/dist:linux/dist:fast` 继续通过 build 链包含 Runtime；
- electronmon patterns 增加 `dist/pi-runtime.cjs`，Runtime 代码变化时重启 Electron，开发期不做旧 Runtime 热替换。

`build-bundle.ts` target 联合改为 `main | preload | pi-runtime`。Runtime 使用 CJS entry，Pi 包继续 external 并通过原生动态 import 加载。

### 13.3 electron-builder

若现有 `files` 已包含 `dist/**/*`，无需新增 pi-runtime 文件规则；必须新增测试断言它实际进入 `app.asar/dist/pi-runtime.cjs`。现有 ext-modules extraResources 继续使用，不复制第二份 Pi。

Packaged smoke：

- macOS：签名、公证后的 `.app` 启动 Runtime、加载 Pi、完成 mock provider 最小 run、退出后 PID 消失；
- Windows：安装路径含空格和中文，无控制台黑窗，Runtime path/Resources 正确；
- Linux：AppImage 挂载运行和 deb 安装各测一次；
- 三平台均断言 `process.resourcesPath/ext-modules` 可解析 Pi。

---

## 14. 实施阶段与 PR

### 阶段零：边界先行实现（Runtime RPC 硬 Gate）

#### PR 0.1 Kila Coding Tools

- 实现四工具、shared schema、路径策略、截断；
- 替换 `createCodingTools()`；
- 接入 ProcessRegistry；
- parity + BDD 测试。

退出条件：主进程 coding tools 不依赖 Pi SDK，现有 Agent 本地路径行为通过。

#### PR 0.2 ToolHost / ToolRegistry

- descriptor/executor 分离；
- approvedArgs；
- 完整复合 key、幂等、取消、update buffer；
- 先用进程内 transport 测通，不启动 Utility。

退出条件：所有 Kila/MCP/coding tools 通过统一 ToolHost 调用。

#### PR 0.3 Transfer Bundle

- 新增 config paths/store/manifest/hash/清理；
- history/image/tools 改为 bundle；
- 篡改、超限、符号链接、遗留清理测试。

退出条件：不存在依赖“大 RunSpec 单消息”的代码设计。

#### PR 0.4 Run Receipt 与 Dirty Recovery

- run receipt、journal、安全边界；
- quarantine/rebuild；
- accepted/submitted/settled/persisted 状态测试。

退出条件：每个崩溃点均有确定恢复结果，dirty sidecar 不会被直接打开。

#### PR 0.5 生命周期、错误码、资源基准

- 三段生命周期接口；
- ErrorCode/UI；
- 测量 1/4/8/16 个 mock Runtime 的 RSS/启动时间；
- 固化本文资源默认值。

退出条件：阶段零全部测试通过，架构评审确认无隐藏决策。

### 阶段一：Runtime 骨架

#### PR 1.1 协议与 Transport

实现 appBootId/spawnNonce/bootId、三层 sequence、request timeout、payload 限制和协议测试。

#### PR 1.2 Utility 构建与 Supervisor

实现 `dist/pi-runtime.cjs`、fork、heartbeat、capacity/spawn queue、RSS、shutdown/kill。

退出条件：故意 exit/死循环/超内存不影响主进程和其他 Runtime。

### 阶段二：Pi Runtime Core

#### PR 2.1 迁移 AgentSession

迁移 SessionManager、ModelRuntime、resource loader、event mapper、retry、compaction、runtime context。

#### PR 2.2 RemotePiAgentAdapter

实现 query/abort/steer/followUp/waitForIdle/reset/dispose 与 AsyncIterable 事件桥。

退出条件：无工具 run、恢复、retry、compaction 通过。

### 阶段三：接通 Tool RPC

#### PR 3.1 Proxy Tools

Runtime descriptor→proxy tool，接通 call/update/ACK/result/error/cancel。

#### PR 3.2 全工具回归

接通 coding、MCP、memory、vision、web、scheduled、extra tools。

退出条件：ToolHost parity、权限、AskUser、后台 Bash 和迟到结果测试通过。

### 阶段四：完整生命周期

#### PR 4.1 Run Commit 与 Sidecar Recovery

接通 run journal、persisted barrier、quarantine/rebuild 到真实 Runtime。

#### PR 4.2 Delete/Rewind/Regenerate/Quit

接通三段生命周期、tombstone、shutdown barrier、parent watchdog。

退出条件：SIGKILL、dirty sidecar、删除中崩溃和退出重入测试通过。

### 阶段五：一次性切换

#### PR 5.1 三平台 Packaged Smoke

完成签名/安装产物验证和 4/8/16 Session 压测。

#### PR 5.2 删除旧链路

- `AgentService` 固定使用 Remote adapter；
- 删除本地 PiAgentAdapter 生产入口和主进程 Pi imports；
- 删除临时兼容代码；
- 更新 AGENTS/CLAUDE/README；
- 通过静态边界扫描。

退出条件：仓库不存在可在主进程创建 AgentSession 的生产路径。

---

## 15. 必测矩阵

### ToolHost

- 四 coding tool 与旧 Pi fixture parity；
- 路径逃逸、symlink、编码、原子写；
- edit 零匹配/多匹配/多 edit 回滚；
- Permission 修改参数后 UI/审计/实际执行一致；
- 重复 toolCallId 不重复副作用；
- update ACK、慢消费者、1MiB 窗口、截断；
- Bash abort/timeout/background/delete/crash；
- MCP 不可取消时迟到结果被丢弃。

### Transfer Bundle

- 正常 bootstrap；
- manifest/file hash 篡改；
- `..`、绝对路径、symlink；
- 单文件/总大小/图片数量超限；
- accepted 前后崩溃清理；
- 24 小时遗留回收；
- API Key 不进入 bundle 日志和诊断。

### Dirty Sidecar

逐点故障注入：

- accepted 前；
- accepted 后、journal preparing 前；
- preparing 后、prompt 前；
- submitted 后、首 event 前；
- tool.call 前后；
- 工具完成但 tool result 未写 Pi；
- settled 前；
- settled 后、persisted 前；
- persisted 发出但 ACK 丢失；
- 主进程 SIGKILL 后立即重启；
- dirty sidecar quarantine，partial 保留 UI 但不导入；
- clean sidecar 正常复用；
- quarantine 原目录保留诊断。

### 配置与协议

- credentialRevision 热更新不重建；
- fingerprint 变化 idle 重建；
- active 变化 rejected；
- stale/conflict revision；
- command/control/event sequence 重复、跳号、迟到；
- run.rejected/accepted/submitted/settled/persisted；
- payload 超限；
- protocol mismatch。

### 资源和生命周期

- 4/8/16 Session 调度；
- spawn concurrency=2；
- hot-idle LRU；
- RSS soft/hard；
- RSS 获取失败降级；
- Runtime exit、死循环、kill 返回 true/false、exit 迟到；
- reset/dispose/clear 幂等；
- delete tombstone 恢复；
- rewind/regenerate；
- before-quit 重入、更新退出、系统关机；
- 父进程消失 Runtime 自退出。

### Packaged

- macOS 签名公证 `.app`；
- Windows 中文/空格安装路径；
- Linux AppImage/deb；
- Runtime entry 存在；
- ext-modules 可加载；
- mock provider 最小 run；
- 退出无孤儿 PID。

---

## 16. 验证命令

```bash
bun run typecheck
bun run lint
bun run check:file-size
bun test
bun run electron:build

cd apps/electron
bun run build:main
bun run build:pi-runtime
bun run build:preload
```

定向测试至少覆盖：

```bash
bun test \
  apps/electron/src/main/lib/agent-tools/coding \
  apps/electron/src/main/lib/agent-runtime \
  apps/electron/src/main/lib/adapters/pi-agent-adapter.integration.test.ts \
  apps/electron/src/main/lib/adapters/pi-agent-adapter.protocol.test.ts \
  apps/electron/src/main/lib/agent-orchestrator-stream.test.ts \
  apps/electron/src/main/lib/agent-permission-service.test.ts
```

最终合并前必须运行三平台 packaged smoke，开发目录测试不能替代。

---

## 17. Definition of Done

- [ ] 阶段零全部合并后才开始 Runtime RPC；
- [ ] Kila 自有 `read/write/edit/bash`，主进程不调用 Pi coding tool factory；
- [ ] ToolHost 对所有工具提供统一权限、幂等、取消和背压；
- [ ] bootstrap/history/images/tools 使用 transfer bundle，不塞入单条 IPC；
- [ ] dirty sidecar 必须 quarantine，并从最后 settled 安全边界重建；
- [ ] `run.persisted_ack` 是唯一新安全提交点；
- [ ] reset/dispose/clear 三个生命周期无歧义；
- [ ] configRevision/fingerprint/credentialRevision 行为通过测试；
- [ ] Runtime ErrorCode 已进入 shared、UI 和测试；
- [ ] command/control/event 三层 sequence 通过乱序和迟到测试；
- [ ] 最大 running=4、spawn=2、hot-idle=2、RSS 预算生效；
- [ ] 每个 active Session 独立 PID；
- [ ] 单 Runtime 崩溃、死循环、超内存不影响主应用和其他 Session；
- [ ] Session JSONL 与 Pi sidecar 均保持单 writer；
- [ ] delete/rewind/regenerate/quit 无锁、进程或 pending 泄漏；
- [ ] `dist/main.cjs` 不含 Pi AgentSession 创建逻辑；
- [ ] 生产代码只实例化 `RemotePiAgentAdapter`；
- [ ] 不存在 backend feature flag、local fallback 或双 adapter；
- [ ] macOS、Windows、Linux 正式产物通过 Runtime smoke；
- [ ] AGENTS.md、CLAUDE.md、README.md 已同步到最终架构。

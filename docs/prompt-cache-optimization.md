# Prompt/KV Cache 优化

Kila 的 Pi adapter 现在把请求分成稳定前缀和当前轮尾部：

1. system prompt 不包含 session ID；MCP、Skills、工作目录等稳定运行时信息只作为带 fingerprint 的 snapshot 注入一次。
2. 工具按 code-unit 名称排序，JSON Schema 对象 key 递归排序。
3. 普通请求和 Pi compaction 请求使用同一个 Kila session ID 与显式 cache retention。
4. compaction 不再把历史序列化成单段 `<conversation>` 冷启动消息，而是重放上一次真实 provider 请求的 system、tools 和选中消息前缀，最后追加 Pi 的摘要指令。

## retention 配置

模型兼容覆盖可以选择短缓存（默认）或长缓存：

```json
{
  "id": "my-model",
  "compat": {
    "promptCacheRetention": "short"
  }
}
```

只有 provider 同时声明 `supportsLongCacheRetention: true` 时，`long` 才会映射为 provider 的长 TTL；否则 SDK 会安全降级为短缓存。长 TTL 适合跨较长空闲时间复用的会话，短缓存通常更省写入成本。

## 命中率口径

- `cacheHitRate = cacheRead / (cacheRead + cacheCreation)`：已写入缓存部分的复用率。
- `cacheCoverageRate = cacheRead / (input + cacheRead + cacheCreation)`：本次输入总量中由缓存覆盖的比例。

两者不能混用。即使 cache hit rate 接近 100%，新增长的用户消息、工具结果、provider 最小缓存粒度和 compaction 摘要指令仍可能让 coverage 低于 100%。实际结果取决于 provider 的 KV cache 规则；Kila 可以把稳定前缀做到接近 90%+，但不能对不支持 prompt caching 的 provider 保证 100%。


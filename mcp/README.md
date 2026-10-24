# DSH-suggestions MCP

`dsh-suggestions` 安装包内的 stdio MCP 服务，与插件使用同一份提示词策略、校验逻辑和版本号。

| 工具 | 必填输入 | 可选输入 |
|---|---|---|
| `suggest_next_prompt` | `assistantAnswer` | `userRequest`、`recentUserMessages`、`sessionId` |
| `optimize_prompt` | `draft` | `context`、`sessionId` |

无建议时返回空 `content` 与 `structuredContent: {status: "none"}`。后端失败或约束检查失败返回 `isError: true`；参数错误返回 JSON-RPC `-32602`。草稿上限 16000 字符，其他限制见 `tools/list`。

## 配置

启动安装包中的 `mcp/server.mjs`，不要单独复制 `mcp/` 目录；它依赖同包的 `prompt-core.mjs`、`version.mjs` 和 `package.json`。

DSH profile 用户补丁示例（替换 Node 与当前 profile 的安装路径）：

```yaml
- insert:
    - id: mcp-dsh-suggestions
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dsh-suggestions
        transport: stdio
        command: /absolute/path/to/node
        args:
          - /absolute/path/to/profile/node_modules/dsh-suggestions/mcp/server.mjs
        env: {}
        toolCallTimeoutMs: 55000
```

Windows 路径可以使用正斜杠。服务每次调用重读 `~/.dsh/dsh-suggestions-mcp/bridge.json`，适应 DSH 重载和 token 轮换。该文件含私密 token，不能外发。bridge 认证失败或不可达会明确报错。

提供 `sessionId` 时仅使用该会话的模型；未提供时使用 Harness 全局默认模型，不能推断当前活动窗口。

## 可选外部后端

明确设置 `DSS_BRIDGE=off` 后，可以配置兼容的文本生成端点：

```text
DSS_LLM_BASE_URL=https://api.example.com/v1
DSS_LLM_MODEL=<model>
DSS_LLM_API_KEY=<private key if needed>
DSS_LLM_TIMEOUT_MS=30000
```

未发现 bridge 且已配置外部后端时也可以直连。内容会发送到配置的服务，请自行选择目的地。默认 30 秒、最长 45 秒；只接受正常结束的完整输出。

## 协议与测试

JSON-RPC 2.0 over stdio，换行分帧；支持 MCP `2025-06-18`、`2025-03-26`、`2024-11-05`。必须完成 initialize 和 initialized 通知。最多两个调用并发、八个排队；ping 和取消不被慢调用阻塞；单条消息上限 10 MiB。

在仓库根运行 `node mcp/test.mjs`，或 `npm test` 执行全部回归。

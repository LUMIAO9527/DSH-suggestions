# DSH-suggestions MCP

| 工具 | 功能 | 必填参数 |
|---|---|---|
| `suggest_next_prompt` | 根据当前请求和回答建议下一条提示词 | `assistantAnswer`：已完成的回答 |
| `optimize_prompt` | 优化草稿，保留原意与约束 | `draft`：待优化草稿，最多 16000 字符 |

`suggest_next_prompt` 可补充 `userRequest`（当前请求）和 `recentUserMessages`（最近的用户消息）。`optimize_prompt` 可补充 `context`（对话上下文）。

复用 DSH 时，可传入 `sessionId` 使用指定会话的模型；省略时使用 DSH 默认模型。

## 接入 DSH

在 DSH profile 的用户补丁中添加以下配置，并填写本机的 Node 和插件安装路径：

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

## 使用其他模型服务

在 MCP 进程的环境变量中设置：

```text
DSS_BRIDGE=off
DSS_LLM_BASE_URL=https://api.example.com/v1
DSS_LLM_MODEL=<model>
DSS_LLM_API_KEY=<api-key>
DSS_LLM_TIMEOUT_MS=30000
```

`DSS_LLM_BASE_URL` 填写兼容 Chat Completions 的接口地址，`DSS_LLM_TIMEOUT_MS` 为请求超时毫秒数。无需密钥的服务可省略 `DSS_LLM_API_KEY`。

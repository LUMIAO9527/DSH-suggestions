# DSH-suggestions

为 DeepSeek Harness 提供后续提示词建议和草稿优化。

## 安装

**Desktop**：在插件管理中从 GitHub 安装，填写：

```text
github:LUMIAO9527/DSH-suggestions#v0.3.0
```

**Web / CLI**：

```sh
dsh plugin --profile web add github:LUMIAO9527/DSH-suggestions#v0.3.0
```

## 使用

| 功能 | 操作 |
|---|---|
| 后续提示词建议 | 回答完成后，根据当前会话在空输入框中显示建议。按 `Tab` 或 `→` 填入草稿，按 `Esc` 关闭建议。 |
| 草稿优化 | 输入草稿后双击 `Tab`，或将光标移到文末双击 `→`。 |

草稿上限 16000 字符。

## 超时设置

在 DSH profile 的用户补丁中设置生成超时时间，单位为毫秒：

```yaml
- id: dsh-suggestions
  config:
    timeoutMs: 25000
```

## MCP 接入

安装包内的 `mcp/server.mjs` 提供后续提示词建议和草稿优化工具。配置方法见 [MCP 使用说明](mcp/README.md)。

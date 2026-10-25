# DSH-suggestions

为 DeepSeek Harness 提供后续提示词建议和草稿优化。

## 安装

**Desktop**：在插件管理中从 GitHub 安装，填写：

```text
github:LUMIAO9527/DSH-suggestions#v0.4.0
```

**Web / CLI**：

```sh
dsh plugin --profile web add github:LUMIAO9527/DSH-suggestions#v0.4.0
```

## 使用

| 功能 | 操作 |
|---|---|
| 后续提示词建议 | 回答完成后，根据当前会话在空输入框中显示建议。按 `Tab` 或 `→` 填入草稿，按 `Esc` 关闭建议。 |
| 主动生成建议 | 空输入框未显示建议时，双击 `Tab` 或双击 `→` 根据当前聊天记录生成建议。 |
| 翻看建议 | 空输入框显示建议时，双击 `↓` 看下一条，翻到最后一条再双击 `↓` 会重新生成一条；双击 `↑` 回到上一条。 |
| 草稿优化 | 输入草稿后双击 `Tab`，或将光标移到文末双击 `→`。 |

没有聊天记录的新会话不生成建议。双击间隔不超过 500 毫秒；草稿上限 16000 字符。一次会话内最多保留 10 条建议供翻看，采纳、发送消息或切换会话后清空。

## 超时设置

在 DSH profile 的用户补丁中设置生成超时时间，单位为毫秒：

```yaml
- id: dsh-suggestions
  config:
    timeoutMs: 25000
```

## MCP 接入

安装包内的 `mcp/server.mjs` 提供后续提示词建议和草稿优化工具。配置方法见 [MCP 使用说明](mcp/README.md)。

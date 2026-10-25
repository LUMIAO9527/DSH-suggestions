# DSH-suggestions

为 DeepSeek Harness 提供后续提示词建议和草稿优化。

## 安装

**Desktop**：在插件管理中从 GitHub 安装，填写：

```text
github:LUMIAO9527/DSH-suggestions#v0.5.1
```

**Web / CLI**：

```sh
dsh plugin --profile web add github:LUMIAO9527/DSH-suggestions#v0.5.1
```

## 使用

| 功能 | 简介 | 按键 |
|---|---|---|
| 显示建议 | 回答完成后，在空输入框中显示一条下一条消息的建议 | 自动出现 |
| 采纳建议 | 把建议填进草稿，可继续编辑后再发送 | `Tab` 或 `→` |
| 关闭建议 | 隐藏当前这条建议 | `Esc` |
| 翻看建议 | 往下或往上翻看本次会话已给出的建议；翻到最后一条再往下会重新生成 | 双击右 `Alt` / 双击左 `Alt` |
| 主动生成 | 没有显示建议时，根据当前会话生成一条 | 双击 `Tab` 或双击 `→` |
| 草稿优化 | 改写已输入的草稿，保留其中的约束、数字和路径 | 双击 `Tab`，或在文末双击 `→` |
| MCP 工具 | 供其他客户端调用建议生成与草稿优化 | 见 [MCP 说明](mcp/README.md) |

没有聊天记录的新会话不生成建议。双击间隔不超过 500 毫秒；草稿上限 16000 字符。一次会话内最多保留 10 条建议供翻看，采纳、发送消息或切换会话后清空。

## 按键设置

在 DSH 设置的插件页打开 DSH-suggestions 卡片，可以改三组按键：采纳 / 生成 / 优化共用的键、翻到下一条、翻回上一条。点“修改”后直接按下要用的键，保存后立即生效，不用刷新页面；左 `Alt` 和右 `Alt` 算两个不同的键。

按键按 `KeyboardEvent.code` 记录，切换输入法或键盘布局不会失效。同一个键不能给两个动作，冲突时会提示并且不保存；`非法键`或读不到配置时回退到默认值。设置存在 `~/.dsh/dsh-suggestions-config.json`。

## 超时设置

在 DSH profile 的用户补丁中设置生成超时时间，单位为毫秒：

```yaml
- id: dsh-suggestions
  config:
    timeoutMs: 25000
```

## MCP 接入

安装包内的 `mcp/server.mjs` 提供后续提示词建议和草稿优化工具。配置方法见 [MCP 使用说明](mcp/README.md)。

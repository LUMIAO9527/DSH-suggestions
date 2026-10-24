# DSH-suggestions

DeepSeek Harness 输入框插件，提供两个功能：**后续提示词建议**和**当前草稿优化**。界面名称为 **DSH-suggestions**，安装包名为 `dsh-suggestions`。

当前版本：**0.2.1**。已在 DSH Desktop **0.2.1-rc.3** 验证；其他版本尚未逐一验证。

## 使用

- 回答完成、输入框为空时显示一条灰色后续建议；没有合适的下一步就不显示。
- 按 `Tab` 或 `→` 采纳建议，只填入草稿，不自动发送；`Esc` 隐藏本轮建议。
- 有草稿时双击 `Tab`，或在文末双击 `→`，优化草稿。单次方向键仍移动光标。
- 发送消息后立即清除旧建议；正在生成、切换会话或继续编辑时，晚到的旧结果不会回填。
- 优化失败、超时或约束检查未通过时保留原稿。草稿上限 16000 字符，超长拒绝，不截断。

## 从 GitHub 安装

仓库：[LUMIAO9527/DSH-suggestions](https://github.com/LUMIAO9527/DSH-suggestions)。

在 DSH Desktop 的插件管理中选择从 GitHub 安装，填写：

```text
github:LUMIAO9527/DSH-suggestions#v0.2.1
```

Web / CLI 版可以使用：

```sh
dsh plugin --profile web add github:LUMIAO9527/DSH-suggestions#v0.2.1
```

Desktop 使用应用自己的插件管理入口，勿把 Desktop 插件装进 `web` profile。仓库根目录就是插件包，不需要指定子目录，也不需要构建或执行安装脚本。更新时使用经过核对的 release / tag。

## 建议与改写策略

建议优先承接原任务尚未完成的事项，参考最新请求、最近四条用户更正与回答头尾。DSH 注入的运行环境、时间、技能目录和工作区指令不会覆盖真实用户请求。只生成一条候选；允许本轮无建议，不拼本地兜底。

改写保留禁止事项、先后顺序、数字、路径、URL 和代码字面量。输出必须完整结束；规则采取保守策略，但不能保证识别所有语义变化。建议质量仍受所选模型与上下文影响。

提供 `sessionId` 时使用该会话的模型路由；未提供时使用 Harness 全局默认模型，不扫描其他最近会话，不静默切换 provider。

## 配置

插件默认只显示一条建议，单次生成最多 25 秒。同轮结果缓存 15 分钟；失败每轮最多尝试两次，间隔至少十秒。安装后可在 profile 的用户补丁中定向覆盖：

```yaml
- id: dsh-suggestions
  config:
    debug: false
    maxSuggestions: 1
    timeoutMs: 25000
```

## 配套 MCP

同一个安装包包含 [`mcp/server.mjs`](mcp/server.mjs)，提供 `suggest_next_prompt` 和 `optimize_prompt` 两个工具。配置与协议说明见 [MCP README](mcp/README.md)。MCP 与插件共用提示词、约束校验和版本号。

插件注册的 bridge 只接受本机回环访问及 token 认证。发现文件 `~/.dsh/dsh-suggestions-mcp/bridge.json` 含私密 token，不应提交或分享。默认复用 DSH；可选外部后端必须显式配置。

## 开发与验证

Node.js 22.19+（不含 23）或 24+，无额外测试依赖：

```sh
npm test
```

回归覆盖真实用户消息识别、发送后旧建议失效、迟到响应、会话切换、输入法、快捷键、草稿完整性、MCP 初始化、参数校验、取消和并发。夹具只在项目 `_wip/tests/` 中创建并清理。

程序测试不能替代 DSH 页面检查。发布前还应检查界面名称、Tab 采纳、草稿优化和正常发送后的清空行为。发布包通过 `npm pack` 的文件白名单产生，排除 `_wip`、用户配置和发现文件。

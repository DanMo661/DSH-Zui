# dsh-pulse

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 插件：把输入框上方那块待办面板，换成一行 ZCode 风格的**状态胶囊**（DSH Pulse——会话的脉搏）。

```
        ╭──────────────────╮   ╭────────────────────────╮
        │ ☑ 处理中      2/5 │   │ 😀😀😀 ···  已完成   32 │
        ╰──────────────────╯   ╰────────────────────────╯
┌──────────────────────────────────────────────────────────────┐
│  给模型发消息…                                                │
└──────────────────────────────────────────────────────────────┘
```

A DSH plugin that replaces the built-in todo dock above the composer with a ZCode-style
status capsule row: a **todo capsule** (`In progress 2/5`) and an **agent capsule** with
stacked subagent avatars (`Done 32`). Click either one to open the todo list, the running /
just-finished subagents and background jobs, and drill into the subagent / workflow directories.

## 它长什么样

| 位置 | 内容 | 点开以后 |
| --- | --- | --- |
| 左侧胶囊 | `处理中 2/5`（标签按状态是 处理中 / 待处理 / 已完成） | 完整待办列表：已完成划线、进行中是旋转弧线、未开始是空心圆；打开时自动滚到进行中的那一项 |
| 右侧胶囊 | 最多 3 枚子智能体头像 + `···`（还有更多时）+ `活跃中 3` / `已完成 32` | **常驻名册**：运行中的子智能体（耗时 + 停止）、后台任务（耗时 + 两击停止）、已结束的子智能体（保留显示），全部完成时顶部显示各类用量小结，底部是 `子智能体目录 32 ›` 和 `工作流目录 1 ›` |
| 子智能体目录 | 当前会话的直接子智能体，可逐层展开嵌套目录 | 点一行跳到那个子会话 |
| 工作流目录 | 本会话的工作流运行：名称、状态、成员进度 | 只读 |

头像的状态一眼可辨：

- **运行中**：竖长眼，会眨
- **已完成**：左下角绿色对勾徽标
- **已结束但没正常完成**：左下角灰色方块徽标
- **空闲 / 未知**：三个点

名册**常驻**：跑完的子智能体和后台任务不会从列表里消失，只是变成「已完成 / 已结束」态；
只有刷新页面才清空。全部跑完后点开胶囊，顶部会显示本轮各类用量小结
（子智能体 N · 后台任务 M · 工作流 K），更早的历史也都在列表和目录里。

## 安装

### 方式 A：让 DSH 会话里的 Agent 装

```
请用 plugin_manager 的 install_bundle 安装 D:\Work_Project\dsh-status-capsules
```

### 方式 B：`dsh` CLI（本地目录）

```bash
dsh plugin --profile <你的 profile> add link:<本目录的绝对路径>
```

### 方式 C：npm（发布后）

```bash
dsh plugin --profile <你的 profile> add dsh-pulse
```

安装后**重启 DSH**（Host 要加载新的 Loader 条目），再**刷新页面**。

卸载：`dsh plugin --profile <你的 profile> remove dsh-pulse`。卸载或禁用后内置的待办面板原样回来。

## 工作原理

零构建、零依赖（只依赖 DSH 下发的 React；按官方插件规范不引入 Harness Client 包），Host 半边是空实现，
全部功能在 `client.js`。

**接入点。** `ui-conversation` 把内置待办面板注册在 list slot `conversation.input.dock`，id 是 `todo`。
DSH 的 list slot 按 `priority` 升序排列，再按 `id` 去重（先出现者渲染）。本插件用**同一个 id 加更低的
priority** 注册，于是干净地遮蔽内置面板。这个机制用 DSH 自带的 `SlotCore` 实测过：

| 场景 | 实际渲染的条目 |
| --- | --- |
| 安装前 | 内置 `todo`、`goal` |
| 安装后 | 本插件 `todo`（priority −1）、`goal` |
| 禁用 / 卸载本插件 | 内置 `todo` 回到原位 |
| 本插件渲染出错 | 先由插件自己的兜底胶囊接管（8 秒自动重试真实 UI）；兜底再崩才由内置 `todo` 回位 |

也就是说最坏情况只是回到原样，待办功能不会丢。

**数据来源。** 全部是 DSH 现成的客户端标准来源，不新增 RPC，不碰模型上下文：

| 用途 | 来源 |
| --- | --- |
| 待办列表 | `useProjection("todos")`（`tool-todo` 投影） |
| 当前会话的子智能体 | `projectionsBySession[sessionId].values.subagentCatalog` |
| 子会话标题、耗时、是否正常完成 | `useSessions(s => s.byId)` 里的摘要与 `subagentTiming` 投影 |
| 运行状态 | `useSessionStatus()` |
| 工作流运行 | 对话快照里 `workflow-run` 节点（`ui-workflow-run` 折叠出的记录） |
| 后台任务 | `ctx.jobs`（有 `dsh-api-job-controller` 时才有，可选） |

停止子智能体优先走 `subagents.interruptByUser`（DSH 0.2.2-rc.5 起按目标会话授权），旧版 Host 自动退回
`subagents.interruptByParent`；打开子会话走 `uiWorkspace.openSession`——与 DSH 自带的子智能体目录是同两条路径。
浮层用 CSS 锚点定位（与 DSH 自带菜单同一机制，锚在触发胶囊上方居中），极旧内核不支持时自动退回 JS 定位。
组件渲染若出错，错误边界会显示一个最简待办胶囊（悬停可看错误信息），不会吞掉待办功能。

## 兼容性

在 DeepSeek Harness **0.2.2-rc.5**（Desktop，Windows）上开发并实测；遮蔽机制与标准 props 自 0.2.2-rc.1 起一致，
更早版本未测。停止按钮在 rc.5 用 `interruptByUser`、在更早的 rc 版本自动退回 `interruptByParent`。

## 已知限制

- **子智能体不区分「失败」和「被取消」**：DSH 的投影只告诉我们上一轮是否正常完成，所以这两类都显示为「已结束」。
- **工作流目录只看得到已加载的对话窗口**：工作流记录来自对话节点，很长会话里更早的运行要往上翻到才会出现。
- **Goal 条不在同一行**：DSH 自带的目标条（`/goal`）是同一个 slot 里的另一个条目，仍然按原样显示在胶囊行下方。
- **名册是页面级的**：刷新页面后常驻列表清空，之后从目录入口看历史。
- 后台任务的「停止」是两击确认（和 DSH 自带任务列表一致）；子智能体的「停止」是一击即停（和 ZCode 一致）。
- **对话流工具卡替换了内置的子智能体详情行**：以 keyed 覆盖方式接管 `subagent` / `subagent_fork` 的渲染；
  工具卡出错时会自动退回内置的详情行。

## 许可与致谢

MIT，见 [LICENSE](LICENSE)。

子智能体头像与状态胶囊的视觉设计改编自 ZCode（[zai-org/ZCode](https://github.com/zai-org/ZCode)，Apache-2.0），
详见 [NOTICE.md](NOTICE.md)。

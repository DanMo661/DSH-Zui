/**
 * dsh-pulse —— 浏览器半边。
 *
 * 把输入框上方那块 Todo dock 换成一行 ZCode 风格的「状态胶囊」：
 *
 *   [☑ 处理中 2/5]   [😀😀😀 ··· 已完成 32]
 *
 * - 待办胶囊：标签（处理中 / 待处理 / 已完成）+ 完成数，点开是完整待办列表。
 * - 智能体胶囊：最多三枚子智能体头像（运行中 / 完成 / 等待各有表情和徽标）+ 计数。
 *   点开是常驻名册（运行中与已结束的子智能体、后台任务，跑完不消失），
 *   以及「子智能体目录」「工作流目录」两个下钻入口；全部完成时显示各类用量小结。
 * - 对话流：以 priority −1 接管 `tool.call.toolview` 的 subagent / subagent_fork，
 *   在派发子代理的那一步渲染带实时头像与计时的卡片。
 *
 * 接入方式：ui-conversation 把内置 Todo dock 注册在 list slot
 * `conversation.input.dock`、id 为 `todo`。list slot 按 priority 升序排列、
 * 再按 id 去重（先出现者渲染），所以这里用同一个 id 加更低的 priority 注册，
 * 即可干净地遮蔽内置面板；本插件被禁用时内置 Todo dock 自动回到原位。
 * 渲染出错由条目级错误边界接住并显示最简兜底胶囊（8 秒自动重试），
 * 兜底本身再崩才会 abdicate、由内置 Todo dock 回位。
 *
 * 数据全部来自现成的标准来源，不新增任何 RPC：
 * - `useProjection("todos")`                      待办列表（tool-todo 投影）
 * - `useSessions(s => s.projectionsBySession)`    各会话的 `subagentCatalog` 投影
 * - `useSessions(s => s.byId)`                    子会话摘要（标题、耗时、完成状态）
 * - `useSessionStatus()`                          统一运行状态
 * - `useConversation(s => s.views.get("chat"))`   对话节点里的 workflow-run 记录
 * - `ctx.jobs`（可选）                             后台任务名册
 *
 * 视觉参考 ZCode 的 ConversationStatusPanel（Apache-2.0，见 NOTICE.md）。
 */
(function () {
  'use strict';

  const PLUGIN_ID = 'dsh-pulse';
  const NS = 'dsh-pulse';
  const SLOT = 'conversation.input.dock';
  /** 与 ui-conversation 内置 Todo dock 相同的 id：更低 priority 的同 id 条目会遮蔽它。 */
  const TODO_ID = 'todo';
  const TODO_PRIORITY = -1;
  /** 胶囊里最多堆叠几枚头像。 */
  const MAX_AVATARS = 3;
  /** 操作反馈（停止失败提示、两击确认窗口）保留的毫秒数；两击确认与 DSH 自带任务列表一致。 */
  const FEEDBACK_MS = 3000;
  /** 停止请求成功后，按钮最多保持「停止中」这么久。 */
  const STOP_WAIT_MS = 10000;
  /** 错误边界捕获后，隔这么久自动重试真实 UI（仍崩再闩）。 */
  const RECOVERY_MS = 8000;
  const EMPTY = [];

  const DICTS = {
    zh: {
      'todo.running': '处理中',
      'todo.pending': '待处理',
      'todo.completed': '已完成',
      'todo.title': '待办事项',
      'todo.empty': '暂无待办',
      'activity.running': '活跃中',
      'activity.completed': '已完成',
      'activity.title': '智能体活动',
      'agent.running': '运行中',
      'agent.done': '已完成',
      'agent.ended': '已结束',
      'agent.idle': '空闲',
      'summary.counts': '本轮共用了：子智能体 {agents} · 后台任务 {jobs} · 工作流 {flows}',
      'tool.title': '子智能体',
      'tool.running': '运行中',
      'agent.open': '打开子智能体会话',
      'agent.stop': '停止',
      'agent.stopFailed': '停止失败',
      'mode.one-shot': '一次性',
      'mode.continuable': '可续接',
      'mode.external': '外部执行',
      'mode.unknown': '模式未知',
      'directory.subagent': '子智能体目录',
      'directory.workflow': '工作流目录',
      'directory.back': '返回',
      'directory.loading': '正在加载…',
      'directory.empty': '这里还没有子智能体',
      'job.stop': '停止',
      'job.confirmStop': '确认停止',
      'job.stopFailed': '停止失败',
      'workflow.running': '运行中',
      'workflow.completed': '已完成',
      'workflow.cancelled': '已取消',
      'workflow.failed': '失败',
      'workflow.interrupted': '已中断',
      'workflow.members': '{settled}/{total} 个成员',
      'duration.hours': '小时',
      'duration.minutes': '分',
      'duration.seconds': '秒',
      'duration.join': '',
      'model.triggerEmpty': '请选择模型',
      'model.loading': '正在加载模型…',
      'model.aria': '选择模型，当前 {model}',
      'model.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
      'model.effort': '推理等级',
      'model.providerDefault': 'Default',
      'model.listLoading': '正在刷新模型列表…',
      'model.retry': '重试',
      'model.empty': '暂无可用模型',
      'model.searchPlaceholder': '搜索模型…',
      'model.searchEmpty': '没有匹配的模型。',
      'model.noEfforts': '当前模型未提供推理等级。',
      'model.error': '模型操作失败：{message}',
      'model.sessionInUse': '当前会话已被占用，可能是其他正在运行的 DSH 导致的，请退出其他正在运行的 DSH 后重试。',
      'model.accountProvider': 'DeepSeek 账号',
      'model.count': '{count} 个模型',
      'trigger.request': '收到执行请求',
      'trigger.continue': '收到继续请求',
      'trigger.goal': '继续执行目标',
      'trigger.agent': '收到任务消息',
      'trigger.team': '收到团队消息',
      'trigger.subagent': '子任务状态更新',
      'trigger.subagent.completed': '子智能体已完成任务',
      'trigger.subagent.aborted': '子智能体任务已停止',
      'trigger.subagent.error': '子智能体任务失败',
      'trigger.subagent.maxTokens': '子智能体任务超出长度上限',
      'trigger.subagent.refusal': '子智能体拒绝了任务',
      'trigger.subagent.unknown': '子任务状态更新',
      'trigger.schedule': '定时任务触发',
      'trigger.job': '后台任务唤醒',
      'trigger.plugin': '插件唤醒',
      'trigger.github': 'GitHub 触发',
      'trigger.webhook': 'Webhook 触发',
      'refresh.title': '刷新页面（插件或样式没同步时点这里）',
    },
    en: {
      'todo.running': 'In progress',
      'todo.pending': 'To do',
      'todo.completed': 'Done',
      'todo.title': 'Tasks',
      'todo.empty': 'No to-dos yet',
      'activity.running': 'Active',
      'activity.completed': 'Done',
      'activity.title': 'Agent activity',
      'agent.running': 'Running',
      'agent.done': 'Completed',
      'agent.ended': 'Ended',
      'agent.idle': 'Idle',
      'summary.counts': 'Used this turn: {agents} subagents · {jobs} background jobs · {flows} workflows',
      'tool.title': 'Subagent',
      'tool.running': 'Running',
      'agent.open': 'Open subagent session',
      'agent.stop': 'Stop',
      'agent.stopFailed': 'Stop failed',
      'mode.one-shot': 'one-shot',
      'mode.continuable': 'continuable',
      'mode.external': 'external',
      'mode.unknown': 'unknown mode',
      'directory.subagent': 'Subagent directory',
      'directory.workflow': 'Workflow directory',
      'directory.back': 'Back',
      'directory.loading': 'Loading…',
      'directory.empty': 'No subagents yet',
      'job.stop': 'Stop',
      'job.confirmStop': 'Confirm stop',
      'job.stopFailed': 'Stop failed',
      'workflow.running': 'Running',
      'workflow.completed': 'Completed',
      'workflow.cancelled': 'Cancelled',
      'workflow.failed': 'Failed',
      'workflow.interrupted': 'Interrupted',
      'workflow.members': '{settled}/{total} members',
      'duration.hours': 'h',
      'duration.minutes': 'm',
      'duration.seconds': 's',
      'duration.join': ' ',
      'model.triggerEmpty': 'Select model',
      'model.loading': 'Loading models…',
      'model.aria': 'Select model, current {model}',
      'model.ariaEffort': 'Select model, current {model}, effort {effort}',
      'model.effort': 'Effort',
      'model.providerDefault': 'Default',
      'model.listLoading': 'Refreshing model list…',
      'model.retry': 'Retry',
      'model.empty': 'No models available.',
      'model.searchPlaceholder': 'Search models…',
      'model.searchEmpty': 'No matching models.',
      'model.noEfforts': 'This model provides no reasoning effort levels.',
      'model.error': 'Model action failed: {message}',
      'model.sessionInUse': 'This session is already in use. Quit other running DSH instances and try again.',
      'model.accountProvider': 'DeepSeek Account',
      'model.count': '{count} models',
      'trigger.request': 'Received a run request',
      'trigger.continue': 'Received a continue request',
      'trigger.goal': 'Goal continuation',
      'trigger.agent': 'Received an agent message',
      'trigger.team': 'Received a team message',
      'trigger.subagent': 'Subtask status update',
      'trigger.subagent.completed': 'Subagent finished its task',
      'trigger.subagent.aborted': 'Subagent task was stopped',
      'trigger.subagent.error': 'Subagent task failed',
      'trigger.subagent.maxTokens': 'Subagent task ran out of tokens',
      'trigger.subagent.refusal': 'Subagent declined the task',
      'trigger.subagent.unknown': 'Subtask status update',
      'trigger.schedule': 'Scheduled task fired',
      'trigger.job': 'Background job woke the session',
      'trigger.plugin': 'Plugin woke the session',
      'trigger.github': 'GitHub trigger',
      'trigger.webhook': 'Webhook trigger',
      'refresh.title': 'Refresh page (use this when the plugin or styles look stale)',
    },
  };

  const CSS = [
    // ---- 状态行：宽度与内置 Todo / Goal dock 对齐输入卡片 ----
    '.dsc-row{box-sizing:border-box;flex:none;position:relative;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,780px) - 4 * var(--dsh-composer-dock-inset,8px));margin:0 auto;padding:0 0 2px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;line-height:20px;container-type:inline-size}',
    '.dsc-capsule-wrap{display:inline-flex;min-width:0;max-width:100%}',
    // ---- 胶囊 ----
    '.dsc-capsule{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;min-width:0;max-width:100%;padding:0 10px 0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .12s ease,border-color .12s ease;anchor-name:var(--dsc-anchor)}',
    '@media(hover:hover){.dsc-capsule:hover{border-color:var(--dsw-alias-border-l3);--dsc-face-ring:var(--dsw-alias-interactive-bg-hover)}}',
    '.dsc-capsule[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);--dsc-face-ring:var(--dsw-alias-interactive-bg-hover)}',
    '.dsc-capsule-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}',
    '.dsc-capsule-icon svg,.dsc-glyph svg,.dsc-stop svg,.dsc-back svg{display:block}',
    '.dsc-capsule-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.dsc-capsule-count{flex:none;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
    '@container (max-width:420px){.dsc-capsule-label{display:none}}',
    // ---- 头像堆叠 ----
    // width:auto + justify-content:flex-start 是必须的：堆叠元素同时带着
    // .dsc-capsule-icon 的 width:16px/justify-content:center，会把 40~60px 的头像
    // 行居中溢出 16px 盒子，左半直接逃出胶囊左缘（子代理超过 3 个、溢出指示器
    // 出现时最明显——已踩坑）。
    '.dsc-stack{display:inline-flex;align-items:center;height:16px;width:auto;justify-content:flex-start}',
    '.dsc-stack-slot{position:relative;flex:none;width:12px;height:16px}',
    '.dsc-stack-slot:last-child{width:16px}',
    '.dsc-stack-slot>.dsc-face{position:absolute;left:0;top:0}',
    '.dsc-more{flex:none;margin-left:4px;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:5px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}',
    '.dsc-face{--dsc-face-eye:rgba(255,255,255,.94);--dsc-face-ring:var(--dsw-specific-menu);display:block;flex:none;overflow:visible}',
    '.dsc-face-eyes{transform-origin:10px 9px}',
    '.dsc-face[data-state=running] .dsc-face-eyes{animation:dsc-blink 3.4s ease-in-out infinite}',
    '.dsc-face[data-state=idle]{opacity:.82}',
    '@keyframes dsc-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}',
    '@media (prefers-reduced-motion:reduce){.dsc-face[data-state=running] .dsc-face-eyes{animation:none}}',
    // ---- 浮层：portal 到 body，CSS 锚点定位（与 DSH 自带菜单同一机制）----
    // 触发胶囊带 --dsc-anchor 变量（CSS 里展开为 anchor-name），portal 出来的面板带
    // position-anchor，用 left:anchor(center) + translate:-50% 把面板水平居中在胶囊
    // 正上方。right/justify-self 显式写成 auto/normal：万一页面上残留旧版本样式表
    // （HMR 重建累积），旧规则的 right:anchor(right)、justify-self:anchor-center 会
    // 与新规则合并成「锚点居中后再平移半个宽度」的错误级联，把面板推离胶囊——已踩坑。
    // 胶囊太靠边时由 Popover 里的 usePopoverClamp 补像素位移；开面板后还会实测一次，
    // 真没居中就整体切到 JS 定位。不支持锚点定位的旧内核直接走 JS 兜底（见 Popover）。
    '.dsc-popover{z-index:1100;box-sizing:border-box;position:fixed;position-anchor:var(--dsc-anchor);bottom:calc(anchor(top) + 8px);left:anchor(center);right:auto;justify-self:normal;translate:-50% 0;width:fit-content;min-width:min(280px,100vw - 24px);max-width:min(340px,100vw - 24px);max-height:min(60dvh,calc(100dvh - 128px));overflow:hidden auto;padding:6px;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:default;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
    '.dsc-head{display:flex;align-items:center;gap:6px;min-height:32px;padding:2px 4px 6px 2px;font-weight:500;color:var(--dsw-alias-label-primary)}',
    '.dsc-back{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
    '@media(hover:hover){.dsc-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
    // ---- 列表与行 ----
    '.dsc-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1px}',
    '.dsc-item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:32px;margin:0;padding:5px 8px;border:0;border-radius:var(--dsw-radius-md);background:none;color:inherit;font:inherit;text-align:left}',
    '.dsc-item--clickable{position:relative;cursor:pointer}',
    '@media(hover:hover){.dsc-item--clickable:hover{background:var(--dsw-alias-interactive-bg-hover);--dsc-face-ring:var(--dsw-alias-interactive-bg-hover)}}',
    // 整行透明的「打开」按钮垫在底层；正文不拦指针，chevron 与停止按钮浮在上面。
    '.dsc-item-hit{position:absolute;inset:0;z-index:0;margin:0;padding:0;border:0;border-radius:inherit;background:none;cursor:pointer}',
    '.dsc-item--clickable>.dsc-glyph,.dsc-item--clickable>.dsc-main,.dsc-item--clickable>.dsc-chevron-space{position:relative;z-index:1;pointer-events:none}',
    '.dsc-item--clickable>.dsc-chevron,.dsc-item--clickable>.dsc-stop{position:relative;z-index:2}',
    '.dsc-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-glyph--success{color:var(--dsw-alias-state-success-primary)}',
    '.dsc-glyph--strong{color:var(--dsw-alias-label-primary)}',
    '.dsc-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.dsc-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
    '.dsc-sub{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-sub--error{color:var(--dsw-alias-state-error-primary)}',
    '.dsc-item[data-state=done]>.dsc-main>.dsc-title{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
    '.dsc-stop{flex:none;display:inline-flex;align-items:center;gap:4px;height:22px;margin-left:4px;padding:0 7px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:16px;cursor:pointer}',
    '@media(hover:hover){.dsc-stop:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
    '.dsc-stop:disabled{opacity:.5;cursor:default}',
    '.dsc-stop[data-armed]{color:var(--dsw-alias-state-error-primary)}',
    '.dsc-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:0 0 0 -4px;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
    '@media(hover:hover){.dsc-chevron:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
    '.dsc-chevron svg{transition:transform .15s ease}',
    '.dsc-chevron[aria-expanded=true] svg{transform:rotate(90deg)}',
    '.dsc-chevron-space{flex:none;width:20px;height:20px}',
    '.dsc-trailing{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-count{flex:none;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-sep{height:0;margin:5px 4px;border-top:0.5px solid var(--dsw-alias-border-l1)}',
    '.dsc-empty{padding:8px;font-size:12px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
    // ---- 待办列表 ----
    '.dsc-todo-item{min-height:30px;padding:4px 8px}',
    '.dsc-todo-text{min-width:0;flex:1;overflow-wrap:anywhere;line-height:20px;color:var(--dsw-alias-label-primary)}',
    '.dsc-todo-item[data-status=pending] .dsc-todo-text{color:var(--dsw-alias-label-secondary)}',
    '.dsc-todo-item[data-status=completed] .dsc-todo-text{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}',
    // ---- 工作流状态灯 ----
    '.dsc-lamp{flex:none;width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-label-tertiary)}',
    '.dsc-lamp--ongoing{background:var(--dsw-alias-state-business-primary);animation:dsc-pulse 1.6s ease-in-out infinite}',
    '.dsc-lamp--done{background:var(--dsw-alias-state-success-primary)}',
    '.dsc-lamp--error{background:var(--dsw-alias-state-error-primary)}',
    '@keyframes dsc-pulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '@media (prefers-reduced-motion:reduce){.dsc-lamp--ongoing{animation:none}}',
    // ---- 进行中的待办：旋转弧线 ----
    '.dsc-glyph--spin svg{color:var(--dsw-alias-label-primary)}',
    '.dsc-todo-spin{animation:dsc-rotate .9s linear infinite}',
    '.dsc-todo-spin path{transform-origin:8px 8px}',
    '@keyframes dsc-rotate{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){.dsc-todo-spin{animation:none;opacity:.7}}',
    // ---- 浮层小结行（任务完成后各类用量）----
    '.dsc-summary{margin:0;padding:3px 8px 5px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
    // ---- 对话流中的子智能体工具卡 ----
    '.dsc-toolcard{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}',
    '.dsc-toolcard-head{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:30px;margin:0;padding:4px 8px;border:0;border-radius:var(--dsw-radius-md);background:none;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
    '@media(hover:hover){.dsc-toolcard-head:hover{background:var(--dsw-alias-interactive-bg-hover);--dsc-face-ring:var(--dsw-alias-interactive-bg-hover)}}',
    '.dsc-toolcard-head:focus-visible{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    '.dsc-toolcard-head>.dsc-main{flex:1;min-width:0}',
    '.dsc-toolcard-state{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-toolcard-state svg{display:block}',
    '.dsc-toolcard-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-toolcard-chevron svg{transition:transform .15s ease}',
    '.dsc-toolcard-head[aria-expanded=true] .dsc-toolcard-chevron svg{transform:rotate(90deg)}',
    '.dsc-toolcard-body{margin:2px 0 4px;padding:6px 8px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover)}',
    '.dsc-toolcard-desc{margin:0 0 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
    '.dsc-toolcard-pre{margin:0;max-height:180px;overflow:auto;font-family:var(--dsw-font-family,ui-monospace,monospace);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
    // ---- 模型选择座位：ZCode 风格双栏（provider 列 + 模型列 + 推理等级分档）----
    '.dsc-popover--wide{min-width:min(500px,100vw - 24px);max-width:min(640px,100vw - 24px)}',
    '.dsc-modelpop{display:flex;gap:8px;align-items:stretch;padding:2px 0 0}',
    '.dsc-modelpop-side{flex:none;width:150px;max-height:min(320px,42dvh);overflow:hidden auto;display:flex;flex-direction:column;gap:1px}',
    '.dsc-modelpop-main{flex:1;min-width:0;max-height:min(320px,42dvh);overflow:hidden auto;display:flex;flex-direction:column;gap:1px}',
    '.dsc-mrow{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-height:30px;margin:0;padding:4px 8px;border:0;border-radius:var(--dsw-radius-md);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
    '@media(hover:hover){.dsc-mrow:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
    '.dsc-mrow[aria-checked=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}',
    '.dsc-mrow[disabled]{opacity:.55;cursor:default}',
    '.dsc-mrow-copy{flex:1;min-width:0;display:flex;align-items:center;gap:6px;overflow:hidden}',
    '.dsc-mrow-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dsc-mrow-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
    '.dsc-mrow-check{flex:none;display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-state-success-primary)}',
    '.dsc-mrow-check svg{width:14px;height:14px}',
    '.dsc-badge{flex:none;display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400;line-height:18px}',
    '.dsc-badge[data-tone=success]{color:var(--dsw-alias-state-success-primary)}',
    '.dsc-badge[data-tone=info],.dsc-badge[data-tone=brand]{color:var(--dsw-alias-brand-primary)}',
    '.dsc-badge[data-tone=warning]{color:var(--dsw-alias-state-warning-primary)}',
    '.dsc-modelpop-foot{flex:none;display:flex;align-items:center;gap:10px;min-height:36px;padding:6px 2px 2px;border-top:0.5px solid var(--dsw-alias-border-l1);margin-top:4px}',
    '.dsc-modelpop-footlabel{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px}',
    '.dsc-effort{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}',
    '.dsc-effort-pill{box-sizing:border-box;display:inline-flex;align-items:center;min-height:24px;padding:2px 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
    '.dsc-effort-pill[aria-checked=true]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-accent,#fff);font-weight:500}',
    '@media(hover:hover){.dsc-effort-pill:hover:not([aria-checked=true]):not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
    '.dsc-effort-pill[disabled]{opacity:.55;cursor:default}',
    '.dsc-modelpop-search{box-sizing:border-box;width:100%;min-height:28px;margin:0 0 4px;padding:3px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px}',
    '.dsc-modelpop-search::placeholder{color:var(--dsw-alias-label-tertiary)}',
    '.dsc-modelpop-search:focus-visible{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:0}',
    '.dsc-modelpop-note{padding:6px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px}',
    '.dsc-modelpop-error{margin-top:4px;padding:5px 8px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
    '.dsc-modelseat-effort{color:var(--dsw-alias-label-tertiary);font-size:12px}',
    '.dsc-mrow:focus-visible,.dsc-effort-pill:focus-visible{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    // ---- 回合触发标记：keyed 接管 turn-trigger，事件带发送者头像脸与身份 ----
    '.dsc-trigger{display:flex;align-items:flex-start;gap:6px;margin:2px 0;padding:1px 8px 1px 0}',
    '.dsc-trigger-face{flex:none;display:inline-flex;margin-top:2px}',
    '.dsc-trigger-head{flex:1;min-width:0;display:flex;align-items:center;gap:6px;min-height:24px;padding:2px 8px;border:0;border-radius:var(--dsw-radius-md);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}',
    '@media(hover:hover){.dsc-trigger-head:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
    '.dsc-trigger-head:focus-visible{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    '.dsc-trigger-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dsc-trigger-sender{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}',
    '.dsc-trigger-time{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}',
    '.dsc-trigger-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary)}',
    '.dsc-trigger-chevron svg{transition:transform .15s ease}',
    '.dsc-trigger-chevron[data-open] svg{transform:rotate(90deg)}',
    '.dsc-trigger-body{margin:0 0 2px 26px;padding:6px 8px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;font-family:var(--dsw-font-family,inherit)}',
    // ---- 刷新页面按钮：应用没绑 Ctrl+R，插件/样式没同步时点它整页重载 ----
    '.dsc-refresh{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:999px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
    '@media(hover:hover){.dsc-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
    '.dsc-refresh:focus-visible{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    '.dsc-refresh svg{display:block}',
    // ---- 焦点 ----
    '.dsc-capsule:focus-visible,.dsc-item-hit:focus-visible,.dsc-item--clickable:focus-visible,.dsc-back:focus-visible,.dsc-stop:focus-visible,.dsc-chevron:focus-visible{outline:1.5px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  ].join('');

  window.__ModuleLoader__.load({
    id: PLUGIN_ID,
    factory(require) {
      const React = require('react');
      const h = React.createElement;
      const ReactDOM = require('react-dom');
      const { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } = React;

      /**
       * 浮层定位优先走 CSS 锚点定位（DSH 自带菜单同一机制，见 .dsc-popover 规则），
       * 极旧内核不支持时回退到 JS 定位。按官方文档要求不引入 Harness Client 包：
       * 外点关闭、Escape 与状态灯在本插件内自行实现。
       */
      const CSS_ANCHOR = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('anchor-name: --dsc-x');

      // ------------------------------------------------------------------
      // 纯函数：文案、时长、数据归类
      // ------------------------------------------------------------------

      function cls() {
        let out = '';
        for (let index = 0; index < arguments.length; index += 1) {
          const part = arguments[index];
          if (part) out = out ? out + ' ' + part : part;
        }
        return out;
      }

      /** 优先用 DSH locale 绑定的 `t`，缺失时回退到内置词典；两种来源都补一次 `{name}` 插值。 */
      function makeT(t, lang) {
        const dict = DICTS[lang] || DICTS.zh;
        return function tt(key, params) {
          let text;
          try {
            text = typeof t === 'function' ? t(key, params) : undefined;
          } catch (error) {
            text = undefined;
          }
          if (typeof text !== 'string' || text === '' || text === key) text = dict[key] ?? DICTS.zh[key] ?? key;
          if (params) {
            for (const name of Object.keys(params)) {
              const token = '{' + name + '}';
              if (text.indexOf(token) >= 0) text = text.split(token).join(String(params[name]));
            }
          }
          return text;
        };
      }

      /** 至多两个相邻单位的时长：「1小时 03分」「2分 05秒」「42秒」；单位之间用 `duration.join` 连接。 */
      function formatDuration(ms, t) {
        if (!Number.isFinite(ms) || ms < 0) return '';
        const total = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;
        const pad = (value) => String(value).padStart(2, '0');
        const join = t('duration.join');
        if (hours > 0) return hours + t('duration.hours') + join + pad(minutes) + t('duration.minutes');
        if (minutes > 0) return minutes + t('duration.minutes') + join + pad(seconds) + t('duration.seconds');
        return seconds + t('duration.seconds');
      }

      function todoSummary(todos) {
        let completed = 0;
        let active = 0;
        for (const item of todos) {
          if (item?.status === 'completed') completed += 1;
          else if (item?.status === 'in_progress') active += 1;
        }
        const total = todos.length;
        const status = active > 0 ? 'running' : completed === total ? 'completed' : 'pending';
        return { total, completed, active, status };
      }

      /**
       * 把一条目录条目归类成头像状态。
       * - running：正在跑（眨眼）
       * - done：上一轮正常结束（绿色对勾徽标）
       * - ended：跑过但没正常结束（灰色方块徽标）
       * - idle：还没跑过或状态未知（三点）
       */
      function classifyChild(entry, summaries, statuses) {
        const id = entry.id;
        const summary = summaries ? summaries[id] : undefined;
        let statusRunning;
        try {
          statusRunning = statuses && typeof statuses.get === 'function' ? statuses.get(id)?.running : undefined;
        } catch (error) {
          statusRunning = undefined;
        }
        const running = (statusRunning ?? summary?.running) === true;
        const timing = summary?.projectionValues?.subagentTiming;
        const lastTurnCompleted = timing?.lastTurnCompleted;
        const state = running ? 'running' : lastTurnCompleted === true ? 'done' : lastTurnCompleted === false ? 'ended' : 'idle';
        return {
          id,
          label: entry.label || id,
          mode: entry.mode,
          external: entry.mode === 'external',
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
          title: typeof summary?.title === 'string' ? summary.title : undefined,
          timing,
          state,
          running,
        };
      }

      function buildChildren(snapshot, summaries, statuses) {
        const entries = snapshot?.values?.subagentCatalog;
        if (!Array.isArray(entries)) return EMPTY;
        const out = [];
        for (const entry of entries) {
          if (entry && typeof entry.id === 'string') out.push(classifyChild(entry, summaries, statuses));
        }
        return out;
      }

      /** 与 ui-subagent 同一口径的耗时：已结算轮次 + 当前轮次。 */
      function elapsedOf(timing, running, now) {
        if (!timing || typeof timing.settledMs !== 'number') return undefined;
        if (!timing.active || typeof timing.active.since !== 'number') return timing.settledMs;
        const end = running ? now : timing.active.through;
        return timing.settledMs + Math.max(0, end - timing.active.since);
      }

      const isLiveJob = (job) => Boolean(job) && (job.status === 'running' || job.status === 'stopping');

      /** 胶囊里的头像名额：先给运行中，其次已完成，再按创建时间新→旧；展示时已完成的在左。 */
      function pickAvatars(children) {
        const rank = (agent) => (agent.running ? 0 : agent.state === 'done' ? 1 : 2);
        return children
          .map((agent, index) => ({ agent, index }))
          .sort((left, right) => rank(left.agent) - rank(right.agent) || right.agent.createdAt - left.agent.createdAt || left.index - right.index)
          .slice(0, MAX_AVATARS)
          .map((item) => item.agent)
          .sort((left, right) => Number(left.running) - Number(right.running));
      }

      // ------------------------------------------------------------------
      // 选择器（保持引用稳定，避免对话流式更新时无谓重渲染）
      // ------------------------------------------------------------------

      const selectProjections = (state) => state?.projectionsBySession;
      const selectById = (state) => state?.byId;
      const selectSelf = (value) => value;
      const runCache = typeof WeakMap === 'function' ? new WeakMap() : null;

      /** 对话快照里的 workflow-run 节点（ui-workflow-run 折叠出的运行记录）。按快照身份缓存。 */
      function selectWorkflowRuns(value) {
        let chat;
        try {
          chat = value?.views?.get?.('chat');
        } catch (error) {
          chat = undefined;
        }
        if (!chat || typeof chat !== 'object') return EMPTY;
        const cached = runCache?.get(chat);
        if (cached) return cached;
        const order = Array.isArray(chat.order) ? chat.order : EMPTY;
        const nodes = chat.nodes;
        let runs = EMPTY;
        if (nodes && typeof nodes.get === 'function') {
          for (const key of order) {
            const node = nodes.get(key);
            if (node?.kind === 'workflow-run' && node.data) {
              if (runs === EMPTY) runs = [];
              runs.push(node.data);
            }
          }
        }
        runCache?.set(chat, runs);
        return runs;
      }

      const NOOP_SUBSCRIBE = () => () => {};

      /** 当前会话的后台任务行；jobs 服务缺席时恒为空数组（hook 调用顺序保持不变）。 */
      function useJobRows(service, sessionId) {
        const source = service?.state && typeof service.state.getSnapshot === 'function' ? service.state : null;
        // subscribe / getSnapshot 是依赖 `this` 的方法，必须包成闭包再交给 useSyncExternalStore；
        // 直接传方法引用会在调用时丢失 `this`（"Cannot read properties of undefined"）。
        const subscribe = useCallback((listener) => source.subscribe(listener), [source]);
        const getRows = useCallback(() => source.getSnapshot().rows[sessionId], [source, sessionId]);
        const rows = React.useSyncExternalStore(
          source ? subscribe : NOOP_SUBSCRIBE,
          source
            ? () => {
                try {
                  const list = getRows();
                  return Array.isArray(list) ? list : EMPTY;
                } catch (error) {
                  return EMPTY;
                }
              }
            : () => EMPTY,
        );
        useEffect(() => {
          if (service && typeof service.watchRows === 'function') return service.watchRows(sessionId);
          return undefined;
        }, [service, sessionId]);
        return rows;
      }

      /** 每秒走表，仅在 `active` 时运行。 */
      function useTicker(active) {
        const [now, setNow] = useState(() => Date.now());
        useEffect(() => {
          if (!active) return undefined;
          setNow(Date.now());
          const timer = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(timer);
        }, [active]);
        return now;
      }

      /** 置位后 `timeout` 毫秒自动复位的标记。 */
      function useTransientFlag(timeout) {
        const [on, setOn] = useState(false);
        useEffect(() => {
          if (!on) return undefined;
          const timer = setTimeout(() => setOn(false), timeout);
          return () => clearTimeout(timer);
        }, [on, timeout]);
        return [on, setOn];
      }

      // ------------------------------------------------------------------
      // 定位兜底：浏览器不支持 CSS 锚点定位时的最小 JS 实现
      // （测量锚点与面板矩形，跟随滚动 / 缩放，约束在视口内）。
      // ------------------------------------------------------------------

      function fallbackAnchoredPosition({ open, anchorRef, panelRef, enabled }) {
        const [position, setPosition] = useState(null);
        useLayoutEffect(() => {
          if (!open || !enabled) {
            setPosition(null);
            return undefined;
          }
          const place = () => {
            const anchor = anchorRef.current?.getBoundingClientRect();
            const panel = panelRef.current;
            if (!anchor || !panel) return;
            const margin = 12;
            const width = panel.offsetWidth;
            // 水平：面板中心对齐胶囊中心，再约束在视口内；垂直：底边悬在胶囊上方 8px。
            const idealLeft = anchor.left + anchor.width / 2 - width / 2;
            const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - margin - width));
            const top = Math.max(margin, anchor.top - 8 - panel.offsetHeight);
            setPosition((current) => (current && current.left === left && current.top === top ? current : { left, top }));
          };
          place();
          // 内容增删（子代理完成、行数变化）会改面板宽度，头像增删会改胶囊宽度，
          // 都用 RO 重新落位。
          const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
          if (observer && panelRef.current) observer.observe(panelRef.current);
          if (observer && anchorRef.current) observer.observe(anchorRef.current);
          window.addEventListener('resize', place);
          window.addEventListener('scroll', place, true);
          return () => {
            if (observer) observer.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
          };
        }, [open, enabled, anchorRef, panelRef]);
        return position;
      }

      /**
       * CSS 锚点定位路径的水平夹取：面板靠 left:anchor(center) + translate:-50% 居中在
       * 胶囊上方，但胶囊贴近视口边缘时面板会伸出去；这里量一下理想位置，超出视口就返回
       * 一个像素级补偿值（拼进 translate），把面板整体拉回视口内。
       */
      function usePopoverClamp({ open, anchorRef, panelRef, enabled }) {
        const [shift, setShift] = useState(0);
        useLayoutEffect(() => {
          if (!open || !enabled) {
            setShift(0);
            return undefined;
          }
          const clamp = () => {
            const anchor = anchorRef.current?.getBoundingClientRect();
            const panel = panelRef.current;
            if (!anchor || !panel) return;
            const margin = 12;
            const width = panel.offsetWidth;
            const idealLeft = anchor.left + anchor.width / 2 - width / 2;
            const wantLeft = Math.max(margin, Math.min(idealLeft, window.innerWidth - margin - width));
            const next = wantLeft - idealLeft;
            setShift((current) => (current === next ? current : next));
          };
          clamp();
          const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(clamp) : null;
          if (observer && panelRef.current) observer.observe(panelRef.current);
          window.addEventListener('resize', clamp);
          return () => {
            if (observer) observer.disconnect();
            window.removeEventListener('resize', clamp);
          };
        }, [open, enabled, anchorRef, panelRef]);
        return shift;
      }

      // ------------------------------------------------------------------
      // 图标与头像
      // ------------------------------------------------------------------

      function svg(props, children) {
        return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false, ...props }, children);
      }

      const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };

      const ICON = {
        /** 清单（待办胶囊图标）。 */
        checks() {
          return svg({ ...STROKE }, [
            h('path', { key: 'a', d: 'M2.5 4.2l1.2 1.2 2.3-2.4' }),
            h('path', { key: 'b', d: 'M2.5 11.2l1.2 1.2 2.3-2.4' }),
            h('path', { key: 'c', d: 'M8.6 4.6h4.9' }),
            h('path', { key: 'd', d: 'M8.6 11.6h4.9' }),
          ]);
        },
        /** 圆圈对勾（待办全部完成）。 */
        done(props) {
          return svg({ ...STROKE, ...props }, [
            h('circle', { key: 'c', cx: 8, cy: 8, r: 6.1 }),
            h('path', { key: 'p', d: 'M5.2 8.1l1.9 1.9 3.7-3.9' }),
          ]);
        },
        /** 活动波形（只有后台任务、没有子智能体时的图标）。 */
        pulse() {
          return svg({ ...STROKE }, [h('path', { key: 'p', d: 'M1.8 8.4h2.9l1.7-4.4 2.6 8 1.9-4.2 1 1.2h2.3' })]);
        },
        /** 芯片（模型选择座位）。 */
        chip() {
          return svg({ ...STROKE }, [
            h('rect', { key: 'r', x: 4.4, y: 4.4, width: 7.2, height: 7.2, rx: 1.6 }),
            h('path', { key: 'pins', d: 'M6.3 1.8v2.6M9.7 1.8v2.6M6.3 11.6v2.6M9.7 11.6v2.6M1.8 6.3h2.6M1.8 9.7h2.6M11.6 6.3h2.6M11.6 9.7h2.6' }),
          ]);
        },
        /** 循环箭头（刷新页面）。 */
        refresh() {
          return svg({ ...STROKE }, [
            h('path', { key: 'arc', d: 'M13.3 8.2A5.3 5.3 0 1 1 11.4 4.2' }),
            h('path', { key: 'tip', d: 'M11.7 1.5l-.3 2.9 2.9.3' }),
          ]);
        },
        terminal() {
          return svg({ ...STROKE }, [
            h('rect', { key: 'r', x: 2, y: 3, width: 12, height: 10, rx: 2 }),
            h('path', { key: 'a', d: 'M4.8 6.4l2.1 1.7-2.1 1.7' }),
            h('path', { key: 'b', d: 'M8.6 10.2h2.7' }),
          ]);
        },
        workflow() {
          return svg({ ...STROKE }, [
            h('circle', { key: 'a', cx: 4, cy: 4, r: 2.1 }),
            h('circle', { key: 'b', cx: 4, cy: 12, r: 2.1 }),
            h('circle', { key: 'c', cx: 12, cy: 8, r: 2.1 }),
            h('path', { key: 'd', d: 'M5.8 5l4.4 2.2M5.8 11l4.4-2.2' }),
          ]);
        },
        chevronRight() {
          return svg({ ...STROKE }, [h('path', { key: 'p', d: 'M6 3.8L10.2 8 6 12.2' })]);
        },
        chevronLeft() {
          return svg({ ...STROKE }, [h('path', { key: 'p', d: 'M10 3.8L5.8 8 10 12.2' })]);
        },
        chevronDown() {
          return svg({ ...STROKE }, [h('path', { key: 'p', d: 'M3.8 6L8 10.2 12.2 6' })]);
        },
        stop() {
          return svg({ width: 12, height: 12 }, [h('rect', { key: 'r', x: 3, y: 3, width: 10, height: 10, rx: 2.5, fill: 'currentColor' })]);
        },
        dots() {
          return svg({ width: 12, height: 12, fill: 'currentColor' }, [4, 8, 12].map((cx) => h('circle', { key: cx, cx, cy: 8, r: 1.4 })));
        },
      };

      function todoGlyph(status) {
        if (status === 'completed') {
          return svg({}, [
            h('circle', { key: 'c', cx: 8, cy: 8, r: 6.6, fill: 'currentColor' }),
            h('path', {
              key: 'p',
              d: 'M4.9 8.2l2 2 3.2-3.4',
              fill: 'none',
              stroke: 'var(--dsw-alias-label-on-accent,#fff)',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ]);
        }
        // 进行中：宿主同款的旋转弧线（业务蓝），比原来的实心三角柔和；
        // prefers-reduced-motion 下退化为静态圆弧（见 .dsc-todo-spin 规则）。
        if (status === 'in_progress') {
          return svg({ className: 'dsc-todo-spin' }, [
            h('circle', { key: 'track', cx: 8, cy: 8, r: 5.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 2 }),
            h('path', {
              key: 'arc',
              d: 'M8 2.6a5.4 5.4 0 0 1 5.4 5.4',
              fill: 'none',
              stroke: 'var(--dsw-alias-state-business-primary)',
              strokeWidth: 2,
              strokeLinecap: 'round',
            }),
          ]);
        }
        return svg({}, [h('circle', { key: 'c', cx: 8, cy: 8, r: 4.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 })]);
      }

      function statusGlyph(status) {
        const className = status === 'completed' ? 'dsc-glyph dsc-glyph--success' : status === 'in_progress' ? 'dsc-glyph dsc-glyph--strong dsc-glyph--spin' : 'dsc-glyph';
        return h('span', { className }, todoGlyph(status));
      }

      // 九色板沿用 ZCode 的子智能体头像配色；按名字散列取色，同名恒同色。
      const FACE_COLORS = ['#54B9A6', '#F19D38', '#6464EF', '#885CF5', '#3C82F6', '#ED712E', '#EB4699', '#5BC67A', '#EA4045'];

      function nameHash(name) {
        let hash = 0;
        for (const char of String(name ?? '')) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
        return hash;
      }

      /**
       * 头像取色键：必须用每个子智能体**独有**的键（子会话 id），不能用目录里的通用
       * label——DSH 给每个子代理的 label 都是同一个通用名，用它散列会让所有头像挤进
       * 同一种颜色。缺失 id 时退回标题，再退回显示名。
       */
      function agentColorKey(agent) {
        return (agent && (agent.id || agent.title || agent.label)) || '';
      }

      /**
       * 子智能体头像：圆角方块加两只眼，状态决定表情与徽标。
       * `state`: running（竖长眼、眨眼）| done（对勾徽标）| ended（方块徽标）| idle（三点）。
       * `mono` 画中性灰的「集合」图标。
       */
      function Face({ name, state = 'idle', size = 16, mono }) {
        const hash = nameHash(name);
        const dots = mono || state === 'idle';
        const body = mono ? 'var(--dsw-alias-label-tertiary)' : FACE_COLORS[hash % FACE_COLORS.length];
        const ink = mono ? 'var(--dsw-specific-menu)' : 'var(--dsc-face-eye)';
        const eyes = dots
          ? [5, 10, 15].map((cx) => h('circle', { key: cx, cx, cy: 10, r: 1.6 }))
          : [7, 13].map((x) => h('rect', { key: x, x, y: 6, width: 4, height: 6, rx: 2 }));
        return svg(
          {
            viewBox: '0 0 20 20',
            className: 'dsc-face',
            'data-state': dots ? 'idle' : state,
            width: size,
            height: size,
            style: { color: body },
          },
          [
            h('rect', {
              key: 'body',
              fill: mono ? body : FACE_COLORS[hash % FACE_COLORS.length],
              x: 0,
              y: 0,
              width: 20,
              height: 20,
              rx: 7,
              stroke: 'var(--dsc-face-ring)',
              strokeWidth: 2,
              paintOrder: 'stroke fill',
            }),
            // 眨眼动画挂在眼睛组上；按名字错开相位，几枚头像不会同时眨。
            h('g', { key: 'eyes', className: 'dsc-face-eyes', fill: ink, style: dots ? undefined : { animationDelay: ((hash % 34) / -10).toFixed(1) + 's' } }, eyes),
            state === 'done' || state === 'ended'
              ? h('g', { key: 'badge', fill: 'none' }, [
                  // 徽标整体画在 viewBox 之内（圆心 5,15 半径 5）——overflow:visible 的脸
                  // 曾经把徽标圆戳出方形 2.5 单位，在胶囊头像堆里压到左缘圆角上（穿模）。
                  h('circle', { key: 'halo', cx: 5, cy: 15, r: 5, fill: 'var(--dsc-face-ring)' }),
                  h('circle', {
                    key: 'disc',
                    cx: 5,
                    cy: 15,
                    r: 5,
                    fill: state === 'done' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)',
                    stroke: 'var(--dsc-face-ring)',
                    strokeWidth: 1.5,
                  }),
                  state === 'done'
                    ? h('path', {
                        key: 'check',
                        d: 'M2.6 15.2l1.5 1.5 3-3.1',
                        stroke: 'var(--dsw-alias-label-on-accent,#fff)',
                        strokeWidth: 1.5,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                      })
                    : h('rect', { key: 'square', x: 3.2, y: 13.2, width: 3.6, height: 3.6, rx: 0.6, fill: 'var(--dsw-specific-menu)' }),
                ])
              : null,
          ],
        );
      }

      function AvatarStack({ agents, overflow }) {
        return h(
          'span',
          { className: 'dsc-capsule-icon dsc-stack', 'aria-hidden': true },
          agents.map((agent, index) =>
            h('span', { key: agent.id, className: 'dsc-stack-slot', style: { zIndex: index + 1 } }, h(Face, { name: agentColorKey(agent), state: agent.state, size: 16 })),
          ),
          overflow > 0 ? h('span', { key: 'more', className: 'dsc-more' }, ICON.dots()) : null,
        );
      }

      // ------------------------------------------------------------------
      // 浮层与胶囊
      // ------------------------------------------------------------------

      /**
       * 浮层：portal 到 body。优先 CSS 锚点定位（面板经共享的 --dsc-anchor 变量锚在
       * 触发胶囊上方居中，样式见 .dsc-popover 规则），开面板后实测校验，没对准或内核
       * 不支持时切 JS 定位兜底。外点或 Escape 关闭；Escape 在这里被吃掉，不会成为
       * 「Esc Esc 停止」序列的第一击。
       */
      function Popover({ open, anchorRef, onClose, anchorName, label, wide, children }) {
        const panelRef = useRef(null);
        // 开面板后实测一次：面板中心没对准胶囊中心（>8px，比如页面残留旧样式表、引擎
        // 对 anchor() 的实现有差异）就整体切到 JS 定位，宁可多一层兜底也不歪着显示。
        const [forceJs, setForceJs] = useState(false);
        const fallback = fallbackAnchoredPosition({ open, anchorRef, panelRef, enabled: !CSS_ANCHOR || forceJs });
        const clampShift = usePopoverClamp({ open, anchorRef, panelRef, enabled: CSS_ANCHOR && !forceJs });
        useLayoutEffect(() => {
          if (!open || !CSS_ANCHOR) return undefined;
          const anchor = anchorRef.current?.getBoundingClientRect();
          const panel = panelRef.current;
          if (!anchor || !panel) return undefined;
          const panelRect = panel.getBoundingClientRect();
          const panelCenter = panelRect.left + panelRect.width / 2;
          const anchorCenter = anchor.left + anchor.width / 2;
          if (Math.abs(panelCenter - anchorCenter) > 8) setForceJs(true);
          return undefined;
        }, [open, anchorRef]);
        useEffect(() => {
          if (!open) setForceJs(false);
        }, [open]);
        useEffect(() => {
          if (!open) return undefined;
          const onKey = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
          };
          const onPointer = (event) => {
            if (event.target instanceof Node && !anchorRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) onClose();
          };
          document.addEventListener('keydown', onKey);
          document.addEventListener('pointerdown', onPointer, true);
          return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointer, true);
          };
        }, [open, onClose, anchorRef]);
        if (!open) return null;
        let style;
        if (CSS_ANCHOR && !forceJs) {
          style = { '--dsc-anchor': anchorName, translate: clampShift ? 'calc(-50% + ' + clampShift + 'px) 0' : undefined };
        } else {
          style = { ...(fallback || { visibility: 'hidden', left: 0, top: 0 }), translate: 'none' };
        }
        return ReactDOM.createPortal(
          h('div', { ref: panelRef, className: cls('dsc-popover', wide && 'dsc-popover--wide'), role: 'dialog', 'aria-label': label, 'data-window-drag-exclude': '', style }, children),
          document.body,
        );
      }

      function Capsule({ anchorRef, open, onToggle, label, title, icon, text, count, anchorName }) {
        return h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: 'dsc-capsule',
            'aria-expanded': open,
            'aria-haspopup': 'dialog',
            'aria-label': label,
            title,
            onClick: onToggle,
            style: { '--dsc-anchor': anchorName },
          },
          h('span', { key: 'icon', className: 'dsc-capsule-icon' }, icon),
          h('span', { key: 'label', className: 'dsc-capsule-label' }, text),
          count !== undefined && count !== null ? h('span', { key: 'count', className: 'dsc-capsule-count' }, count) : null,
        );
      }

      // ------------------------------------------------------------------
      // 待办胶囊
      // ------------------------------------------------------------------

      function TodoList({ todos, t }) {
        const listRef = useRef(null);
        // 打开时把「进行中」那一项滚到浮层中部。
        useLayoutEffect(() => {
          const list = listRef.current;
          const panel = list?.closest('.dsc-popover');
          const current = list?.querySelector('[data-status="in_progress"]');
          if (!panel || !current) return;
          const offset = current.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
          panel.scrollTop = Math.max(0, offset - panel.clientHeight / 2 + current.clientHeight / 2);
        }, []);
        return h(
          'ul',
          { ref: listRef, className: 'dsc-list', role: 'list' },
          todos.length === 0
            ? h('li', { key: 'empty', className: 'dsc-empty' }, t('todo.empty'))
            : todos.map((item, index) =>
            h(
              'li',
              { key: index + ':' + item.content, className: 'dsc-item dsc-todo-item', 'data-status': item.status },
              statusGlyph(item.status),
              h('span', { className: 'dsc-todo-text', title: item.content }, item.content),
            ),
          ),
        );
      }

      function TodoCapsule({ todos, open, onToggle, onClose, t }) {
        const anchorRef = useRef(null);
        const summary = useMemo(() => todoSummary(todos), [todos]);
        const label = t('todo.' + summary.status);
        const counter = summary.completed + '/' + summary.total;
        return h(
          'div',
          { className: 'dsc-capsule-wrap' },
          h(Capsule, {
            anchorRef,
            open,
            onToggle,
            label: t('todo.title') + '：' + label + ' ' + counter,
            title: t('todo.title'),
            icon: summary.status === 'completed' ? ICON.done({ style: { color: 'var(--dsw-alias-state-success-primary)' } }) : ICON.checks(),
            text: label,
            count: counter,
            anchorName: '--dsc-anchor-todo',
          }),
          h(Popover, { open, anchorRef, onClose, label: t('todo.title'), anchorName: '--dsc-anchor-todo' }, h(TodoList, { todos, t })),
        );
      }

      // ------------------------------------------------------------------
      // 智能体胶囊：行、目录、工作流
      // ------------------------------------------------------------------

      function modeLabel(agent, t) {
        if (agent.external) return t('mode.external');
        if (agent.mode === 'one-shot') return t('mode.one-shot');
        if (agent.mode === 'continuable') return t('mode.continuable');
        return t('mode.unknown');
      }

      function stateLabel(agent, t) {
        if (agent.running) return t('agent.running');
        if (agent.state === 'done') return t('agent.done');
        if (agent.state === 'ended') return t('agent.ended');
        return t('agent.idle');
      }

      /**
       * 停止按钮。子智能体一击即停（与 ZCode 一致）；后台任务两击确认
       * （误停会丢掉整段输出，与 DSH 自带任务列表的保护一致）。
       */
      function StopButton({ armed, busy, label, confirmLabel, onStop }) {
        return h(
          'button',
          { type: 'button', className: 'dsc-stop', 'data-armed': armed ? '' : undefined, disabled: busy, 'aria-busy': busy, 'aria-label': label, title: armed ? confirmLabel : label, onClick: onStop },
          h('span', null, ICON.stop()),
          busy ? '…' : armed ? confirmLabel : label,
        );
      }

      /**
       * 调用一次停止并汇报结果；失败时短暂提示。
       * 请求成功后按钮保持「停止中」：目标确实停下（`settled`）时复位，最多等 `STOP_WAIT_MS`。
       */
      function useStopAction(stop, failedFlag, settled) {
        const [busy, setBusy] = useState(false);
        const [failed, setFailed] = failedFlag;
        const inFlight = useRef(false);
        const timer = useRef(undefined);
        useEffect(() => {
          if (settled) setBusy(false);
          return undefined;
        }, [settled]);
        useEffect(
          () => () => {
            clearTimeout(timer.current);
          },
          [],
        );
        const run = async (...args) => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          setFailed(false);
          let ok = false;
          try {
            ok = Boolean(await stop(...args));
          } catch (error) {
            ok = false;
          }
          inFlight.current = false;
          if (ok) {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setBusy(false), STOP_WAIT_MS);
            return;
          }
          setBusy(false);
          setFailed(true);
        };
        return [busy, failed, run];
      }

      function AgentRow({ agent, now, onOpen, onStop, t }) {
        const failedFlag = useTransientFlag(FEEDBACK_MS);
        const [stopping, failed, runStop] = useStopAction(
          async (id) => {
            const result = await onStop(id);
            return Boolean(result && result.ok !== false);
          },
          failedFlag,
          !agent.running,
        );
        const canStop = agent.running && !agent.external && typeof onStop === 'function';
        const canOpen = !agent.external && typeof onOpen === 'function';
        const elapsed = elapsedOf(agent.timing, agent.running, now);
        const detail = agent.title && agent.title !== agent.label ? agent.title : undefined;
        const sub = [detail, modeLabel(agent, t), stateLabel(agent, t), elapsed === undefined ? null : formatDuration(elapsed, t)].filter(Boolean).join(' · ');
        return h(
          'li',
          { className: cls('dsc-item', canOpen && 'dsc-item--clickable'), 'data-state': agent.state },
          canOpen ? h('button', { key: 'hit', type: 'button', className: 'dsc-item-hit', 'aria-label': t('agent.open') + '：' + agent.label, onClick: () => onOpen(agent) }) : null,
          h('span', { key: 'face', className: 'dsc-glyph' }, h(Face, { name: agentColorKey(agent), state: agent.state, size: 16 })),
            h(
              'span',
              { key: 'main', className: 'dsc-main' },
              h('span', { className: 'dsc-title', title: agent.label }, agent.label),
              h('span', { className: cls('dsc-sub', failed && 'dsc-sub--error'), title: sub }, failed ? t('agent.stopFailed') : sub),
            ),
          canStop ? h(StopButton, { key: 'stop', armed: false, busy: stopping, label: t('agent.stop'), confirmLabel: t('agent.stop'), onStop: () => runStop(agent.id) }) : null,
        );
      }

      function JobRow({ job, sessionId, service, now, t }) {
        const armedFlag = useTransientFlag(FEEDBACK_MS);
        const failedFlag = useTransientFlag(FEEDBACK_MS);
        const [armed, setArmed] = armedFlag;
        const live = isLiveJob(job);
        const [stopping, failed, runStop] = useStopAction(
          async () => {
            const result = await service.kill(sessionId, String(job.id));
            return typeof result === 'object' && result !== null ? result.ok !== false : Boolean(result);
          },
          failedFlag,
          !live,
        );
        const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt;
        const sub = [job.kind, job.progress ?? job.detail, formatDuration(elapsed, t)].filter(Boolean).join(' · ');
        const canKill = job.status === 'running' && typeof service.kill === 'function';
        const handleStop = () => {
          if (stopping) return;
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          runStop();
        };
        return h(
          'li',
          { className: 'dsc-item', 'data-state': job.status },
          h('span', { key: 'icon', className: 'dsc-glyph' }, ICON.terminal()),
          h(
            'span',
            { key: 'main', className: 'dsc-main' },
            h('span', { className: 'dsc-title', title: job.label }, job.label),
            h('span', { className: cls('dsc-sub', failed && 'dsc-sub--error'), title: sub }, failed ? t('job.stopFailed') : sub),
          ),
          canKill ? h(StopButton, { key: 'stop', armed, busy: stopping, label: t('job.stop'), confirmLabel: t('job.confirmStop'), onStop: handleStop }) : null,
        );
      }

      // ------------------------------------------------------------------
      // 模型选择座位：替换 composer 自带的「选择模型」条目。
      // 数据与动作复用宿主 modelDirectories 服务（与 /model 弹窗共享同一份
      // 会话目录状态），UI 按 ZCode 双栏风格：左 provider 列、右模型列
      // （视觉徽标 + 搜索），底部推理等级分档。选中即调 directory.select。
      // ------------------------------------------------------------------

      const EMPTY_DIRECTORY = { current: null, groups: [], failures: [], status: 'idle', pending: null, error: null };

      /** 目录的 provider 排序：账号最前、官方次之，其余保持目录顺序（与宿主一致）。 */
      function orderProviders(groups) {
        const rank = (id) => (id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2);
        return groups.slice().sort((left, right) => rank(left.id) - rank(right.id));
      }

      /** 徽标文案：宿主 resolveText 优先，退回原文 / zh / en。 */
      function badgeText(resolveText, text) {
        if (typeof resolveText === 'function') {
          try {
            const out = resolveText(text);
            if (typeof out === 'string' && out !== '') return out;
          } catch (error) {
            /* fall through */
          }
        }
        if (typeof text === 'string') return text;
        if (text && typeof text === 'object') return text.zh ?? text.en ?? Object.values(text)[0] ?? '';
        return '';
      }

      function ModelSeat({ locked, available, seatFailed, directory, load, select, resolveText, t, renderSlot }) {
        // 目录解析失败时显式抛错 → 条目弃用 → 内置选择器接管（渲染 null 会把座位顶没）。
        if (seatFailed) throw new Error('model directory unavailable - yielding seat to the built-in picker');
        const state = useSyncExternalStore(
          directory ? (listener) => directory.subscribe(listener) : () => () => {},
          directory ? () => directory.getSnapshot() : () => EMPTY_DIRECTORY,
        );
        const [open, setOpen] = useState(false);
        const [providerId, setProviderId] = useState(null);
        const [query, setQuery] = useState('');
        const [errorText, setErrorText] = useState(null);
        const anchorRef = useRef(null);
        const errorTimer = useRef(null);
        useEffect(() => () => clearTimeout(errorTimer.current), []);
        const showError = (text) => {
          setErrorText(text);
          clearTimeout(errorTimer.current);
          errorTimer.current = setTimeout(() => setErrorText(null), FEEDBACK_MS);
        };
        const close = () => {
          setOpen(false);
          setQuery('');
        };

        const current = state.current;
        let currentModel;
        for (const group of state.groups) {
          const hit = current !== null ? group.models.find((model) => group.id === current.provider && model.id === current.model) : undefined;
          if (hit !== undefined) {
            currentModel = hit;
            break;
          }
        }
        const reasoning = currentModel ? currentModel.reasoning : undefined;
        const effectiveEffort = (current && current.reasoningEffort) || reasoning?.defaultEffort;
        const effortName = reasoning === undefined
          ? state.retainedEffort
          : effectiveEffort === undefined
            ? t('model.providerDefault')
            : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
        const ordered = orderProviders(state.groups);
        const activeId = providerId ?? (current ? current.provider : null) ?? (ordered[0] ? ordered[0].id : null);
        const activeGroup = ordered.find((group) => group.id === activeId) ?? ordered[0] ?? null;
        const needle = query.trim().toLowerCase();
        const visibleModels = activeGroup
          ? activeGroup.models.filter((model) => needle === '' || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle))
          : [];
        const busy = state.pending !== null;
        const waiting = current === null && state.status === 'loading';
        const modelLabel = waiting ? t('model.loading') : currentModel ? currentModel.name : t('model.triggerEmpty');
        const triggerLabel = effortName ? modelLabel + ' · ' + effortName : modelLabel;
        const aria = effortName ? t('model.ariaEffort', { model: modelLabel, effort: effortName }) : t('model.aria', { model: modelLabel });
        const effortPills = reasoning === undefined ? [] : [
          ...(reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: t('model.providerDefault') }] : []),
          ...reasoning.efforts.map((level) => ({ key: level.id, effort: level.id, label: level.name })),
        ];

        if (!available || !directory) return null;

        const providerName = (group) => (group.id === 'deepseek-account' ? t('model.accountProvider') : group.name);
        const renderName = (group, model, placement, selected) =>
          renderSlot(
            'conversation.input.model.label',
            { provider: { id: group.id, name: providerName(group) }, model, placement, selected },
            {
              fallback: model.badge === undefined
                ? h('span', { className: 'dsc-mrow-name', title: model.name }, model.name)
                : h(
                    'span',
                    { className: 'dsc-mrow-name', title: model.name },
                    placement === 'trigger' ? h('span', { className: 'dsc-badge', 'data-tone': model.badge.tone }, badgeText(resolveText, model.badge.text)) : null,
                    h('span', null, model.name),
                    placement === 'trigger' ? null : h('span', { className: 'dsc-badge', 'data-tone': model.badge.tone }, badgeText(resolveText, model.badge.text)),
                  ),
            },
          );

        const submit = (selection) => {
          void Promise.resolve(select(selection)).then((result) => {
            if (result && result.ok === false) {
              const code = result.error ? result.error.code : '';
              const message = result.error ? code + ': ' + result.error.message : 'unknown';
              showError(code === 'session/writer-held' ? t('model.sessionInUse') : t('model.error', { message }));
            } else if (result && result.ok) {
              close();
            }
          });
        };
        const chooseModel = (group, model) => {
          if (current && current.provider === group.id && current.model === model.id) {
            close();
            return;
          }
          submit({ provider: group.id, model: model.id });
        };
        const chooseEffort = (effort) => {
          if (!current) return;
          if (effectiveEffort === effort) {
            close();
            return;
          }
          submit({ provider: current.provider, model: current.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) });
        };
        const retry = () => {
          if (load) load();
        };

        return h(
          'div',
          { className: 'dsc-modelseat' },
          h(
            'button',
            {
              ref: anchorRef,
              type: 'button',
              className: 'dsc-capsule',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': aria,
              'aria-busy': busy,
              title: triggerLabel,
              disabled: locked,
              onClick: () => {
                if (open) close();
                else {
                  setOpen(true);
                  retry();
                }
              },
              style: { '--dsc-anchor': '--dsc-anchor-model' },
            },
            h('span', { key: 'icon', className: 'dsc-capsule-icon' }, ICON.chip()),
            h('span', { key: 'label', className: 'dsc-capsule-label dsc-mrow-name' },
              currentModel && current ? renderName(activeGroup && activeGroup.id === current.provider ? activeGroup : { id: current.provider, name: current.provider, models: [] }, currentModel, 'trigger', true) : modelLabel),
            effortName ? h('span', { key: 'effort', className: 'dsc-modelseat-effort' }, effortName) : null,
            busy
              ? h('span', { key: 'busy', className: 'dsc-glyph dsc-glyph--spin dsc-capsule-icon' }, todoGlyph('in_progress'))
              : h('span', { key: 'chevron', className: 'dsc-capsule-icon' }, ICON.chevronDown()),
          ),
          h(
            Popover,
            { open, anchorRef, onClose: close, label: aria, anchorName: '--dsc-anchor-model', wide: true },
            h(
              'div',
              { className: 'dsc-modelpop' },
              h(
                'div',
                { className: 'dsc-modelpop-side', role: 'listbox', 'aria-label': t('model.effort') },
                ordered.map((group) =>
                  h(
                    'button',
                    {
                      key: group.id,
                      type: 'button',
                      className: 'dsc-mrow',
                      role: 'option',
                      'aria-checked': activeGroup ? group.id === activeGroup.id : false,
                      disabled: busy,
                      onClick: () => setProviderId(group.id),
                      title: providerName(group),
                    },
                    h('span', { className: 'dsc-mrow-copy' }, h('span', { className: 'dsc-mrow-name' }, providerName(group))),
                    h('span', { className: 'dsc-mrow-count' }, t('model.count', { count: group.models.length })),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dsc-modelpop-main' },
                totalModels > 6
                  ? h('input', {
                      className: 'dsc-modelpop-search',
                      type: 'search',
                      placeholder: t('model.searchPlaceholder'),
                      'aria-label': t('model.searchPlaceholder'),
                      value: query,
                      disabled: busy,
                      onChange: (event) => setQuery(event.target.value),
                    })
                  : null,
                state.status === 'loading' ? h('div', { className: 'dsc-modelpop-note' }, t('model.listLoading')) : null,
                state.error !== null
                  ? h('div', { className: 'dsc-modelpop-error' },
                      h('span', null, t('model.error', { message: state.error })),
                      h('button', { type: 'button', className: 'dsc-effort-pill', onClick: retry }, t('model.retry')))
                  : null,
                state.failures.map((failure) =>
                  h('div', { className: 'dsc-modelpop-note', key: failure.id },
                    (failure.id === 'deepseek-account' ? t('model.accountProvider') : failure.name) + ' · ' + failure.message),
                ),
                activeGroup === null || (state.status === 'ready' && totalModels === 0)
                  ? h('div', { className: 'dsc-modelpop-note' }, t('model.empty'))
                  : visibleModels.length === 0 && needle !== ''
                    ? h('div', { className: 'dsc-modelpop-note' }, t('model.searchEmpty'))
                    : visibleModels.map((model) => {
                        const selected = current !== null && activeGroup.id === current.provider && model.id === current.model;
                        const pendingRow = state.pending !== null && state.pending.provider === activeGroup.id && state.pending.model === model.id;
                        return h(
                          'button',
                          {
                            key: model.id,
                            type: 'button',
                            className: 'dsc-mrow',
                            role: 'menuitemradio',
                            'aria-checked': selected,
                            disabled: busy,
                            title: model.name,
                            onClick: () => chooseModel(activeGroup, model),
                          },
                          h('span', { className: 'dsc-mrow-copy' }, renderName(activeGroup, model, 'option', selected)),
                          h('span', { className: 'dsc-mrow-check' },
                            pendingRow
                              ? h('span', { className: 'dsc-glyph dsc-glyph--spin' }, todoGlyph('in_progress'))
                              : selected
                                ? ICON.done()
                                : null),
                        );
                      }),
              ),
              reasoning === undefined && currentModel ? null : effortPills.length > 0
                ? h(
                    'div',
                    { className: 'dsc-modelpop-foot' },
                    h('span', { className: 'dsc-modelpop-footlabel' }, t('model.effort')),
                    h(
                      'div',
                      { className: 'dsc-effort', role: 'radiogroup', 'aria-label': t('model.effort') },
                      effortPills.map((pill) =>
                        h('button', {
                          key: pill.key,
                          type: 'button',
                          className: 'dsc-effort-pill',
                          role: 'radio',
                          'aria-checked': effectiveEffort === pill.effort,
                          disabled: busy || !current,
                          onClick: () => chooseEffort(pill.effort),
                        }, pill.label),
                      ),
                    ),
                  )
                : null,
              typeof renderSlot === 'function'
                ? renderSlot('conversation.input.model.options', {
                    locked: locked || busy,
                    dismiss: close,
                    reportFailure: showError,
                  })
                : null,
              errorText ? h('div', { className: 'dsc-modelpop-error', role: 'alert' }, errorText) : null,
            ),
          ),
        );
      }

      // ------------------------------------------------------------------
      // 回合触发标记：keyed 接管 conversation.chat.node 的 turn-trigger。
      // 团队/子代理事件（收到任务消息、子智能体已完成/停止…）原本只有一枚
      // 通用图标；这里按 senderSessionId 画上发送者的头像脸（九色板取色，
      // 结算事件按 stopReason 定脸），名字取会话标题，可展开看原始消息。
      // ------------------------------------------------------------------

      /** 触发消息的呈现规则：事件种类 → 文案键 + 头像状态 + 发送者会话 id。 */
      function triggerDetails(node) {
        const source = node && typeof node.source === 'object' && node.source !== null ? node.source : {};
        const kind = typeof source.kind === 'string' ? source.kind : '';
        switch (kind) {
          case 'agent-message':
            return { key: 'trigger.agent', face: 'running', senderId: source.senderSessionId };
          case 'team-message':
            return { key: 'trigger.team', face: 'running', senderId: source.senderId };
          case 'subagent-settled': {
            const reason = typeof source.stopReason === 'string' ? source.stopReason : '';
            const map = {
              completed: 'trigger.subagent.completed',
              aborted: 'trigger.subagent.aborted',
              error: 'trigger.subagent.error',
              'max-tokens': 'trigger.subagent.maxTokens',
              refusal: 'trigger.subagent.refusal',
            };
            return {
              key: map[reason] ?? 'trigger.subagent',
              face: reason === 'completed' ? 'done' : 'ended',
              senderId: source.senderSessionId,
            };
          }
          case 'retry':
            return { key: 'trigger.continue' };
          case 'goal':
            return { key: 'trigger.goal' };
          case 'schedule':
            return { key: 'trigger.schedule' };
          case 'tool-jobs':
            return { key: 'trigger.job' };
          case 'cordis-host-runner':
            return { key: 'trigger.plugin' };
          case 'webhook':
            return { key: source.provider === 'github' ? 'trigger.github' : 'trigger.webhook' };
          default:
            return { key: 'trigger.request' };
        }
      }

      function TriggerNode({ node, t, useSessions }) {
        const [open, setOpen] = useState(false);
        const details = triggerDetails(node);
        const showFace = details.senderId !== undefined && details.senderId !== null;
        let senderName = null;
        if (showFace && typeof useSessions === 'function') {
          const sender = useSessions((state) => (state.byId ? state.byId[details.senderId] : undefined));
          senderName = sender && typeof sender.title === 'string' && sender.title !== '' ? sender.title : String(details.senderId);
        }
        let timeText = '';
        try {
          const date = new Date(node.time);
          if (!Number.isNaN(date.getTime())) timeText = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (error) {
          timeText = '';
        }
        const body = Array.isArray(node?.content)
          ? node.content.map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : null)).filter(Boolean).join('\n')
          : '';
        return h(
          'div',
          { className: 'dsc-trigger' },
          showFace ? h('span', { className: 'dsc-trigger-face' }, h(Face, { name: senderName ?? details.senderId, state: details.face ?? 'idle', size: 14 })) : null,
          h(
            'button',
            { type: 'button', className: 'dsc-trigger-head', 'aria-expanded': open, onClick: () => setOpen((current) => !current) },
            h('span', { className: 'dsc-trigger-title' }, t(details.key)),
            senderName !== null ? h('span', { className: 'dsc-trigger-sender' }, senderName) : null,
            timeText !== '' ? h('time', { className: 'dsc-trigger-time' }, timeText) : null,
            h('span', { className: 'dsc-trigger-chevron', 'data-open': open ? '' : undefined }, ICON.chevronDown()),
          ),
          open && body !== '' ? h('pre', { className: 'dsc-trigger-body' }, body) : null,
        );
      }

      /** 「某目录 · N ›」入口行。 */
      function DirectoryRow({ icon, label, count, onOpen, kind }) {
        return h(
          'button',
          { type: 'button', className: 'dsc-item dsc-item--clickable', 'data-dsc-directory': kind, onClick: onOpen },
          h('span', { className: 'dsc-glyph' }, icon),
          h('span', { className: 'dsc-main' }, h('span', { className: 'dsc-title' }, label)),
          h('span', { className: 'dsc-count' }, count),
          h('span', { className: 'dsc-trailing' }, ICON.chevronRight()),
        );
      }

      /** 目录树的一行：可展开的子目录带 chevron；点击正文用「直接父会话 + 子会话」地址打开它。 */
      function TreeRow({ row, onBranch, onOpen, t }) {
        const { agent, parentId, level, expandable, open, loading } = row;
        const canOpen = !agent.external && typeof onOpen === 'function';
        const sub = [modeLabel(agent, t), agent.external ? null : stateLabel(agent, t), loading ? t('directory.loading') : null].filter(Boolean).join(' · ');
        return h(
          'li',
          { className: cls('dsc-item', canOpen && 'dsc-item--clickable'), 'data-state': agent.state, style: { paddingLeft: 8 + level * 14 } },
          canOpen ? h('button', { key: 'hit', type: 'button', className: 'dsc-item-hit', 'aria-label': t('agent.open') + '：' + agent.label, onClick: () => onOpen(agent, parentId) }) : null,
          expandable
            ? h('button', { key: 'chevron', type: 'button', className: 'dsc-chevron', 'aria-expanded': open, 'aria-label': agent.label + ' · ' + t('directory.subagent'), onClick: () => onBranch(agent.id) }, ICON.chevronRight())
            : h('span', { key: 'space', className: 'dsc-chevron-space' }),
          h('span', { key: 'face', className: 'dsc-glyph' }, h(Face, { name: agentColorKey(agent), state: agent.state, size: 16 })),
          h(
            'span',
            { key: 'main', className: 'dsc-main' },
            h('span', { className: 'dsc-title', title: agent.label }, agent.label),
            sub ? h('span', { className: 'dsc-sub', title: sub }, sub) : null,
          ),
        );
      }

      function SubagentDirectory({ sessionId, projections, summaries, statuses, expanded, onBranch, onOpen, onRefresh, t }) {
        const direct = projections?.[sessionId]?.values?.subagentCatalog;
        const loaded = Array.isArray(direct);
        useEffect(() => {
          if (!loaded && typeof onRefresh === 'function') onRefresh(sessionId);
        }, [loaded, sessionId, onRefresh]);
        const rows = useMemo(() => {
          const out = [];
          const seen = new Set([sessionId]);
          const walk = (parentId, level) => {
            const catalog = projections?.[parentId]?.values?.subagentCatalog;
            if (!Array.isArray(catalog)) return;
            for (const entry of catalog) {
              if (!entry || typeof entry.id !== 'string' || seen.has(entry.id)) continue;
              seen.add(entry.id);
              const agent = classifyChild(entry, summaries, statuses);
              const nested = projections?.[agent.id]?.values?.subagentCatalog;
              const knownLeaf = agent.external || (Array.isArray(nested) && nested.length === 0);
              const isOpen = !knownLeaf && expanded.has(agent.id);
              out.push({ agent, parentId, level, expandable: !knownLeaf, open: isOpen, loading: isOpen && !Array.isArray(nested) });
              if (isOpen) walk(agent.id, level + 1);
            }
          };
          walk(sessionId, 0);
          return out;
        }, [projections, summaries, statuses, sessionId, expanded]);
        return h(
          'div',
          { key: 'subagents' },
          h(
            'div',
            { className: 'dsc-head' },
            h('button', { type: 'button', className: 'dsc-back', 'aria-label': t('directory.back'), onClick: () => onBranch(null) }, ICON.chevronLeft()),
            h('span', { className: 'dsc-title' }, t('directory.subagent')),
            loaded ? h('span', { key: 'count', className: 'dsc-count', style: { marginLeft: 'auto' } }, direct.length) : null,
          ),
          !loaded
            ? h('div', { className: 'dsc-empty' }, t('directory.loading'))
            : rows.length === 0
              ? h('div', { className: 'dsc-empty', style: { paddingLeft: 32, textAlign: 'left' } }, t('directory.empty'))
              : h('ul', { className: 'dsc-list' }, rows.map((row) => h(TreeRow, { key: row.agent.id, row, onBranch, onOpen, t }))),
        );
      }

      const WORKFLOW_DOT = { running: 'ongoing', completed: 'done', cancelled: 'idle', failed: 'error', interrupted: 'idle' };

      function WorkflowDirectory({ runs, onBack, t }) {
        return h(
          'div',
          { key: 'workflows' },
          h(
            'div',
            { className: 'dsc-head' },
            h('button', { type: 'button', className: 'dsc-back', 'aria-label': t('directory.back'), onClick: onBack }, ICON.chevronLeft()),
            h('span', { className: 'dsc-title' }, t('directory.workflow')),
            h('span', { className: 'dsc-count', style: { marginLeft: 'auto' } }, runs.length),
          ),
          h(
            'ul',
            { className: 'dsc-list' },
            runs.map((run, index) => {
              const members = Array.isArray(run.phases) ? run.phases.flatMap((phase) => (Array.isArray(phase?.members) ? phase.members : EMPTY)) : EMPTY;
              const settled = members.filter((member) => member?.status !== 'running').length;
              const status = WORKFLOW_DOT[run.status] ? run.status : 'running';
              return h(
                'li',
                { key: index + ':' + (run.name ?? ''), className: 'dsc-item', 'data-state': status },
                h('span', { className: 'dsc-glyph' }, h('span', { className: 'dsc-lamp dsc-lamp--' + WORKFLOW_DOT[status], 'aria-hidden': true })),
                h(
                  'span',
                  { className: 'dsc-main' },
                  h('span', { className: 'dsc-title', title: run.name }, run.name || t('directory.workflow')),
                  h('span', { className: 'dsc-sub' }, [t('workflow.' + status), members.length ? t('workflow.members', { settled, total: members.length }) : null].filter(Boolean).join(' · ')),
                ),
              );
            }),
          ),
        );
      }

      function ActivityCapsule({ sessionId, children, liveJobs, settledJobs, workflowRuns, projections, summaries, statuses, jobs, open, onToggle, onClose, actions, t }) {
        const anchorRef = useRef(null);
        const [view, setView] = useState('root');
        const [expanded, setExpanded] = useState(() => new Set());
        const running = children.filter((agent) => agent.running);
        const activeRuns = workflowRuns.filter((run) => run.status === 'running');
        const hasRunning = running.length > 0 || liveJobs.length > 0 || activeRuns.length > 0;
        const now = useTicker(open && hasRunning);
        useEffect(() => {
          if (!open) {
            setView('root');
            setExpanded(new Set());
          }
        }, [open]);

        // 常驻名册：跑完的子智能体与后台任务不再消失，只是变成「已完成」态；
        // 最近结束的排前面（按创建时间新→旧）。
        const ended = children
          .filter((agent) => !agent.running)
          .sort((left, right) => right.createdAt - left.createdAt);
        const avatars = pickAvatars(children);
        const overflow = children.length - avatars.length;
        // 计数：运行中 = 在跑的智能体 / 后台任务 / 工作流；空闲时 = 各类总量之和
        // （名册常驻后这就是本会话各自用了多少个）。
        const runningCount = running.length + liveJobs.length + activeRuns.length;
        const label = hasRunning ? t('activity.running') : t('activity.completed');
        const count = runningCount > 0 ? runningCount : children.length + settledJobs.length + workflowRuns.length;
        const canNavigate = typeof actions.openSession === 'function';
        // 点行打开子会话后顺手关掉浮层：宿主复用同一 composer 实例切会话时，
        // 浮层若留着会瞬间变成新会话的名册，视觉上闪变一次。
        const openChild = (agent, parentId) => {
          actions.openSession({ parentSessionId: parentId ?? sessionId, childSessionId: agent.id, mode: agent.mode });
          onClose();
        };
        const stopChild = (childId) => actions.stopSubagent(sessionId, childId);
        const switchView = (next) => {
          setView(next);
          setExpanded(new Set());
        };
        const toggleBranch = (childId) => {
          if (childId === null) {
            switchView('root');
            return;
          }
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(childId)) next.delete(childId);
            else next.add(childId);
            return next;
          });
          actions.refreshProjections(childId);
        };

        let body = null;
        let directories = null;
        if (view === 'subagents') {
          body = h(SubagentDirectory, {
            sessionId,
            projections,
            summaries,
            statuses,
            expanded,
            onBranch: toggleBranch,
            onOpen: canNavigate ? openChild : undefined,
            onRefresh: actions.refreshProjections,
            t,
          });
        } else if (view === 'workflows') {
          body = h(WorkflowDirectory, { runs: workflowRuns, onBack: () => switchView('root'), t });
        } else {
          const sections = [];
          // 任务完成后的用量小结（「各自用了多少个」）。
          if (!hasRunning && (children.length > 0 || settledJobs.length > 0 || workflowRuns.length > 0)) {
            sections.push(h('div', { key: 'summary', className: 'dsc-summary' }, t('summary.counts', { agents: children.length, jobs: settledJobs.length + liveJobs.length, flows: workflowRuns.length })));
          }
          if (running.length > 0) {
            sections.push(h('ul', { key: 'running', className: 'dsc-list' }, running.map((agent) => h(AgentRow, { key: agent.id, agent, now, onStop: stopChild, onOpen: canNavigate ? openChild : undefined, t }))));
          }
          if (liveJobs.length > 0 && jobs) {
            sections.push(h('ul', { key: 'jobs', className: 'dsc-list' }, liveJobs.map((job) => h(JobRow, { key: String(job.id), job, sessionId, service: jobs, now, t }))));
          }
          // 已结束：最新的在前；后台任务同理常驻（顺排展示）。
          if (ended.length > 0) {
            sections.push(h('ul', { key: 'ended', className: 'dsc-list' }, ended.map((agent) => h(AgentRow, { key: agent.id, agent, now, onOpen: canNavigate ? openChild : undefined, t }))));
          }
          const settledJobsView = settledJobs.length > 0 && jobs
            ? h('ul', { key: 'settled', className: 'dsc-list' }, settledJobs.slice().reverse().map((job) => h(JobRow, { key: String(job.id), job, sessionId, service: jobs, now, t })))
            : null;
          if (settledJobsView) sections.push(settledJobsView);
          if (sections.length > 0) body = h('div', { key: 'root' }, sections);
          if ((children.length > 0 && canNavigate) || workflowRuns.length > 0) {
            directories = h(
              'div',
              { key: 'directories' },
              body ? h('div', { className: 'dsc-sep' }) : null,
              children.length > 0 && canNavigate
                ? h(DirectoryRow, { icon: h(Face, { mono: true, size: 16 }), label: t('directory.subagent'), count: children.length, onOpen: () => switchView('subagents'), kind: 'subagents' })
                : null,
              workflowRuns.length > 0
                ? h(DirectoryRow, { icon: ICON.workflow(), label: t('directory.workflow'), count: workflowRuns.length, onOpen: () => switchView('workflows'), kind: 'workflows' })
                : null,
            );
          }
        }

        return h(
          'div',
          { className: 'dsc-capsule-wrap' },
          h(Capsule, {
            anchorRef,
            open,
            onToggle,
            label: t('activity.title') + '：' + label + ' ' + count,
            title: t('activity.title'),
            icon: avatars.length > 0 ? h(AvatarStack, { agents: avatars, overflow }) : ICON.pulse(),
            text: label,
            count,
            anchorName: '--dsc-anchor-activity',
          }),
          h(Popover, { open, anchorRef, onClose, label: t('activity.title'), anchorName: '--dsc-anchor-activity' }, body, directories),
        );
      }

      // ------------------------------------------------------------------
      // 对话流中的子智能体工具卡：以 priority −1 注册 tool.call.toolview 的
      // subagent / subagent_fork key（keyed 命中替换内置 DetailsRow 行）。
      // 头像 + 实时状态 + 计时，让「哪一步派了子代理」在时间线上一眼可见；
      // 本卡出错被弃用时，同 key 的内置 DetailsRow（priority 0）自动接管。
      // ------------------------------------------------------------------

      function SubagentToolRow(props) {
        const { toolName, block, phase, useSessions, t: tProp, lang } = props;
        const t = useMemo(() => makeT(tProp, lang), [tProp, lang]);
        // args 是流式视图（preparing 阶段可能不全），全部容错读取。
        let name = '';
        let description = '';
        let prompt = '';
        if (block && typeof block.args?.text === 'function') {
          try { name = (block.args.text('name') ?? '').trim(); } catch (error) { name = ''; }
          try { description = (block.args.text('description') ?? '').trim(); } catch (error) { description = ''; }
          try { prompt = (block.args.text('prompt') ?? '').trim(); } catch (error) { prompt = ''; }
        }
        const display = name || description.split(/\r?\n/, 1)[0] || (toolName === 'subagent_fork' ? 'fork' : 'subagent');
        const running = phase === 'start';
        // 秒表：start 时刻本地记录，result 后冻结为最后读数。
        const [startedAt, setStartedAt] = useState(null);
        useEffect(() => {
          if (phase === 'start' && startedAt === null) setStartedAt(Date.now());
        }, [phase, startedAt]);
        const [now, setNow] = useState(() => Date.now());
        useEffect(() => {
          if (!running) return undefined;
          const timer = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(timer);
        }, [running]);
        // 结果元数据里若有子会话 id，改用子会话投影的权威标题与耗时。
        const childId = block?.meta?.subagentId ?? block?.meta?.childId;
        const childSummary = typeof useSessions === 'function'
          ? useSessions((state) => (childId ? state?.byId?.[childId] : undefined))
          : undefined;
        const timing = childSummary?.projectionValues?.subagentTiming;
        const childElapsed = timing
          ? timing.settledMs + (timing.active ? Math.max(0, (running ? now : timing.active.through) - timing.active.since) : 0)
          : undefined;
        const faceState = running
          ? 'running'
          : childSummary
            ? childSummary.running
              ? 'running'
              : timing?.lastTurnCompleted === false
                ? 'ended'
                : 'done'
            : 'done';
        const [open, setOpen] = useState(false);
        const stateText = running ? t('tool.running') : faceState === 'ended' ? t('agent.ended') : t('agent.done');
        const localElapsed = running || startedAt === null ? (running && startedAt !== null ? now - startedAt : null) : now - startedAt;
        const dur = childElapsed !== undefined && childElapsed > 0
          ? formatDuration(childElapsed, t)
          : localElapsed !== null && localElapsed > 0
            ? formatDuration(localElapsed, t)
            : null;
        return h(
          'div',
          { className: 'dsc-toolcard', 'data-state': faceState },
          h(
            'button',
            { type: 'button', className: 'dsc-toolcard-head', 'aria-expanded': open, onClick: () => setOpen((current) => !current) },
            h('span', { className: 'dsc-glyph' }, h(Face, { name: childId || display, state: faceState, size: 16 })),
            h(
              'span',
              { className: 'dsc-main' },
              h('span', { className: 'dsc-title' }, t('tool.title') + ' · ' + display),
              h('span', { className: 'dsc-sub' }, [childSummary?.title !== display ? childSummary?.title : null, stateText, dur].filter(Boolean).join(' · ')),
            ),
            running ? h('span', { className: 'dsc-toolcard-state dsc-glyph dsc-glyph--spin' }, todoGlyph('in_progress')) : null,
            h('span', { className: 'dsc-toolcard-chevron' }, ICON.chevronRight()),
          ),
          open
            ? h(
                'div',
                { className: 'dsc-toolcard-body' },
                description ? h('p', { className: 'dsc-toolcard-desc' }, description) : null,
                prompt ? h('pre', { className: 'dsc-toolcard-pre' }, prompt) : null,
              )
            : null,
        );
      }

      // ------------------------------------------------------------------
      // 状态行（slot 条目组件）
      // ------------------------------------------------------------------

      function StatusRow(props) {
        const { sessionId, useProjection, useSessions, useSession, useSessionStatus, useConversation, t: tProp, jobs, actions, lang } = props;
        const t = useMemo(() => makeT(tProp, lang), [tProp, lang]);
        const todoValue = useProjection('todos');
        const projections = useSessions(selectProjections);
        const summaries = useSessions(selectById);
        const statuses = useSessionStatus(selectSelf);
        const workflowRuns = useConversation(selectWorkflowRuns);
        const jobRows = useJobRows(jobs, sessionId);
        const children = useMemo(() => buildChildren(projections?.[sessionId], summaries, statuses), [projections, summaries, statuses, sessionId]);
        const liveJobs = useMemo(() => jobRows.filter(isLiveJob), [jobRows]);
        const settledJobs = useMemo(() => jobRows.filter((job) => !isLiveJob(job)), [jobRows]);
        const todos = Array.isArray(todoValue) ? todoValue : EMPTY;
        const [openId, setOpenId] = useState(null);
        const toggle = useCallback((id) => setOpenId((current) => (current === id ? null : id)), []);
        const close = useCallback(() => setOpenId(null), []);
        const showTodo = todos.length > 0 || openId === 'todo';
        // 常驻：跑完的子智能体 / 后台任务也让胶囊留着（列表里变成「已完成」态）。
        const showActivity = children.length > 0 || jobRows.length > 0 || workflowRuns.length > 0 || openId === 'activity';
        // 打开期间不因数据瞬空强制关闭：待办被模型清空时浮层显示空态，由用户自行收起。
        if (!showTodo && !showActivity) return null;
        const reload = () => {
          try {
            window.location.reload();
          } catch (error) {
            /* 忽略：极端环境下无法刷新 */
          }
        };
        return h(
          'div',
          { className: 'dsc-row', 'data-dsc-row': '' },
          showTodo ? h(TodoCapsule, { key: 'todo', todos, open: openId === 'todo', onToggle: () => toggle('todo'), onClose: close, t }) : null,
          showActivity
            ? h(ActivityCapsule, {
                key: 'activity',
                sessionId,
                children,
                liveJobs,
                settledJobs,
                workflowRuns,
                projections,
                summaries,
                statuses,
                jobs,
                open: openId === 'activity',
                onToggle: () => toggle('activity'),
                onClose: close,
                actions,
                t,
              })
            : null,
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsc-refresh',
            title: t('refresh.title'),
            'aria-label': t('refresh.title'),
            onClick: reload,
          }, ICON.refresh()),
        );
      }

      /** slot 条目：标准 props 不齐（极旧的 DSH）时退回最简待办胶囊。 */
      function StatusDock(props) {
        const { useProjection, useSessions, useSession, useSessionStatus, useConversation } = props;
        if (
          typeof useProjection !== 'function' ||
          typeof useSessions !== 'function' ||
          typeof useSession !== 'function' ||
          typeof useSessionStatus !== 'function' ||
          typeof useConversation !== 'function'
        ) {
          return h(FallbackDock, { ...props, reason: 'missing standard props: ' + missingHooks(props).join(',') });
        }
        return h(StatusRow, props);
      }

      function missingHooks(props) {
        return ['useProjection', 'useSessions', 'useSession', 'useSessionStatus', 'useConversation'].filter((name) => typeof props[name] !== 'function');
      }

      function errorText(error) {
        const text = error && error.stack ? String(error.stack) : String(error);
        return text.split('\n').slice(0, 6).join(' | ').slice(0, 480);
      }

      /**
       * 兜底：完整状态行出错时只依赖 `todos` 投影的最简待办胶囊。
       * 遮蔽发生在注册层，所以这个条目不能什么都不画——否则用户会连待办都看不到。
       * 出错原因写进 aria-label，便于从无障碍树/读屏里直接读到。
       */
      function FallbackDock(props) {
        const t = makeT(props.t, props.lang);
        const todos = (typeof props.useProjection === 'function' ? props.useProjection('todos') : null) ?? EMPTY;
        const summary = todoSummary(Array.isArray(todos) ? todos : EMPTY);
        const message = props.error ? errorText(props.error) : String(props.reason ?? 'fallback');
        return h(
          'div',
          { className: 'dsc-row', 'data-dsc-fallback': '' },
          h(
            'button',
            { type: 'button', className: 'dsc-capsule', 'aria-label': 'dsc-status: ' + message, title: message },
            h('span', { className: 'dsc-capsule-icon' }, ICON.checks()),
            h('span', { className: 'dsc-capsule-label' }, t('todo.' + summary.status)),
            h('span', { className: 'dsc-capsule-count' }, summary.completed + '/' + summary.total),
          ),
          h('button', {
            type: 'button',
            className: 'dsc-refresh',
            title: t('refresh.title'),
            'aria-label': t('refresh.title'),
            onClick: () => {
              try {
                window.location.reload();
              } catch (error) {
                /* 忽略 */
              }
            },
          }, ICON.refresh()),
        );
      }

      /** 条目级错误边界：渲染错误不弃用条目，改画兜底胶囊；8 秒后自动重试真实 UI，
       * 仍崩再闩——瞬时性的数据抖动（如流式期间的短暂畸形投影）能自愈。 */
      class StatusBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { error: null };
          this.resetTimer = undefined;
        }
        static getDerivedStateFromError(error) {
          return { error };
        }
        componentDidCatch(error) {
          console.error('[' + PLUGIN_ID + '] status row crashed, retrying in ' + RECOVERY_MS + 'ms', error);
          clearTimeout(this.resetTimer);
          this.resetTimer = setTimeout(() => this.setState({ error: null }), RECOVERY_MS);
        }
        componentWillUnmount() {
          clearTimeout(this.resetTimer);
        }
        render() {
          if (!this.state.error) return this.props.children;
          return h(FallbackDock, { ...this.props.fallbackProps, error: this.state.error });
        }
      }

      // ------------------------------------------------------------------
      // 插件装配
      // ------------------------------------------------------------------

      return {
        inject: ['slots', 'sessions', 'remote', 'uiWorkspace', 'locale'],
        apply(ctx) {
          let lang = 'zh';
          try {
            const active = ctx.locale?.getLocale?.()?.active;
            if (typeof active === 'string') lang = active.toLowerCase().startsWith('zh') ? 'zh' : 'en';
          } catch (error) {
            lang = 'zh';
          }
          ctx.effect(() => ctx.locale.register(NS, DICTS), PLUGIN_ID + ': dictionaries');
          const t = ctx.locale.bind(NS);

          // 幂等注入：HMR 重建时若上一份样式的清理没跑到，旧标签会和新标签级联叠加，
          // 合并出错误的定位规则（历史 bug：面板被推离胶囊）。先扫掉再插入，保证唯一。
          for (const stale of document.head.querySelectorAll('style[data-plugin="' + PLUGIN_ID + '"]')) stale.remove();
          const style = document.createElement('style');
          style.textContent = CSS;
          style.setAttribute('data-plugin', PLUGIN_ID);
          document.head.appendChild(style);
          ctx.effect(() => () => style.remove(), PLUGIN_ID + ': styles');

          const actions = {
            openSession(address) {
              try {
                ctx.uiWorkspace.openSession(address);
              } catch (error) {
                console.error('[' + PLUGIN_ID + '] openSession failed', error);
              }
            },
            /**
             * 请求中断一个正在运行的子会话。
             * DSH 0.2.2-rc.5 起端点为 `subagents.interruptByUser(childId)`，
             * 成功返回 `{ accepted: true }`；更早的 Host 退回
             * `interruptByParent(childId, parentId, 'continuable')`（RemoteResult 形状）。
             */
            async stopSubagent(parentSessionId, childId) {
              const subagents = ctx.remote?.subagents;
              if (!subagents) return { ok: false };
              if (typeof subagents.interruptByUser === 'function') return subagents.interruptByUser(childId);
              if (typeof subagents.interruptByParent === 'function') return subagents.interruptByParent(childId, parentSessionId, 'continuable');
              return { ok: false };
            },
            refreshProjections(targetSessionId) {
              try {
                ctx.sessions.refreshProjections(targetSessionId);
              } catch (error) {
                /* 目标不可用时静默：目录行保持可展开，再点一次即可 */
              }
            },
          };

          let disposeDock = null;
          let alive = true;
          /** （重新）注册 dock 条目；jobs 服务晚到时带上它重挂一次。 */
          const mount = (jobs) => {
            if (disposeDock) disposeDock();
            const entryProps = (props) => ({ ...props, jobs, actions, lang, t });
            disposeDock = ctx.slots.inject(SLOT, () =>
              ctx.slots.register({ name: SLOT, id: TODO_ID, priority: TODO_PRIORITY, order: 0, locale: NS }, (props) =>
                h(StatusBoundary, { fallbackProps: entryProps(props) }, h(StatusDock, entryProps(props)))),
            );
          };
          mount(undefined);
          ctx.effect(
            () => () => {
              alive = false;
            },
            PLUGIN_ID + ': lifetime',
          );
          ctx.inject(['jobs'], (scope) => {
            mount(scope.jobs);
            return () => {
              if (alive) mount(undefined);
            };
          });
          // 对话流中的子智能体工具卡（keyed 命中替换内置 DetailsRow；出错时它接管）。
          ctx.slots.inject('tool.call.toolview', () => {
            ctx.slots.register({ name: 'tool.call.toolview', key: 'subagent', priority: -1, locale: NS }, (props) => h(SubagentToolRow, { ...props, lang }));
            ctx.slots.register({ name: 'tool.call.toolview', key: 'subagent_fork', priority: -1, locale: NS }, (props) => h(SubagentToolRow, { ...props, lang }));
          });
          // 会话时间线里的回合触发标记（团队消息、子智能体结算…）：keyed 接管，
          // 事件带上发送者的头像脸（九色板取色）与身份（senderSessionId ↔ 会话标题）。
          ctx.slots.inject('conversation.chat.node', () => {
            ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-trigger', priority: -1, locale: NS }, (props) => h(TriggerNode, props));
          });
          // 模型选择座位：以更低的 priority 压过内置 seat（ZCode 风格双栏 + 推理等级）。
          // 目录状态与提交动作复用宿主 modelDirectories 服务——与 /model 弹窗共享同一份
          // 会话状态，任何一边切换另一边即时同步。children 不在这里重复声明（ledger 里
          // 宿主已声明，重复声明会验证失败导致条目被弃用）；服务未挂载时不注入，
          // 内置 seat 原样保留。
          const mountModelSeat = (models, sessions) => {
            ctx.slots.inject('conversation.input.model', () =>
              ctx.slots.register(
                {
                  name: 'conversation.input.model',
                  id: PLUGIN_ID + '-model-seat',
                  priority: -1,
                  order: 0,
                  locale: NS,
                  inject: (sessionId) => {
                    let directory;
                    let seatAvailable = false;
                    let seatFailed = false;
                    try {
                      directory = models.directoryFor(sessionId);
                      seatAvailable = sessions.subagentAddress(sessionId) === undefined;
                    } catch (error) {
                      // 目录解析失败 ≠ 子代理会话的「合理隐藏」：标记失败，让组件在渲染时
                      // 显式抛错弃用条目，把座位还给内置选择器，而不是静默画空。
                      directory = undefined;
                      seatAvailable = true;
                      seatFailed = true;
                    }
                    return {
                      available: seatAvailable,
                      seatFailed,
                      directory: seatAvailable && !seatFailed ? directory : undefined,
                      load: () => {
                        if (seatAvailable && directory) directory.load().catch(() => { /* 面板内呈现 */ });
                      },
                      resolveText: (text) => badgeText(ctx.locale && typeof ctx.locale.resolveText === 'function' ? ctx.locale.resolveText : undefined, text),
                      select: (selection) => (seatAvailable && directory ? directory.select(selection) : Promise.resolve(undefined)),
                    };
                  },
                },
                (props) => h(ModelSeat, props),
              ),
            );
          };
          try {
            mountModelSeat(ctx.modelDirectories, ctx.sessions);
          } catch (error) {
            ctx.inject(['modelDirectories', 'sessions'], (scope) => mountModelSeat(scope.modelDirectories, scope.sessions));
          }
        },
      };
    },
  });
})();

# NOTICE

本插件以 MIT 许可证发布（见 `LICENSE`）。以下部分包含或改编自第三方作品：

## ZCode — 模型选择面板 / 思考强度滑杆 / 子智能体头像与状态胶囊的视觉设计

- 来源：[zai-org/ZCode](https://github.com/zai-org/ZCode)（仓库根目录 `LICENSE` 为 Apache License 2.0）
  - `packages/ui/src/components/workflow-timeline/WorkflowAgentFace.tsx`
  - `packages/ui/src/v4/ConversationStatusPanel.tsx`
  - `packages/ui/src/chat-input-toolbar/composer-thought-slider.css`（思考强度滑杆）
  - `packages/ui/src/chat-input-toolbar/ComposerModelMenu.tsx`（模型选择菜单结构）
- 版权：ZCode 贡献者
- 许可证：Apache License 2.0（全文见 `LICENSES/ZCode-APACHE-2.0.txt`）

`client.js` 中的 `Face` 组件（圆角方块 + 两只眼的头像、完成 / 结束徽标）和九色头像配色
`FACE_COLORS` 改编自 ZCode 的 `WorkflowAgentFace`；胶囊行「待办胶囊 + 活动胶囊」的
信息架构与部分中文文案（处理中 / 已完成 / 子智能体目录 / 工作流目录）参考了
`ConversationStatusPanel`。

**思考强度滑杆**（`EffortSlider` + `EFFORT_BUBBLES` + `.dsc-slider-*` 样式）按 ZCode
`composer-thought-slider` 移植：12 粒气泡种子、白色 28px 滑块、24px 轨道、
`calc(14px + (100% − 28px) × 进度)` 填充公式、最高档 `oklch shorter hue` 蓝→绿渐变淡入、
GLM FlashX/Highspeed 的 oklab 蓝→紫变体、`prefers-reduced-motion` 降级——均来自原实现。
**模型选择双栏面板**的结构（provider 列 + 模型列 + 底部档位区）参考 `ComposerModelMenu`。

改动说明：ZCode 原实现依赖 React Hooks 驱动的随机表情动画与 CSS 变量主题，
本插件改为纯 SVG 属性 + 一条 CSS 眨眼动画，状态集合收敛为 DSH 能提供的四种
（running / done / ended / idle），徽标与眼睛的路径重新绘制；滑杆的主题色改为
DSH 的 `--dsw-alias-*` 变量并附字面回退，气泡改为双层结构（满宽位移动画层 + 白色圆点）；
未复制 ZCode 的数据模型、浮层实现或样式体系。

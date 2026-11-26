# NOTICE

本插件以 MIT 许可证发布（见 `LICENSE`）。以下部分包含或改编自第三方作品：

## ZCode — 子智能体头像与状态胶囊的视觉设计

- 来源：[zai-org/ZCode](https://github.com/zai-org/ZCode)（仓库根目录 `LICENSE` 为 Apache License 2.0）
  - `packages/ui/src/components/workflow-timeline/WorkflowAgentFace.tsx`
  - `packages/ui/src/v4/ConversationStatusPanel.tsx`
- 版权：ZCode 贡献者
- 许可证：Apache License 2.0（全文见 `LICENSES/ZCode-APACHE-2.0.txt`）

`client.js` 中的 `Face` 组件（圆角方块 + 两只眼的头像、完成 / 结束徽标）和九色头像配色
`FACE_COLORS` 改编自 ZCode 的 `WorkflowAgentFace`；胶囊行「待办胶囊 + 活动胶囊」的
信息架构与部分中文文案（处理中 / 已完成 / 子智能体目录 / 工作流目录）参考了
`ConversationStatusPanel`。

改动说明：ZCode 原实现依赖 React Hooks 驱动的随机表情动画与 CSS 变量主题，
本插件改为纯 SVG 属性 + 一条 CSS 眨眼动画，状态集合收敛为 DSH 能提供的四种
（running / done / ended / idle），徽标与眼睛的路径重新绘制；未复制 ZCode 的
数据模型、浮层实现或样式体系。

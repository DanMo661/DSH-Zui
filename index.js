/**
 * dsh-pulse —— Host 半边。
 *
 * 纯界面插件：Host 侧没有任何行为。这个空的 apply 只是让插件成为一条
 * 普通的 Loader 条目；全部功能在浏览器半边 `client.js` 里，由 package.json
 * 的 `dsh.client` 声明被发现和加载。
 */

/** Loader 可见的空实现；功能全部由浏览器半边承载。 */
export function apply() {}

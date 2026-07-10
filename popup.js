/**
 * Volume Booster —— popup（弹出窗口）
 * ======================================
 *
 * 用户点击浏览器工具栏上的扩展图标时，弹出这个小窗口。
 * 它运行在独立的 popup 环境中，和页面（content script）是隔离的。
 *
 * 通信方式：
 *   这里（popup） → chrome.tabs.sendMessage() → content.js
 *   content.js   → 处理音频增益
 *
 * 两种存储方式各司其职：
 *   chrome.storage.sync    —— 持久化保存（关掉浏览器再打开，设置还在）
 *   chrome.tabs.sendMessage —— 实时通知（让正在播放的页面立即生效）
 */

// =====================================================================
// 获取 DOM 元素引用
// =====================================================================

const slider = document.getElementById('slider');
const boostValue = document.getElementById('boostValue');
const protectionToggle = document.getElementById('protectionToggle');
const protectionLabel = document.getElementById('protectionLabel');

// =====================================================================
// 读取上次保存的设置（打开弹窗时自动执行）
// =====================================================================

/**
 * chrome.storage.sync.get()
 *
 * 从浏览器的同步存储中读取之前用户设置的值。
 * 第一个参数的键名要和 content.js 中保持一致：
 *   - 'boostLevel'         —— 增益倍数
 *   - 'qualityProtection'  —— 削波保护开关
 *
 * 如果用户第一次使用（存储里没有数据），就用默认值 { boostLevel: 1, qualityProtection: true }
 */
chrome.storage.sync.get({ boostLevel: 1, qualityProtection: true }, (data) => {
  slider.value = data.boostLevel;
  boostValue.textContent = `${parseFloat(data.boostLevel).toFixed(1)}x`;
  protectionToggle.checked = data.qualityProtection;
  protectionLabel.textContent = data.qualityProtection ? 'Quality Protection' : 'Protection Off';
});

// =====================================================================
// 增益滑块
// =====================================================================

/**
 * input 事件：用户拖动滑块时实时触发
 *
 * 每次拖动都做两件事：
 *   1. 保存到 chrome.storage.sync —— 下次打开页面还能用这个值
 *   2. 发送消息给 content.js      —— 让正在播放的页面立即生效
 *
 * 注意用的是 'input' 而不是 'change'：
 *   'input'   → 拖动过程中连续触发（实时反馈）
 *   'change'  → 松手后才触发一次
 */
slider.addEventListener('input', () => {
  const val = parseFloat(slider.value);
  boostValue.textContent = `${val.toFixed(1)}x`;
  chrome.storage.sync.set({ boostLevel: val });
  sendToTab({ type: 'setBoost', value: val });
});

// =====================================================================
// 削波保护开关
// =====================================================================

protectionToggle.addEventListener('change', () => {
  const enabled = protectionToggle.checked;
  protectionLabel.textContent = enabled ? 'Quality Protection' : 'Protection Off';
  chrome.storage.sync.set({ qualityProtection: enabled });
  sendToTab({ type: 'setProtection', value: enabled });
});

// =====================================================================
// 与 content script 通信
// =====================================================================

/**
 * sendToTab() —— 向当前活动标签页发送消息
 *
 * chrome.tabs.query() 获取当前激活的标签页，
 * chrome.tabs.sendMessage() 向该标签页的 content script 发消息。
 *
 * .catch(() => {}) 是因为有些页面没有 content script（比如 chrome:// 开头的页面），
 * sendMessage 会失败，但我们不想让用户看到错误提示。
 *
 * @param {Object} msg - 消息对象，例如 { type: 'setBoost', value: 2.5 }
 */
function sendToTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  });
}

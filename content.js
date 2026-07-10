/**
 * Volume Booster —— content script（内容脚本）
 * ==============================================
 *
 * 这是扩展的核心部分。Chrome 扩展有三个主要组件：
 *
 *   1. manifest.json     —— 扩展的"身份证"，声明权限、文件位置等
 *   2. content script    —— 注入到每个页面里的脚本（本文件），能操作页面的 DOM
 *   3. popup             —— 点击工具栏图标弹出的窗口（popup.html + popup.js）
 *
 * ── 扩展的工作原理 ──
 *
 *   HTML 的 <audio> / <video> 元素，音量最大只能到 1.0（100%）。
 *   要突破这个限制，需要借助 Web Audio API：
 *
 *     媒体元素 → 源节点(SourceNode) → 增益节点(GainNode) → 扬声器
 *
 *   GainNode 的 gain 值可以 > 1.0，从而实现"增强"（boosting）。
 *   但信号过大会"削波"（clipping，波形被切平，产生破音），
 *   所以我们再加一个 DynamicsCompressorNode 作为"保险"。
 *
 * ── 本文件做的事 ──
 *
 *   1. 页面加载后，找到所有 <audio> / <video> 元素
 *   2. 把它们的音频路由到我们创建的增益图上
 *   3. 监听 popup 发来的消息，实时调整增益值
 *   4. 通过 MutationObserver 监听新加入的媒体元素（比如 SPA 切换页面）
 */

// =====================================================================
// 全局状态
// =====================================================================

let audioContext = null;
// Map 存储每个媒体元素对应的音频节点，键是元素本身，值是 { source, gain, compressor }
// 用 Map 而不用 WeakMap，是因为我们需要遍历所有条目来更新增益值
const elementMap = new Map();
let boostLevel = 1;          // 当前增益倍数，默认 1x（不增强）
let protectionEnabled = true; // 是否开启削波保护

// =====================================================================
// 启动流程
// =====================================================================

/**
 * chrome.storage.sync.get()
 * ──────────────────────────
 * 从 Chrome 的同步存储中读取上次用户设置的值。
 * 这是扩展的"记忆"——关闭浏览器再打开，设置依然在。
 *
 * 第一个参数 { boostLevel: 1, qualityProtection: true } 是默认值。
 * 如果存储里没有这个键（第一次使用），就用默认值。
 *
 * 这是个异步操作（读存储需要时间），所以 init() 在回调里调用。
 */
chrome.storage.sync.get({ boostLevel: 1, qualityProtection: true }, (data) => {
  boostLevel = data.boostLevel;
  protectionEnabled = data.qualityProtection;
  init();
});

function init() {
  // ── 处理页面上已有的媒体元素 ──
  // querySelectorAll('audio, video') 找到所有 <audio> 和 <video> 标签
  document.querySelectorAll('audio, video').forEach(wireElement);

  // ── MutationObserver: 监听后来新加入的元素 ──
  // 很多网站是 SPA（单页应用），切换页面时不刷新，而是用 JS 动态创建元素。
  // MutationObserver 能监听到 DOM 变化，发现新的 <audio>/<video> 就处理它。
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        // node.matches() 判断这个节点本身是不是 audio/video
        if (node.matches?.('audio, video')) wireElement(node);
        // node.querySelectorAll() 查找这个节点内部的 audio/video
        node.querySelectorAll?.('audio, video').forEach(wireElement);
      }
    }
  });
  // 监听整个 document.body 的子节点变化（包括深层子树）
  observer.observe(document.body, { childList: true, subtree: true });

  // ── 处理浏览器的自动播放策略 ──
  // 浏览器为了不让网页偷偷播放声音，AudioContext 创建后默认是"suspended"（暂停）状态。
  // 必须等到用户点了页面（click 事件）才能恢复。
  // { once: true } 表示这个监听器执行一次后就自动移除。
  document.addEventListener('click', resumeContext, { once: true });
}

/**
 * 恢复 AudioContext（处理自动播放策略）
 *
 * AudioContext 的状态可能是 "suspended"（被浏览器暂停了）。
 * .resume() 方法可以让它恢复工作。
 */
function resumeContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// =====================================================================
// 核心：连接媒体元素到我们的音频增益图
// =====================================================================

/**
 * wireElement() —— 把一个媒体元素接入增益图
 *
 * 音频信号路径：
 *
 *   HTMLMediaElement (.volume = 1)
 *     → MediaElementAudioSourceNode（把元素变成音频源）
 *       → GainNode（增益/放大，1.0~5.0 倍）
 *         → DynamicsCompressorNode（削波保护，防止破音）
 *           → AudioContext.destination（最终输出到扬声器）
 *
 * @param {HTMLMediaElement} el - <audio> 或 <video> 元素
 */
function wireElement(el) {
  // 如果已经处理过这个元素，跳过
  if (elementMap.has(el)) return;

  // ── 情况 1：元素还没有加载媒体源 ──
  // 比如 <video> 标签没有 src 属性，JS 还没给它赋值。
  // 等它触发 loadedmetadata 事件时再来处理。
  if (!el.src && !el.srcObject) {
    el.addEventListener('loadedmetadata', () => wireElement(el), { once: true });
    return;
  }

  // ── 情况 2：元素存在但没有播放 ──
  // 页面里有很多 <video> 只是占位，根本没在播放。
  // 等用户点"播放"按钮（play 事件）时再来处理，避免浪费资源。
  if (el.paused) {
    el.addEventListener('play', () => wireElement(el), { once: true });
    return;
  }

  // ── 元素正在播放，开始连接 ──

  // 把元素的原生音量设为最大（1.0），这样我们的增益节点就是唯一的音量控制器
  el.volume = 1;

  try {
    // 首次连接时创建 AudioContext
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    // 创建三个节点：源 → 增益 → 压缩器
    const source = audioContext.createMediaElementSource(el);
    const gain = audioContext.createGain();
    gain.gain.value = boostLevel;

    const compressor = audioContext.createDynamicsCompressor();
    setCompressorParams(compressor);

    // 串联起来
    source.connect(gain);
    gain.connect(compressor);
    compressor.connect(audioContext.destination);

    // 存入 Map，后续更新增益值时需要用到
    elementMap.set(el, { source, gain, compressor });
  } catch (e) {
    // 如果元素已经被别的 AudioContext 占用了（比如 YouTube 有自己的音频处理），
    // createMediaElementSource 会抛出错误。这种情况无法增强，跳过即可。
  }
}

// =====================================================================
// 削波保护（DynamicsCompressorNode）
// =====================================================================

/**
 * 设置压缩器的参数
 *
 * 压缩器像是一个"自动音量管理员"：
 * - 声音小的时候不管
 * - 声音大到快要削波（超过 -6dB）时，自动把峰值压下来
 * - 这样音量感觉上更大，但不会出现刺耳的破音
 *
 * 关闭保护时，ratio = 1:1（1 进 1 出），压缩器变成直通，不做任何处理。
 */
function setCompressorParams(compressor) {
  if (protectionEnabled) {
    compressor.threshold.value = -6;    // 阈值：超过 -6dB 开始压缩
    compressor.knee.value      = 6;     // 拐点：6dB 的平滑过渡区
    compressor.ratio.value     = 12;    // 压缩比：12:1，超过阈值的声音只放大 1/12
    compressor.attack.value    = 0.003; // 启动时间：3ms，够快抓住瞬态峰值
    compressor.release.value   = 0.1;   // 释放时间：100ms，快速恢复
  } else {
    // 关闭状态：ratio=1 就是直通，不做任何处理
    compressor.threshold.value = 0;
    compressor.ratio.value     = 1;
    compressor.knee.value      = 0;
    compressor.attack.value    = 0;
    compressor.release.value   = 0;
  }
}

// =====================================================================
// 批量更新
// =====================================================================

/**
 * 更新所有已连接元素的增益值
 *
 * 用户拖动滑块时，popup 发消息过来，这里遍历所有元素更新 gain。
 * 同时清理已经从 DOM 中移除的元素（el.isConnected === false）。
 */
function updateAllGains(value) {
  for (const [el, { gain }] of elementMap.entries()) {
    if (el.isConnected) {
      gain.gain.value = value;
    } else {
      elementMap.delete(el);
    }
  }
}

/**
 * 更新所有压缩器的开关状态
 */
function updateAllCompressors() {
  for (const [el, { compressor }] of elementMap.entries()) {
    if (el.isConnected) {
      setCompressorParams(compressor);
    }
  }
}

// =====================================================================
// 消息通信：接收 popup 发来的指令
// =====================================================================

/**
 * chrome.runtime.onMessage.addListener()
 * ─────────────────────────────────────
 * 这是扩展的"消息通道"。popup（弹窗）和 content script（本文件）
 * 运行在不同的环境下，不能直接调用对方的函数。
 *
 * 通信方式：
 *   popup.js  →  chrome.tabs.sendMessage(tabId, { type, value })
 *              →  本文件的 onMessage 监听器收到消息
 *              →  处理完后调用 sendResponse() 回复
 *
 * 消息类型：
 *   'setBoost'      —— 用户拖动滑块，调整增益倍数
 *   'setProtection' —— 用户切换削波保护开关
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'setBoost') {
    boostLevel = msg.value;
    resumeContext();        // 用户操作了，可以恢复 AudioContext
    updateAllGains(boostLevel);
    sendResponse({ ok: true });
  } else if (msg.type === 'setProtection') {
    protectionEnabled = msg.value;
    updateAllCompressors();
    sendResponse({ ok: true });
  }
});

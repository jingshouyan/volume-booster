// Volume Booster — routes media elements through a GainNode for >1x amplification
let audioContext = null;
const elementMap = new WeakMap(); // HTMLMediaElement → { source, gain }
let boostLevel = 1;

// Restore persisted boost level, then init
chrome.storage.sync.get({ boostLevel: 1 }, (data) => {
  boostLevel = data.boostLevel;
  init();
});

function init() {
  // Wire existing media elements
  document.querySelectorAll('audio, video').forEach(connectElement);

  // Watch for dynamically added elements
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.('audio, video')) connectElement(node);
        node.querySelectorAll?.('audio, video').forEach(connectElement);
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Resume AudioContext on first user click (autoplay policy workaround)
  document.addEventListener('click', resumeContext, { once: true });
}

function resumeContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function connectElement(el) {
  if (elementMap.has(el)) return;
  if (!el.src && !el.srcObject) {
    // Element may get a source later
    el.addEventListener('loadedmetadata', () => connectElement(el), { once: true });
    return;
  }

  // Set native volume to 1 so our GainNode is the sole volume control
  el.volume = 1;

  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    const source = audioContext.createMediaElementSource(el);
    const gain = audioContext.createGain();
    gain.gain.value = boostLevel;

    source.connect(gain);
    gain.connect(audioContext.destination);

    elementMap.set(el, { source, gain });
  } catch (e) {
    // Element is already connected to another AudioContext (e.g. YouTube's own)
    // Can't boost via this method — skip silently
  }
}

// Listen for live boost changes from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'setBoost') {
    boostLevel = msg.value;
    resumeContext();
    for (const [el, { gain }] of elementMap) {
      if (document.contains(el)) {
        gain.gain.value = boostLevel;
      } else {
        elementMap.delete(el);
      }
    }
    sendResponse({ ok: true });
  }
});

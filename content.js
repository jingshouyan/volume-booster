// Volume Booster — routes media elements through a GainNode for >1x amplification
let audioContext = null;
const elementMap = new Map(); // HTMLMediaElement → { source, gain }
let boostLevel = 1;

// Restore persisted boost level, then init
chrome.storage.sync.get({ boostLevel: 1 }, (data) => {
  boostLevel = data.boostLevel;
  init();
});

function init() {
  // Wire existing elements that are already playing
  document.querySelectorAll('audio, video').forEach(wireElement);

  // Watch for dynamically added elements
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.('audio, video')) wireElement(node);
        node.querySelectorAll?.('audio, video').forEach(wireElement);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Resume AudioContext on first user click (autoplay policy workaround)
  document.addEventListener('click', resumeContext, { once: true });
}

function resumeContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function wireElement(el) {
  if (elementMap.has(el)) return;

  // Defer until the element has a source
  if (!el.src && !el.srcObject) {
    el.addEventListener('loadedmetadata', () => wireElement(el), { once: true });
    return;
  }

  // Defer until playback starts (avoids wiring elements that never play)
  if (el.paused) {
    el.addEventListener('play', () => wireElement(el), { once: true });
    return;
  }

  // The element is actively playing — wire it up
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
    // Element already connected to another AudioContext (e.g. YouTube)
    // Can't boost via this method — skip silently
  }
}

// Update every connected gain node
function updateAllGains(value) {
  for (const [el, { gain }] of elementMap.entries()) {
    if (el.isConnected) {
      gain.gain.value = value;
    } else {
      elementMap.delete(el);
    }
  }
}

// Listen for live boost changes from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'setBoost') {
    boostLevel = msg.value;
    resumeContext();
    updateAllGains(boostLevel);
    sendResponse({ ok: true });
  }
});

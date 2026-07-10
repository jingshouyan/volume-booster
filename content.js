// Volume Booster — routes media elements through a GainNode for >1x amplification
let audioContext = null;
const elementMap = new Map(); // HTMLMediaElement → { source, gain, compressor }
let boostLevel = 1;
let protectionEnabled = true;

// Restore persisted settings, then init
chrome.storage.sync.get({ boostLevel: 1, qualityProtection: true }, (data) => {
  boostLevel = data.boostLevel;
  protectionEnabled = data.qualityProtection;
  init();
});

function init() {
  document.querySelectorAll('audio, video').forEach(wireElement);

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

  document.addEventListener('click', resumeContext, { once: true });
}

function resumeContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function wireElement(el) {
  if (elementMap.has(el)) return;

  if (!el.src && !el.srcObject) {
    el.addEventListener('loadedmetadata', () => wireElement(el), { once: true });
    return;
  }

  if (el.paused) {
    el.addEventListener('play', () => wireElement(el), { once: true });
    return;
  }

  el.volume = 1;

  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    const source = audioContext.createMediaElementSource(el);
    const gain = audioContext.createGain();
    gain.gain.value = boostLevel;

    // DynamicsCompressorNode acts as a limiter to prevent hard clipping
    const compressor = audioContext.createDynamicsCompressor();
    setCompressorParams(compressor);

    source.connect(gain);
    gain.connect(compressor);
    compressor.connect(audioContext.destination);

    elementMap.set(el, { source, gain, compressor });
  } catch (e) {
    // Element already connected to another AudioContext (e.g. YouTube)
  }
}

// Set compressor params for protection or transparent pass-through
function setCompressorParams(compressor) {
  if (protectionEnabled) {
    compressor.threshold.value = -6;   // dB — start compressing above this
    compressor.knee.value      = 6;    // dB — smooth transition into compression
    compressor.ratio.value     = 12;   // :1 — strong limiting
    compressor.attack.value    = 0.003; // seconds — fast enough to catch transients
    compressor.release.value   = 0.1;  // seconds — quick recovery
  } else {
    compressor.threshold.value = 0;
    compressor.ratio.value     = 1;    // 1:1 = no compression
    compressor.knee.value      = 0;
    compressor.attack.value    = 0;
    compressor.release.value   = 0;
  }
}

function updateAllGains(value) {
  for (const [el, { gain }] of elementMap.entries()) {
    if (el.isConnected) {
      gain.gain.value = value;
    } else {
      elementMap.delete(el);
    }
  }
}

function updateAllCompressors() {
  for (const [el, { compressor }] of elementMap.entries()) {
    if (el.isConnected) {
      setCompressorParams(compressor);
    }
  }
}

// Listen for live updates from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'setBoost') {
    boostLevel = msg.value;
    resumeContext();
    updateAllGains(boostLevel);
    sendResponse({ ok: true });
  } else if (msg.type === 'setProtection') {
    protectionEnabled = msg.value;
    updateAllCompressors();
    sendResponse({ ok: true });
  }
});

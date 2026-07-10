const slider = document.getElementById('slider');
const boostValue = document.getElementById('boostValue');
const protectionToggle = document.getElementById('protectionToggle');
const protectionLabel = document.getElementById('protectionLabel');

// Load persisted settings
chrome.storage.sync.get({ boostLevel: 1, qualityProtection: true }, (data) => {
  slider.value = data.boostLevel;
  boostValue.textContent = `${parseFloat(data.boostLevel).toFixed(1)}x`;
  protectionToggle.checked = data.qualityProtection;
  protectionLabel.textContent = data.qualityProtection ? 'Quality Protection' : 'Protection Off';
});

// Boost slider
slider.addEventListener('input', () => {
  const val = parseFloat(slider.value);
  boostValue.textContent = `${val.toFixed(1)}x`;
  chrome.storage.sync.set({ boostLevel: val });
  sendToTab({ type: 'setBoost', value: val });
});

// Protection toggle
protectionToggle.addEventListener('change', () => {
  const enabled = protectionToggle.checked;
  protectionLabel.textContent = enabled ? 'Quality Protection' : 'Protection Off';
  chrome.storage.sync.set({ qualityProtection: enabled });
  sendToTab({ type: 'setProtection', value: enabled });
});

function sendToTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  });
}

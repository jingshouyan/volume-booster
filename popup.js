const slider = document.getElementById('slider');
const boostValue = document.getElementById('boostValue');

// Load persisted boost level
chrome.storage.sync.get({ boostLevel: 1 }, (data) => {
  const val = parseFloat(data.boostLevel) || 1;
  slider.value = val;
  boostValue.textContent = `${val.toFixed(1)}x`;
});

slider.addEventListener('input', () => {
  const val = parseFloat(slider.value);
  boostValue.textContent = `${val.toFixed(1)}x`;

  // Persist
  chrome.storage.sync.set({ boostLevel: val });

  // Push live update to the active tab's content script
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'setBoost', value: val })
        .catch(() => {
          // Content script may not be injected on this page (e.g. chrome:// pages)
        });
    }
  });
});

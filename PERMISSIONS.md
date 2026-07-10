# Permission Justifications — Volume Booster

This document explains why each permission declared in `manifest.json` is required, for Edge Add-ons review.

---

## `storage`

**Declared in manifest:**
```json
"permissions": ["storage"]
```

### Why it's needed

The extension has two independent execution contexts that must agree on the boost level without relying on real-time messages:

| Context | When it runs | What it needs |
|---------|-------------|---------------|
| **Content script** (`content.js`) | Loads with every page, before the user opens the popup | The last boost level the user chose, so audio is amplified immediately on page load |
| **Popup** (`popup.html` + `popup.js`) | Opens only when the user clicks the toolbar icon | A place to persist the user's setting across sessions |

`chrome.storage.sync` is the **only** storage mechanism both contexts can read and write independently at any time:

```
popup.js                                    content.js
───────                                    ──────────
User drags slider
  → storage.sync.set({ boostLevel: 2.5 })
  → tabs.sendMessage({ type: 'setBoost' }) → gain.value = 2.5  (live update)
                                               ↑
                            Next page load ──→ storage.sync.get() → 2.5  (cold start)
```

### What is stored

A single number — the user's chosen boost level (1.0–5.0, step 0.1). That's it.

### What alternatives were considered and rejected

| Alternative | Problem |
|-------------|---------|
| Message passing only | On page load, the popup is not open — there's no sender to ask. Audio would play at 1× until the user opens the popup. |
| `localStorage` | The content script's isolated world and the popup are separate environments with different storage namespaces. They don't share `localStorage`. |
| No persistence | Boost resets to 1× on every new page or browser restart. Useless as a "booster." |

### Data safety

- `chrome.storage.sync` syncs only across the user's own browsers signed into the same account
- The stored value **never** leaves the browser or reaches any external server controlled by the extension developer
- No personal data, browsing history, or page content is ever stored

---

## `host_permissions` (`<all_urls>`)

**Declared in manifest:**
```json
"host_permissions": ["<all_urls>"]
```

### Why it's needed

The extension's core function — intercepting `<audio>` and `<video>` elements and routing them through a Web Audio gain graph — requires a **content script** to be injected into every page the user visits. In Manifest V3, content script injection requires explicit host permissions.

The extension must work on **any** site with media content, not only a predetermined list:

- Video streaming sites (YouTube, Vimeo, Bilibili, Netflix, etc.)
- Social media with embedded video (Twitter/X, Reddit, Instagram)
- Music players (Spotify Web Player, SoundCloud, Bandcamp)
- News sites with video articles
- Any page with embedded audio/video elements

There is no way to predict which sites the user will visit. The content script must be universally available.

### What the content script does

1. Finds all `<audio>` and `<video>` elements in the DOM
2. Creates a `MediaElementAudioSourceNode` + `GainNode` + `DynamicsCompressorNode` for each
3. Listens for boost level updates from the popup via `chrome.runtime.onMessage`

### What it does NOT do

- ❌ No reading of page text, DOM structure beyond media elements, or user input
- ❌ No network requests or data transmission
- ❌ No modification of page content or behavior beyond audio amplification
- ❌ No cookie access, no form data, no credentials
- ❌ No interaction with iframes or cross-origin content beyond the media element graph

### Scope limitation

The content script runs at `document_idle` with `all_frames: false` — it does not inject into iframes (most embedded players are excluded by default). The scope is strictly limited to the top-level document where audio/video playback typically occurs.

### What alternatives were considered and rejected

| Alternative | Problem |
|-------------|---------|
| `activeTab` permission | Only grants access when the user clicks the toolbar icon. Audio on a page would play at 1× until the user explicitly opens the extension — defeating the purpose of a persistent volume booster. |
| Site-specific host patterns (`*://*.youtube.com/*`, etc.) | Unknowable in advance — users visit arbitrary sites with media. Also breaks on any unlisted site. |
| No content script (via `tabCapture` API) | `tabCapture` requires all content audio to be rerouted through an offscreen document, adding complexity, latency, and the same broad permission surface. It also doesn't work for purely audio elements, only full tab capture. |

### Why `document_idle` injection timing

The script runs after the page is fully loaded, ensuring `document.body` exists for the `MutationObserver` and that media elements have had time to initialize. Initial `querySelectorAll` catches elements that loaded before injection, and the `MutationObserver` handles dynamically added elements afterwards — no page render is blocked.

---

## Summary

| Permission | Reason | Data risk |
|-----------|--------|-----------|
| `storage` | Persist a single user preference (boost level 1.0–5.0) across page loads and browser restarts | None — value stays within the browser's sync ecosystem |
| `<all_urls>` | Inject the content script into every page so media on any site can be boosted | None — the content script only accesses `<audio>`/`<video>` elements for Web Audio processing |

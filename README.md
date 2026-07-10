# Volume Booster — Chrome Extension

Boost audio volume beyond the browser's native 100% maximum using the Web Audio API.

## Design Goals

- **No server, no analytics, no permissions beyond what's needed.** Everything runs locally in the extension's isolated world.
- **Live updates.** Drag the slider — volume changes instantly. No page refresh required.
- **Survives SPAs.** MutationObserver catches dynamically injected `<audio>`/`<video>` elements.
- **Persistent.** Boost level is saved to `chrome.storage.sync` and restored across sessions.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Browser                          │
│                                                      │
│  ┌──────────────┐         ┌──────────────────────┐  │
│  │   Popup       │         │   Content Script      │  │
│  │  (popup.html  │◄─msg──►│  (content.js)          │  │
│  │   + popup.js) │         │                        │  │
│  │               │         │  ┌──────────────────┐  │  │
│  │  slider UI    │         │  │  AudioContext     │  │  │
│  │  chrome.      │         │  │  ├─ MediaElement  │  │  │
│  │  storage.sync │         │  │  │   SourceNode   │  │  │
│  └──────────────┘         │  │  ├─ GainNode      │  │  │
│                           │  │  └─ destination   │  │  │
│                           │  └──────────────────┘  │  │
│                           │                        │  │
│                           │  MutationObserver ──────┘  │
│                           │  chrome.storage.sync       │
│                           └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Components

| Layer | File | Role |
|-------|------|------|
| **Content Script** | `content.js` | Injected into every page. Finds media elements, wires them through a Web Audio gain graph, and listens for boost-level messages from the popup. |
| **Popup** | `popup.html` + `popup.js` | Action popup rendered when the user clicks the extension icon. Contains the boost slider. Saves to `chrome.storage.sync` and pushes live updates to the content script. |
| **Manifest** | `manifest.json` | Chrome Extension Manifest V3 — declares permissions (`storage`, `<all_urls>`), content script injection rules, and the popup entry point. |

### Data Flow

```
User drags slider
  → popup.js: update display + chrome.storage.sync.set({ boostLevel })
  → chrome.tabs.sendMessage({ type: 'setBoost', value })
  → content.js: gainNode.gain.value = value
  → AudioContext processes next audio frames at new level
```

---

## Audio Processing Pipeline

The browser's native `<audio>`/`<video>` volume is caped at `1.0` (100%). To boost beyond that, we bypass the native volume and route audio through the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API):

```
HTMLMediaElement (.volume = 1)
  → MediaElementAudioSourceNode
    → GainNode (gain = boostLevel, default 1.0, up to 5.0)
      → AudioContext.destination (speakers)
```

Each media element gets its own `{ source, gain }` pair, stored in a `WeakMap` so entries are garbage-collected when elements leave the DOM.

### Why this works

The `GainNode` supports values **above 1.0**, which amplifies the signal beyond what `element.volume` allows. By setting `element.volume = 1` (the native max), we ensure all attenuation/amplification is controlled by our `GainNode` — no confusing double-processing.

### When it doesn't work

`createMediaElementSource()` throws if the element is **already connected to another `AudioContext`** — for example, YouTube, Spotify, and many streaming sites create their own Web Audio graphs. In that case the element is skipped silently. Fixing this would require `tabCapture` or an `offscreen` document to re-capture the tab's audio, which is much heavier and requires additional permissions.

---

## Storage

- **Key:** `boostLevel` (number, 1.0–5.0, step 0.1)
- **API:** `chrome.storage.sync` — syncs across Chrome installs when the user is signed in.
- **Default:** `1.0` (no boost).

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **`WeakMap` for element tracking** | Elements removed from the DOM are automatically cleaned up — no manual teardown needed. |
| **`all_frames: false`** | Avoids duplicate AudioContext creation in iframes. Can be flipped to `true` if embedded players need boosting. |
| **MutationObserver (not polling)** | Catches dynamically injected elements efficiently with no CPU overhead when the DOM is static. |
| **Content script isolated world** | The AudioContext and gain graph live in the extension's world, not the page's JS — no conflict with page scripts. |
| **`document_idle` injection timing** | Balances catching early-loaded elements with not blocking page render. Elements loaded before injection are caught by the initial `querySelectorAll`. |
| **No icons bundled** | Minimalist approach — Chrome uses a default puzzle-piece icon. Add `icons/` if publishing to the Chrome Web Store. |

---

## Chrome Permissions

| Permission | Why |
|-----------|-----|
| `"storage"` | Persist the boost level across sessions via `chrome.storage.sync`. |
| `<all_urls>` | Inject the content script into every page so media on any site can be boosted. In MV3, host permissions are required for content script injection. |

---

## Edge Cases Handled

- **Autoplay policy:** AudioContext starts in `suspended` state. Resumed on the first page click (via a one-time `click` listener) and whenever the popup sends a message.
- **Elements without a source yet:** Listens for `loadedmetadata` on elements that have no `src`/`srcObject` at injection time.
- **SPA navigation:** MutationObserver picks up new elements added after dynamic page transitions.
- **Disconnected elements:** When an element leaves the DOM, the WeakMap entry is cleaned up on the next boost update (checked via `document.contains()`).
- **No `audio`/`video` on page:** Content script stays resident but idle — zero audio processing, zero CPU.

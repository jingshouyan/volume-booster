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
│  │  protection   │         │  │  ├─ MediaElement  │  │  │
│  │   toggle      │         │  │  │   SourceNode   │  │  │
│  │  chrome.      │         │  │  ├─ GainNode      │  │  │
│  │  storage.sync │         │  │  ├─ Dynamics      │  │  │
│  └──────────────┘         │  │  │   CompressorNode│  │  │
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
  → DynamicsCompressorNode (if enabled) tames peaks
  → AudioContext processes next audio frames at new level

User toggles Quality Protection
  → popup.js: chrome.storage.sync.set({ qualityProtection })
  → chrome.tabs.sendMessage({ type: 'setProtection', value })
  → content.js: compressor ratio → 1 (bypass) or 12 (limiting)
```

---

## Audio Processing Pipeline

The browser's native `<audio>`/`<video>` volume is caped at `1.0` (100%). To boost beyond that, we bypass the native volume and route audio through the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API):

```
HTMLMediaElement (.volume = 1)
  → MediaElementAudioSourceNode
    → GainNode (gain = boostLevel, 1.0–5.0)
      → DynamicsCompressorNode (limiter, enabled by default)
        → AudioContext.destination (speakers)
```

Each media element gets its own `{ source, gain, compressor }` triplet, stored in a `Map` — stale entries are cleaned up during iteration via `el.isConnected` check.

### Why this works

The `GainNode` supports values **above 1.0**, which amplifies the signal beyond what `element.volume` allows. By setting `element.volume = 1` (the native max), we ensure all attenuation/amplification is controlled by our `GainNode` — no confusing double-processing.

### Quality Protection (DynamicsCompressorNode)

Amplifying audio digitally risks **clipping** — when the waveform exceeds the digital maximum (0 dBFS), peaks are flat-topped, producing harsh distortion. A `DynamicsCompressorNode` configured as a limiter sits between the gain node and the destination:

| Parameter | Protection ON | Protection OFF |
|-----------|--------------|----------------|
| `threshold` | −6 dB | 0 dB |
| `ratio` | 12:1 | 1:1 (bypass) |
| `knee` | 6 dB | 0 dB |
| `attack` | 3 ms | 0 ms |
| `release` | 100 ms | 0 ms |

When enabled, the compressor gently reduces gain on peaks that approach 0 dBFS, turning a hard square-wave clip into a rounded, softer saturation. The effect is subtle at low boost levels (1–2×) and becomes a soft limiter at higher levels (3–5×), preserving perceived loudness without the brittle distortion of hard clipping.

When disabled, the compressor's ratio is set to **1:1** — a linear pass-through with no gain reduction. The audio graph topology never changes (no `disconnect()`/`reconnect()`), so there's zero risk of audio glitches when toggling.

### When it doesn't work

`createMediaElementSource()` throws if the element is **already connected to another `AudioContext`** — for example, YouTube, Spotify, and many streaming sites create their own Web Audio graphs. In that case the element is skipped silently. Fixing this would require `tabCapture` or an `offscreen` document to re-capture the tab's audio, which is much heavier and requires additional permissions.

---

## Storage

| Key | Type | Range | Default | Description |
|-----|------|-------|---------|-------------|
| `boostLevel` | number | 1.0–5.0, step 0.1 | 1.0 | Amplification multiplier |
| `qualityProtection` | boolean | — | `true` | Enable DynamicsCompressorNode limiter |

API: `chrome.storage.sync` — syncs across Chrome installs when the user is signed in.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **`Map` for element tracking + iteration** | `WeakMap` lacks an iterator, which crashes live slider updates. `Map` allows iteration over all connected elements to update gains and compressor params in one pass. Stale entries cleaned up via `el.isConnected` check on each update. |
| **`all_frames: false`** | Avoids duplicate AudioContext creation in iframes. Can be flipped to `true` if embedded players need boosting. |
| **MutationObserver (not polling)** | Catches dynamically injected elements efficiently with no CPU overhead when the DOM is static. |
| **Content script isolated world** | The AudioContext and gain graph live in the extension's world, not the page's JS — no conflict with page scripts. |
| **`document_idle` injection timing** | Balances catching early-loaded elements with not blocking page render. Elements loaded before injection are caught by the initial `querySelectorAll`. |
| **Circular icon with cyan badge** | Dark circle (`#1a1a2e`) with white speaker, cyan sound waves, and a cyan "+" badge in the top-right corner. The plus sign distinguishes it from a standard volume icon and communicates "booster." Source SVG in `icons/icon.svg`; PNGs at 16, 48, 128 generated via `sharp`. |

---

## Chrome Permissions

| Permission | Why |
|-----------|-----|
| `"storage"` | Persist the boost level across sessions via `chrome.storage.sync`. |
| `<all_urls>` | Inject the content script into every page so media on any site can be boosted. In MV3, host permissions are required for content script injection. |

---

## Quality Protection Compressor Parameters

The `DynamicsCompressorNode` is tuned to act as a **soft limiter** rather than an effect compressor. The goal is transparency at low boost levels and graceful peak-catching at high levels.

| Parameter | Value | Why |
|-----------|-------|-----|
| `threshold` | −6 dB | Only engages on peaks within 6 dB of clipping. Quiet content (dialogue, acoustic music) at 1–2× boost never triggers it. |
| `ratio` | 12:1 | Strong enough to catch peaks without sounding "squashed." A true brickwall limiter would use 20+:1, but 12:1 is gentler on music. |
| `knee` | 6 dB | Smooth onset — compression fades in gradually around the threshold instead of clicking on/off. |
| `attack` | 3 ms | Fast enough to catch transient peaks (snare hits, plosives) before they clip, but not instant (which can sound clicky on its own). |
| `release` | 100 ms | Quick recovery so the compressor resets between phrases. Long enough to avoid pumping artifacts. |

When protection is **off**, ratio = 1:1 and threshold = 0 dB — the compressor becomes a linear pass-through with no gain reduction and no rewiring.

---

## Edge Cases Handled

- **Autoplay policy:** AudioContext starts in `suspended` state. Resumed on the first page click (via a one-time `click` listener) and whenever the popup sends a message.
- **Elements without a source yet:** Listens for `loadedmetadata` on elements that have no `src`/`srcObject` at injection time.
- **SPA navigation:** MutationObserver picks up new elements added after dynamic page transitions.
- **Disconnected elements:** When an element leaves the DOM, the Map entry is cleaned up on the next boost/protection update (checked via `el.isConnected`).
- **No `audio`/`video` on page:** Content script stays resident but idle — zero audio processing, zero CPU.

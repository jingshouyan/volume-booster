# Publishing to Edge Add-ons

Edge Add-ons is Microsoft's extension store for the Edge browser. Chromium extensions work in Edge with little to no changes.

## Prerequisites

- A **Microsoft account** (outlook.com / live.com)
- A **developer registration** on [Partner Center](https://partner.microsoft.com) — one-time fee of roughly $0–$10 depending on your region (often free for individual developers)

## Step-by-step

### 1. Package the extension

The zip (`volume-booster-edge.zip`) is already created and contains:

```
manifest.json
content.js
popup.html
popup.js
icons/icon.svg
icons/icon16.png
icons/icon48.png
icons/icon128.png
```

If you modified the code and need to re-zip:

```
npm install --no-save adm-zip
node -e "
const AdmZip = require('adm-zip');
const zip = new AdmZip();
zip.addLocalFile('manifest.json');
zip.addLocalFile('content.js');
zip.addLocalFile('popup.html');
zip.addLocalFile('popup.js');
zip.addLocalFolder('icons', 'icons');
zip.writeZip('volume-booster-edge.zip');
"
```

### 2. Register as a developer

1. Go to [Partner Center](https://partner.microsoft.com) and sign in with your Microsoft account
2. Navigate to **Dashboard** → **Programs** → **Edge Extensions**
3. Accept the developer agreement
4. Fill in your publisher details (name, country/region)

> If you've already published under this account, skip straight to **Create a new extension**.

### 0. Host the privacy policy

`PRIVACY.md` in the repo serves as your privacy policy. The URL to enter in the submission form is:

```
https://github.com/jingshouyan/volume-booster/blob/main/PRIVACY.md
```

No need to set up a separate site — GitHub's raw file view is sufficient.

### 3. Submit the extension

1. In Partner Center, go to **Edge Extensions** → **Overview** → **Create new extension**
2. Upload `volume-booster-edge.zip`
3. Fill in the store listing:

| Field | Suggested content |
|-------|-------------------|
| **Name** | Volume Booster |
| **Description** | Boost audio volume beyond your browser's 100% maximum. A clean slider lets you go up to 5× with real-time feedback, and the built-in Quality Protection option prevents audio clipping. Works on any page with `<audio>` / `<video>` elements. |
| **Short description** (≤100 chars) | Boost audio volume up to 5× with quality protection |
| **Screenshot** (1–6, at least 1280×800) | Take a screenshot of the popup open over a video page (e.g., YouTube). Show the slider at 2.5× with Quality Protection toggled on. |
| **Small promotional tile** (440×280) | Can be a cropped version of the screenshot or the icon on a simple background |
| **Large promotional tile** (1400×560) | Required for store visibility — same as above at larger size |
| **Privacy policy URL** | `https://github.com/jingshouyan/volume-booster/blob/main/PRIVACY.md` — already in the repo, said it simply: no data collected. |
| **Website URL** | Your GitHub repo link: `https://github.com/jingshouyan/volume-booster` |
| **Support contact info** | Your email or GitHub issues URL |
| **Category** | Productivity → Tools |

4. **Privacy** section: Confirm the extension doesn't collect or transmit any user data (it doesn't — everything runs locally).
5. **Availability**: Choose regions and visibility. Start with **Public** to reach all Edge users.
6. Submit for review.

### 4. What reviewers check

Edge extension review typically takes **1–3 business days**. They verify:

- **No malicious code** — our extension has no network calls, no external scripts, no eval
- **No data exfiltration** — `chrome.storage.sync` is the only storage, and it's local to the browser sync ecosystem
- **Manifest completeness** — all referenced files exist in the zip
- **Functionality** — the extension does what it says

### 5. Post-review

- **Approved** → the extension goes live on [Edge Add-ons](https://microsoftedge.microsoft.com/addons) within a few hours
- **Rejected** → you'll get a reason. Common reasons: missing privacy policy, broken screenshots, manifest errors. Fix and resubmit.

---

## Notes

- **Edge accepts MV3** (Manifest V3) extensions. Our manifest is already V3.
- **No code changes needed** — Edge's extension API is identical to Chrome's for the APIs we use (`storage`, `runtime.onMessage`, `tabs.sendMessage`, `tabs.query`).
- **Updates** follow the same process: bump the `version` field in `manifest.json`, re-zip, and upload a new submission.



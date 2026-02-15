# Privacy Policy for Stream + Subtitle Catcher

**Last Updated:** February 15, 2026

## Overview

Stream + Subtitle Catcher ("the Extension") is a browser extension that helps users capture HLS/m3u8 stream URLs and subtitle files from web pages, along with their associated HTTP headers, to generate commands for external media players like mpv and IINA.

## Data Collection and Usage

### What Data is Collected

The Extension monitors network requests made by your browser to detect:
- HLS/m3u8 stream URLs
- Subtitle file URLs (VTT, SRT, ASS, etc.)
- HTTP request headers associated with these resources (including Referer, Origin, User-Agent, Cookie, Authorization)

### How Data is Stored

All captured data is stored **locally in your browser** using Chrome's `storage.local` API. Specifically:
- Stream and subtitle URLs
- HTTP headers
- File metadata (size, format, timestamp)

This data is:
- **Stored per-tab** and automatically deleted when you close the tab or navigate away
- **Never transmitted** to any external server
- **Never shared** with third parties
- **Only accessible** by the Extension itself

### How Data is Used

The captured data is used solely to:
1. Display detected streams and subtitles in the Extension popup
2. Generate mpv/IINA commands with proper HTTP headers for external playback
3. Allow you to copy URLs and commands to your clipboard

## Permissions Explanation

The Extension requires the following permissions:

### `host_permissions: ["https://*/*", "http://*/*"]`
**Why:** The Extension needs to monitor network requests across all websites to detect streams and subtitles, as streaming sites and their CDNs use diverse domains that cannot be predicted in advance.

**What it does:** Allows the Extension to observe HTTP requests and responses.

**What it does NOT do:** Does not modify web pages, inject ads, or track your browsing activity.

### `webRequest`
**Why:** Required to intercept network requests and capture HTTP headers before they are sent.

**What it does:** Monitors requests for media files (streams and subtitles) and stores their headers locally.

### `tabs`
**Why:** Required to manage captured data per browser tab and update the Extension badge counter.

**What it does:** Tracks which tab each captured item belongs to for proper organization and cleanup.

### `storage`
**Why:** Required to store captured URLs and headers locally in your browser.

**What it does:** Saves data to Chrome's local storage API (not synced across devices).

## Data Transmission

**The Extension does NOT:**
- Send any data to external servers
- Communicate with any backend services
- Track your browsing history
- Collect analytics or telemetry
- Share data with third parties
- Use cookies or tracking mechanisms

**The Extension is completely offline** except for the network requests made by the websites you visit (which it only observes, never initiates).

## Data Security

Since all data is stored locally in your browser:
- Data is protected by Chrome's built-in security mechanisms
- Data is automatically cleared when you close tabs or navigate away
- No data leaves your device

## User Control

You have full control over the Extension:
- **Clear data:** Use the "Clear all" button in the popup to delete all captured items for the current tab
- **Disable Extension:** Disable or remove the Extension at any time via `chrome://extensions/`
- **Inspect storage:** View stored data via Chrome DevTools → Application → Storage → Local Storage

## Third-Party Services

The Extension does not integrate with or send data to any third-party services.

## Children's Privacy

The Extension does not knowingly collect data from children under 13. The Extension is designed for technical users who need to capture streaming media URLs.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date at the top of this document.

## Contact

For questions or concerns about this privacy policy, please open an issue on the GitHub repository:
https://github.com/haliliceylan/subtitle-capture-ext

## Open Source

The Extension is open source. You can review the complete source code at:
https://github.com/haliliceylan/subtitle-capture-ext

---

**Summary:** Stream + Subtitle Catcher stores captured stream/subtitle URLs and headers locally in your browser. No data is transmitted externally. All data is automatically deleted when tabs close. The Extension is completely offline and privacy-focused.

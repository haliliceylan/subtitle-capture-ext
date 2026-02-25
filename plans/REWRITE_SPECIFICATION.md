# Stream + Subtitle Catcher - Complete Rewrite Specification

> **Purpose**: This document provides exhaustive code analysis with exact line numbers and code snippets. Any LLM should be able to implement the rewrite without hallucinating or guessing.

---

## Table of Contents

1. [Current Architecture Overview](#1-current-architecture-overview)
2. [Complete Function Inventory](#2-complete-function-inventory)
3. [Message Protocol Specification](#3-message-protocol-specification)
4. [Storage Schema](#4-storage-schema)
5. [Data Flow Analysis](#5-data-flow-analysis)
6. [Bug Patterns with Exact Locations](#6-bug-patterns-with-exact-locations)
7. [Rewrite Implementation Steps](#7-rewrite-implementation-steps)
8. [New Architecture Design](#8-new-architecture-design)

---

## 1. Current Architecture Overview

### 1.1 File Structure

```
subtitle-capture-ext/
├── manifest.json          # 45 lines - Extension configuration
├── service-worker.js      # 1149 lines - Background service worker
├── content-script.js      # 148 lines - Page context fetch proxy
├── popup.html             # ~1100 lines - UI with inline CSS
├── popup.js               # 1876 lines - Popup logic
└── img/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

### 1.2 Component Responsibilities

| Component | Lines | Responsibility |
|-----------|-------|----------------|
| [`service-worker.js`](service-worker.js) | 1-1149 | Request interception, storage, command building |
| [`content-script.js`](content-script.js) | 1-148 | Fetch proxy in page context |
| [`popup.js`](popup.js) | 1-1876 | UI rendering, selection, command generation |
| [`popup.html`](popup.html) | 1-1100 | UI structure and styling |

### 1.3 Manifest Configuration

**File**: [`manifest.json`](manifest.json)

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "109",
  "name": "Stream + Subtitle Catcher",
  "version": "1.0.0",
  "background": {
    "service_worker": "service-worker.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_start",
    "all_frames": true
  }],
  "permissions": [
    "tabs",
    "webRequest",
    "storage",
    "downloads",
    "scripting"
  ],
  "host_permissions": [
    "https://*/*",
    "http://*/*"
  ]
}
```

**Key Points**:
- Uses Manifest V3 with service worker (not background page)
- Content script runs at `document_start` in all frames
- `webRequest` API for intercepting network requests
- `scripting` permission for dynamic content script injection

---

## 2. Complete Function Inventory

### 2.1 Service Worker Functions ([`service-worker.js`](service-worker.js))

#### Constants (Lines 2-52)

```javascript
// Lines 2-15: Subtitle MIME type mapping
const SUBTITLE_MIME_MAP = {
  'text/vtt': 'vtt',
  'text/webvtt': 'vtt',
  'application/x-subrip': 'srt',
  'text/x-ssa': 'ass',
  'text/x-ass': 'ass',
  'application/ttml+xml': 'ttml',
  'application/ttaf+xml': 'ttml',
  'text/ttml': 'ttml',
  'application/xml': null,  // null = needs extension check
  'text/xml': null,
  'text/plain': null,
  'application/octet-stream': null,
};

// Line 17: Subtitle file extensions
const SUBTITLE_EXTENSIONS = new Set(['vtt', 'srt', 'ass', 'ssa', 'sub', 'ttml', 'dfxp', 'sbv', 'stl', 'lrc', 'smi']);

// Lines 19-23: Video MIME types
const VIDEO_MIME_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/x-matroska', 'video/avi', 'video/quicktime',
  'video/x-flv', 'video/x-ms-wmv', 'video/3gpp', 'video/ogg', 'video/mpeg'
]);

// Lines 25-26: HLS types
const HLS_EXTENSIONS = new Set(['m3u8', 'm3u']);
const HLS_MIME_TYPES = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl']);

// Lines 28-32: DASH types
const DASH_EXTENSIONS = new Set(['mpd']);
const DASH_MIME_TYPES = new Set([
  'application/dash+xml',
  'application/vnd.mpeg.dash.mpd'
]);

// Lines 34-37: Headers to strip from commands
const STRIP_HEADERS = new Set([
  'range', 'content-length', 'content-type', 'accept-encoding',
  'upgrade-insecure-requests', 'cache-control', 'pragma'
]);

// Lines 43-47: Forbidden headers (browser-controlled)
const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);

// Lines 49-52: Magic number constants
const MAX_ITEMS_PER_TAB = 50;
const FETCH_TIMEOUT_MS = 5000;
const M3U8_FETCH_TIMEOUT_MS = 10000;
```

#### State Variables (Lines 54-57)

```javascript
// Line 54: In-memory request header storage
const pendingReqHeaders = {};

// Line 57: Queue for preventing storage race conditions
const saveQueue = {};
```

#### Core Functions

##### `queuedSave()` - Lines 58-85

**Purpose**: Prevents race conditions when saving to storage by chaining promises per-key.

```javascript
async function queuedSave(key, requestId, itemData, url) {
  // Create queue for this key if it doesn't exist
  if (!saveQueue[key]) {
    saveQueue[key] = Promise.resolve();
  }

  // Chain this save operation
  saveQueue[key] = saveQueue[key].then(async () => {
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};

    // Check for duplicates inside the queue to prevent race conditions
    if (url && Object.values(items).some((item) => item.url === url)) {
      return null; // Duplicate found, skip saving
    }

    // Check for max items limit
    if (Object.keys(items).length >= MAX_ITEMS_PER_TAB) {
      return null; // Max items reached, skip saving
    }

    items[requestId] = itemData;
    await chrome.storage.local.set({ [key]: items });
    return items;
  });

  return saveQueue[key];
}
```

**Issues**:
- Queue is per-key but `pendingReqHeaders` is global (race condition possible)
- No error handling in queue chain
- No timeout for queue operations

##### `urlExtension()` - Lines 87-96

```javascript
function urlExtension(url) {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('.');
    if (parts.length < 2) return null;
    return parts[parts.length - 1].toLowerCase().split('/')[0];
  } catch {
    return null;
  }
}
```

##### `deriveFilename()` - Lines 98-111

```javascript
function deriveFilename(url, responseHeaders, fallback = 'media') {
  for (const h of responseHeaders) {
    if (h.name.toLowerCase() === 'content-disposition') {
      const match = h.value.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\r\n]+)/i);
      if (match) return decodeURIComponent(match[1].trim().replace(/['"]/g, ''));
    }
  }
  try {
    const { pathname } = new URL(url);
    const seg = pathname.split('/').pop();
    if (seg) return seg;
  } catch {}
  return fallback;
}
```

##### `getHeaderValue()` - Lines 113-121

```javascript
function getHeaderValue(responseHeaders, name) {
  const target = name.toLowerCase();
  for (const h of responseHeaders) {
    if (h.name.toLowerCase() === target) {
      return (h.value || '').split(';')[0].trim().toLowerCase();
    }
  }
  return '';
}
```

##### `headersArrayToObject()` - Lines 124-132

```javascript
function headersArrayToObject(reqHeaders) {
  const headers = {};
  for (const h of reqHeaders) {
    const k = h.name || '';
    if (!k) continue;
    headers[k] = h.value || '';
  }
  return headers;
}
```

##### `sanitizeHeaders()` - Lines 135-147

**CRITICAL**: This function is duplicated in content-script.js with different logic!

```javascript
// service-worker.js version
function sanitizeHeaders(reqHeaders) {
  const headers = {};
  for (const h of reqHeaders) {
    const k = h.name || '';
    if (!k) continue;
    // Skip both STRIP_HEADERS and FORBIDDEN_HEADERS
    const lowerK = k.toLowerCase();
    if (!STRIP_HEADERS.has(lowerK) && !FORBIDDEN_HEADERS.has(lowerK)) {
      headers[k] = h.value || '';
    }
  }
  return headers;
}
```

##### `getSafeHeadersForContentScript()` - Lines 150-160

```javascript
function getSafeHeadersForContentScript(fullHeaders) {
  const safeHeaders = {};
  for (const [k, v] of Object.entries(fullHeaders || {})) {
    if (!k) continue;
    const lowerK = k.toLowerCase();
    if (!STRIP_HEADERS.has(lowerK) && !FORBIDDEN_HEADERS.has(lowerK)) {
      safeHeaders[k] = v;
    }
  }
  return safeHeaders;
}
```

##### `resolveUrl()` - Lines 163-169

```javascript
function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
}
```

##### `formatBitrate()` - Lines 172-180

```javascript
function formatBitrate(bps) {
  if (!bps || bps <= 0) return null;
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(1)}Mbps`;
  } else if (bps >= 1000) {
    return `${Math.round(bps / 1000)}Kbps`;
  }
  return `${bps}bps`;
}
```

##### `formatSize()` - Lines 183-194

```javascript
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  } else {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
}
```

##### `formatDuration()` - Lines 197-217

```javascript
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h`;
  }
  if (minutes > 0) {
    if (secs > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${minutes}m`;
  }
  return `${secs}s`;
}
```

##### `ensureContentScriptReady()` - Lines 220-255

**CRITICAL**: This function has a race condition bug!

```javascript
async function ensureContentScriptReady(tabId) {
  try {
    // Try to ping the content script
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.success) {
      return true;
    }
  } catch (error) {
    // Content script not ready, will inject
  }

  // Content script not ready, inject it
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    });

    // Wait briefly for injection to complete
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify it's now ready
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (response && response.success) {
        return true;
      }
    } catch (verifyError) {
      console.warn('Content script injection verification failed:', verifyError.message);
    }
  } catch (injectError) {
    console.warn('Failed to inject content script:', injectError.message);
  }

  return false;
}
```

**Issues**:
- No caching of ready state - called multiple times per request
- 200ms fixed delay is arbitrary and may not be enough
- No handling for special pages (chrome://, about:, etc.)

##### `delay()` - Lines 258-260

```javascript
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

##### `getMediaPlaylistDuration()` - Lines 263-325

```javascript
async function getMediaPlaylistDuration(mediaUrl, tabId, headers = {}, retries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 200ms, 400ms, 600ms
      const backoffMs = 200 * attempt;
      await delay(backoffMs);
    }

    try {
      // Ensure content script is ready before each attempt
      const isReady = await ensureContentScriptReady(tabId);
      if (!isReady) {
        lastError = new Error('Content script not ready');
        continue;
      }

      const safeHeaders = getSafeHeadersForContentScript(headers);
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'fetchMediaPlaylist',
        url: mediaUrl,
        headers: safeHeaders
      });

      if (!response || !response.success) {
        lastError = new Error(response?.error || 'Unknown error');
        continue;
      }

      const content = response.content;
      const lines = content.split('\n').map(l => l.trim()).filter(l => l);

      let totalDuration = 0;

      for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
          const durationMatch = line.match(/#EXTINF:([\d.]+)/);
          if (durationMatch) {
            totalDuration += parseFloat(durationMatch[1]);
          }
        }
      }

      return totalDuration > 0 ? totalDuration : null;
    } catch (error) {
      lastError = error;
    }
  }

  console.warn('Failed to get media playlist duration after', retries, 'attempts:', lastError?.message);
  return null;
}
```

##### `parseCodec()` - Lines 328-344

```javascript
function parseCodec(codecsString) {
  if (!codecsString) return null;

  const codecs = codecsString.split(',').map(c => c.trim().toLowerCase());

  for (const codec of codecs) {
    if (codec.includes('hvc1') || codec.includes('hev1') || codec.includes('hevc')) return 'H265';
    if (codec.includes('avc1') || codec.includes('avc3')) return 'H264';
    if (codec.includes('vp9') || codec.includes('vp09')) return 'VP9';
    if (codec.includes('av01')) return 'AV1';
    if (codec.includes('mp4a')) return 'AAC';
    if (codec.includes('opus')) return 'Opus';
    if (codec.includes('mp3') || codec.includes('mp4a.40.34')) return 'MP3';
  }

  return null;
}
```

##### `parseAudioCodec()` - Lines 347-363

```javascript
function parseAudioCodec(codecsString) {
  if (!codecsString) return null;

  const codecs = codecsString.split(',').map(c => c.trim().toLowerCase());

  for (const codec of codecs) {
    if (codec.includes('mp4a')) return 'AAC';
    if (codec.includes('opus')) return 'Opus';
    if (codec.includes('mp3') || codec.includes('mp4a.40.34')) return 'MP3';
    if (codec.includes('ac-3') || codec.includes('ac3')) return 'AC3';
    if (codec.includes('ec-3') || codec.includes('ec3') || codec.includes('eac3')) return 'EAC3';
    if (codec.includes('flac')) return 'FLAC';
    if (codec.includes('dts')) return 'DTS';
  }

  return null;
}
```

##### `parseAudioGroups()` - Lines 366-391

```javascript
function parseAudioGroups(lines) {
  const audioGroups = new Map(); // group-id -> array of audio tracks

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const typeMatch = line.match(/TYPE=([^,\s]+)/);
      if (!typeMatch || typeMatch[1] !== 'AUDIO') continue;

      const groupIdMatch = line.match(/GROUP-ID="([^"]+)"/);
      const languageMatch = line.match(/LANGUAGE="([^"]+)"/);
      const nameMatch = line.match(/NAME="([^"]+)"/);

      if (groupIdMatch) {
        const groupId = groupIdMatch[1];
        const language = languageMatch ? languageMatch[1] : (nameMatch ? nameMatch[1] : 'unknown');

        if (!audioGroups.has(groupId)) {
          audioGroups.set(groupId, []);
        }
        audioGroups.get(groupId).push(language);
      }
    }
  }

  return audioGroups;
}
```

##### `deriveVariantName()` - Lines 394-402

```javascript
function deriveVariantName(variant) {
  const parts = [];
  if (variant.resolution) parts.push(variant.resolution);
  if (variant.codec && variant.codec !== 'AAC' && variant.codec !== 'Opus') parts.push(variant.codec);
  if (variant.bitrate) parts.push(variant.bitrate);
  
  if (parts.length === 0) return 'Default';
  return parts.join(' · ');
}
```

##### `enrichHlsItemWithDuration()` - Lines 405-438

```javascript
async function enrichHlsItemWithDuration(itemData, playlistInfo, tabId) {
  if (!playlistInfo.isMasterPlaylist || playlistInfo.variants.length === 0) {
    return itemData;
  }

  itemData.isMasterPlaylist = true;
  itemData.variants = playlistInfo.variants;
  itemData.name = itemData.name.replace(/\.m3u8$/i, '') + ' (Master)';

  // Fetch duration from the first variant (highest quality, already sorted by bandwidth)
  const firstVariant = playlistInfo.variants[0];
  if (firstVariant && firstVariant.url) {
    try {
      const duration = await getMediaPlaylistDuration(firstVariant.url, tabId, itemData.headers);
      if (duration) {
        itemData.duration = duration;
        itemData.durationFormatted = formatDuration(duration);

        // Calculate estimated size for each variant
        itemData.variants = playlistInfo.variants.map(variant => ({
          ...variant,
          ...(variant.bandwidth && duration && {
            estimatedSize: (duration * variant.bandwidth) / 8,
            estimatedSizeFormatted: formatSize((duration * variant.bandwidth) / 8)
          })
        }));
      }
    } catch (durationError) {
      console.warn('Failed to fetch duration for HLS stream:', durationError);
    }
  }

  return itemData;
}
```

##### `parseHLSMasterPlaylistContent()` - Lines 441-541

```javascript
function parseHLSMasterPlaylistContent(url, content) {
  try {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);

    // Check if this is a master playlist
    if (!lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
      // Not a master playlist (might be a media playlist)
      return { isMasterPlaylist: false, variants: [] };
    }

    // Parse audio groups first (before processing variants)
    const audioGroups = parseAudioGroups(lines);

    const variants = [];
    let currentVariant = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-STREAM-INF')) {
        // Parse variant attributes
        currentVariant = {
          bandwidth: null,
          resolution: null,
          codecs: null,
          frameRate: null,
          audio: null,
          video: null,
          url: null
        };

        // Extract BANDWIDTH
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bandwidthMatch) {
          currentVariant.bandwidth = parseInt(bandwidthMatch[1], 10);
        }

        // Extract RESOLUTION
        const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
        if (resolutionMatch) {
          const height = parseInt(resolutionMatch[2], 10);
          currentVariant.resolution = `${height}p`;
        }

        // Extract CODECS
        const codecsMatch = line.match(/CODECS="([^"]+)"/);
        if (codecsMatch) {
          currentVariant.codecs = codecsMatch[1];
        }

        // Extract FRAME-RATE
        const frameRateMatch = line.match(/FRAME-RATE=([\d.]+)/);
        if (frameRateMatch) {
          currentVariant.frameRate = parseFloat(frameRateMatch[1]);
        }

        // Extract AUDIO group
        const audioMatch = line.match(/AUDIO="([^"]+)"/);
        if (audioMatch) {
          currentVariant.audio = audioMatch[1];
        }

        // Extract VIDEO group
        const videoMatch = line.match(/VIDEO="([^"]+)"/);
        if (videoMatch) {
          currentVariant.video = videoMatch[1];
        }
      } else if (currentVariant && !line.startsWith('#') && line.length > 0) {
        // This is the URL line for the current variant
        currentVariant.url = resolveUrl(url, line);

        // Process variant data
        const variant = {
          url: currentVariant.url,
          bandwidth: currentVariant.bandwidth,
          bitrate: formatBitrate(currentVariant.bandwidth),
          resolution: currentVariant.resolution,
          codec: parseCodec(currentVariant.codecs),
          audioCodec: parseAudioCodec(currentVariant.codecs),
          codecs: currentVariant.codecs,
          frameRate: currentVariant.frameRate,
          audioLanguages: currentVariant.audio && audioGroups.has(currentVariant.audio)
            ? audioGroups.get(currentVariant.audio)
            : []
        };

        variant.name = deriveVariantName(variant);
        variants.push(variant);
        currentVariant = null;
      }
    }

    return {
      isMasterPlaylist: true,
      variants: variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
    };
  } catch (error) {
    console.warn('Failed to parse HLS master playlist content:', error);
    return { isMasterPlaylist: false, variants: [], error: error.message };
  }
}
```

##### `parseHLSMasterPlaylist()` - Lines 544-582

```javascript
async function parseHLSMasterPlaylist(url, headers = {}) {
  try {
    const fetchHeaders = new Headers();
    Object.entries(headers).forEach(([k, v]) => {
      if (k && v !== undefined) {
        if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) {
          try {
            fetchHeaders.set(k, v);
          } catch (e) {
            console.warn('[ServiceWorker] Skipping header that cannot be set:', k);
          }
        }
      }
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: fetchHeaders,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      referrer: headers.Referer || headers.referer || '',
      referrerPolicy: 'no-referrer-when-downgrade'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const content = await response.text();
    return parseHLSMasterPlaylistContent(url, content);
  } catch (error) {
    console.warn('Failed to parse HLS master playlist:', error);
    return { isMasterPlaylist: false, variants: [], error: error.message };
  }
}
```

##### `extractMediaMetadata()` - Lines 584-632

```javascript
function extractMediaMetadata(url, responseHeaders, format, size, mediaType) {
  const metadata = {};
  
  // Extract resolution from URL patterns (common in CDN URLs)
  const resolutionMatch = url.match(/(\d{3,4})[px_-]?(\d{3,4})?[px]?/i) || 
                         url.match(/(360|480|720|1080|1440|2160|4320)p?/i);
  if (resolutionMatch) {
    const height = parseInt(resolutionMatch[1]);
    if (height >= 360 && height <= 4320) {
      metadata.resolution = `${height}p`;
      if (height >= 2160) metadata.quality = '4K';
      else if (height >= 1080) metadata.quality = 'FHD';
      else if (height >= 720) metadata.quality = 'HD';
      else metadata.quality = 'SD';
    }
  }
  
  // Extract codec hints from URL
  const codecMatch = url.match(/(h264|h265|hevc|vp9|av1|avc1|aac|opus|mp3)/i);
  if (codecMatch) {
    metadata.codec = codecMatch[1].toUpperCase();
  }
  
  // Extract bitrate/bandwidth from URL
  const bitrateMatch = url.match(/(\d+)[km]?bps/i) || url.match(/bandwidth[=_](\d+)/i);
  if (bitrateMatch) {
    const bps = parseInt(bitrateMatch[1]);
    if (bps > 1000) {
      metadata.bitrate = `${Math.round(bps / 1000)}Mbps`;
    } else {
      metadata.bitrate = `${bps}Kbps`;
    }
  }
  
  // Estimate quality from file size (for non-HLS videos)
  if (mediaType === 'video' && size > 0) {
    const sizeMB = size / (1024 * 1024);
    if (sizeMB > 500) metadata.estimatedQuality = 'High';
    else if (sizeMB > 100) metadata.estimatedQuality = 'Medium';
    else metadata.estimatedQuality = 'Low';
  }
  
  // Check for HDR indicators
  if (url.match(/hdr|dolby|vision|hlg/i)) {
    metadata.hdr = true;
  }
  
  return metadata;
}
```

##### `shellEscapeSingle()` - Lines 634-636

```javascript
function shellEscapeSingle(value) {
  return String(value).replace(/'/g, `'\\''`);
}
```

##### `normalizeFilename()` - Lines 638-646

```javascript
function normalizeFilename(title) {
  if (!title || !title.trim()) return 'output';
  return title
    .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim()
    .replace(/\.$/, '')             // Remove trailing period
    .substring(0, 100);             // Limit length
}
```

##### `buildMpvHeaderOption()` - Lines 648-655

```javascript
function buildMpvHeaderOption(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '';
  // Format headers as comma-separated quoted strings
  // Format: --http-header-fields='Header1: value1','Header2: value2'
  const quotedHeaders = entries.map(([k, v]) => `'${shellEscapeSingle(k)}: ${shellEscapeSingle(v)}'`).join(',');
  return `--http-header-fields=${quotedHeaders}`;
}
```

##### `buildMpvCommand()` - Lines 657-698

```javascript
function buildMpvCommand(streamItem, subtitleItems = []) {
  const streamUrl = streamItem?.url;
  if (!streamUrl) return '';

  const headers = streamItem.headers || {};

  // Extract user-agent if present
  const userAgent = headers['User-Agent'] || headers['user-agent'];
  const otherHeaders = { ...headers };
  delete otherHeaders['User-Agent'];
  delete otherHeaders['user-agent'];

  // Build header option for stream (using demuxer-lavf-o format)
  const headerOpt = buildMpvHeaderOption(otherHeaders);

  // Build user-agent option
  const userAgentOpt = userAgent ? `  --user-agent='${shellEscapeSingle(userAgent)}' \\\n` : '';

  // Build subtitle options - each subtitle gets its own --sub-file flag
  const subOpts = subtitleItems
    .filter((s) => s?.url)
    .map((s) => {
      return `  --sub-file='${shellEscapeSingle(s.url)}' \\\n`;
    })
    .join('');

  // Build the command with proper line continuation
  const parts = [
    'mpv \\\n',
    `  --force-window=immediate \\\n`,
    `  --sub-auto=fuzzy \\\n`,
    `  --demuxer-lavf-o=allowed_extensions=ALL \\\n`,
    subOpts,
    userAgentOpt,
    headerOpt ? `  ${headerOpt} \\\n` : '',
    `  '${shellEscapeSingle(streamUrl)}' \\\n`,
    `  --msg-level=ffmpeg=trace,demuxer=trace,network=trace \\\n`,
    `  --log-file=mpv-trace.log`
  ];

  return parts.filter(Boolean).join('');
}
```

##### `buildFfmpegHeaders()` - Lines 700-706

```javascript
function buildFfmpegHeaders(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '';
  // Format: 'Header1: value1\r\nHeader2: value2\r\n'
  const joined = entries.map(([k, v]) => `${k}: ${v}`).join('\r\n');
  return `-headers '${shellEscapeSingle(joined + '\r\n')}'`;
}
```

##### `LANGUAGE_CODE_MAP` - Lines 709-727

```javascript
const LANGUAGE_CODE_MAP = {
  'en': 'eng', 'es': 'spa', 'fr': 'fre', 'de': 'ger', 'it': 'ita',
  'pt': 'por', 'ru': 'rus', 'ja': 'jpn', 'ko': 'kor', 'zh': 'chi',
  'ar': 'ara', 'hi': 'hin', 'tr': 'tur', 'pl': 'pol', 'nl': 'dut',
  'sv': 'swe', 'da': 'dan', 'no': 'nor', 'fi': 'fin', 'el': 'gre',
  'he': 'heb', 'th': 'tha', 'vi': 'vie', 'id': 'ind', 'ms': 'may',
  'cs': 'cze', 'sk': 'slo', 'hu': 'hun', 'ro': 'rum', 'bg': 'bul',
  'uk': 'ukr', 'hr': 'hrv', 'sr': 'srp', 'sl': 'slv', 'et': 'est',
  'lv': 'lav', 'lt': 'lit', 'fa': 'per', 'ur': 'urd', 'bn': 'ben',
  'ta': 'tam', 'te': 'tel', 'ml': 'mal', 'kn': 'kan', 'mr': 'mar',
  'gu': 'guj', 'pa': 'pan', 'sw': 'swa', 'af': 'afr', 'ca': 'cat',
  'eu': 'eus', 'gl': 'glg', 'hy': 'hye', 'ka': 'kat', 'mn': 'mon',
  'ne': 'nep', 'si': 'sin', 'km': 'khm', 'lo': 'lao', 'my': 'mya',
  'am': 'amh', 'zu': 'zul', 'xh': 'xho', 'yo': 'yor', 'ig': 'ibo',
  'ha': 'hau', 'tl': 'tgl', 'jv': 'jav', 'su': 'sun', 'mg': 'mlg',
  'nb': 'nob', 'nn': 'nno', 'zh-cn': 'chi', 'zh-tw': 'chi',
  'pt-br': 'por', 'pt-pt': 'por', 'es-419': 'spa', 'en-gb': 'eng',
  'en-us': 'eng'
};
```

##### `getFfmpegLanguageCode()` - Lines 729-733

```javascript
function getFfmpegLanguageCode(langCode) {
  if (!langCode) return null;
  const normalized = langCode.toLowerCase();
  return LANGUAGE_CODE_MAP[normalized] || LANGUAGE_CODE_MAP[normalized.split('-')[0]] || normalized;
}
```

##### `buildFfmpegCommand()` - Lines 735-827

```javascript
function buildFfmpegCommand(streamItem, subtitleItems = [], outputFormat = 'mp4', outputFilename = null) {
  const streamUrl = streamItem?.url;
  if (!streamUrl) return '';

  // Validate output format
  const format = outputFormat === 'mkv' ? 'mkv' : 'mp4';

  // Normalize and use provided filename or default to 'output'
  const baseFilename = normalizeFilename(outputFilename) || 'output';
  const finalFilename = `${baseFilename}.${format}`;

  // Build header option for stream
  const headerOpt = buildFfmpegHeaders(streamItem.headers || {});

  // Filter valid subtitle items
  const validSubtitles = subtitleItems.filter((s) => s?.url);

  // Build command parts
  const parts = ['ffmpeg'];

  // Add logging and stats flags
  parts.push('-loglevel error');
  parts.push('-stats');

  // Add headers (applies to all inputs)
  if (headerOpt) {
    parts.push(headerOpt);
  }

  // Add main stream input
  parts.push(`-i '${shellEscapeSingle(streamUrl)}'`);

  // Add subtitle inputs
  validSubtitles.forEach((sub) => {
    parts.push(`-i '${shellEscapeSingle(sub.url)}'`);
  });

  // Map streams based on output format
  if (format === 'mkv') {
    // For MKV: explicitly map only video and audio streams to avoid data streams
    // that MKV doesn't support (e.g., timed metadata, ID3, etc.)
    parts.push('-map 0:v');  // Map video streams from main input
    parts.push('-map 0:a');  // Map audio streams from main input
    validSubtitles.forEach((_, index) => {
      parts.push(`-map ${index + 1}`);  // Map each subtitle input
    });
  } else {
    // For MP4: map all streams from video input
    parts.push('-map 0');
    validSubtitles.forEach((_, index) => {
      parts.push(`-map ${index + 1}`);  // Map each subtitle input
    });
  }

  // Add output options
  parts.push('-c copy');

  // If we have subtitles, configure subtitle codec based on output format
  if (validSubtitles.length > 0) {
    if (format === 'mkv') {
      // MKV supports various subtitle formats; use 'ass' for wide compatibility
      // WebVTT cannot be directly muxed as 'srt', so we use 'ass' which MKV supports well
      parts.push('-c:s ass');
    } else {
      // MP4 requires mov_text for subtitle compatibility
      parts.push('-c:s mov_text');
    }
  }

  // Add subtitle metadata (language and title) for each subtitle stream
  validSubtitles.forEach((sub, index) => {
    const langCode = sub.languageCode || sub.langCode;
    const langName = sub.languageName || sub.langName;
    
    if (langCode) {
      const ffmpegLangCode = getFfmpegLanguageCode(langCode);
      parts.push(`-metadata:s:s:${index} language=${shellEscapeSingle(ffmpegLangCode)}`);
    }
    
    if (langName) {
      parts.push(`-metadata:s:s:${index} title='${shellEscapeSingle(langName)}'`);
    } else if (langCode) {
      // Use language code as title if no name provided
      const ffmpegLangCode = getFfmpegLanguageCode(langCode);
      parts.push(`-metadata:s:s:${index} title='${shellEscapeSingle(ffmpegLangCode.toUpperCase())}'`);
    }
  });

  // Output filename
  parts.push(`'${shellEscapeSingle(finalFilename)}'`);

  return parts.filter(Boolean).join(' ');
}
```

##### `downloadVideo()` - Lines 829-852

```javascript
async function downloadVideo(url, filename, headers = {}) {
  // Build headers array for chrome.downloads API
  // Filter out forbidden headers that chrome.downloads can't handle
  const headerArray = [];
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!FORBIDDEN_HEADERS.has(lowerName)) {
      headerArray.push({ name, value });
    }
  }

  const downloadOptions = {
    url: url,
    filename: filename || 'video.mp4',
    saveAs: false
  };

  // Add headers if present
  if (headerArray.length > 0) {
    downloadOptions.headers = headerArray;
  }

  return chrome.downloads.download(downloadOptions);
}
```

##### `downloadSubtitle()` - Lines 854-894

```javascript
async function downloadSubtitle(url, filename, headers = {}) {
  console.log('[ServiceWorker] downloadSubtitle called');
  console.log('[ServiceWorker] URL:', url);
  console.log('[ServiceWorker] Raw headers:', JSON.stringify(headers, null, 2));

  // Build headers array for chrome.downloads API
  // Filter out forbidden headers that chrome.downloads can't handle
  const headerArray = [];
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!FORBIDDEN_HEADERS.has(lowerName)) {
      headerArray.push({ name, value });
      console.log('[ServiceWorker] Adding header to download:', name);
    } else {
      console.log('[ServiceWorker] Skipping forbidden header:', name);
    }
  }

  const downloadOptions = {
    url: url,
    filename: filename || 'subtitle.vtt',
    saveAs: false
  };

  // Add headers if present
  if (headerArray.length > 0) {
    downloadOptions.headers = headerArray;
    console.log('[ServiceWorker] Download options with headers:', JSON.stringify(downloadOptions, null, 2));
  } else {
    console.log('[ServiceWorker] Download options without headers');
  }

  try {
    const downloadId = await chrome.downloads.download(downloadOptions);
    console.log('[ServiceWorker] Download started with ID:', downloadId);
    return downloadId;
  } catch (error) {
    console.error('[ServiceWorker] Download failed:', error.message);
    throw error;
  }
}
```

##### `updateBadge()` - Lines 896-909

```javascript
async function updateBadge(tabId) {
  const streamKey = `streams_${tabId}`;
  const subKey = `subs_${tabId}`;
  const data = await chrome.storage.local.get([streamKey, subKey]);
  const streams = data[streamKey] || {};
  const subs = data[subKey] || {};
  const count = Object.keys(streams).length + Object.keys(subs).length;
  const text = count > 0 ? String(count) : '';
  try {
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#0077FF', tabId });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
  } catch {}
}
```

#### Event Listeners

##### Keep-Alive Interval - Lines 911-920

```javascript
// Keep service worker alive by pinging every 20 seconds
// This prevents it from sleeping and missing webRequest events
let keepAliveInterval = setInterval(() => {
  // Keep-alive ping
}, 20000);

// Clean up interval when service worker terminates
self.addEventListener('beforeunload', () => {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
});
```

##### `onBeforeSendHeaders` Listener - Lines 922-929

```javascript
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Store headers for response handler
    pendingReqHeaders[details.requestId] = details.requestHeaders || [];
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
  ['requestHeaders', 'extraHeaders']
);
```

**CRITICAL BUG**: Headers are stored but never cleaned up if response never comes!

##### `onResponseStarted` Listener - Lines 931-1082

**This is the main capture logic - 150+ lines!**

```javascript
chrome.webRequest.onResponseStarted.addListener(
  async (details) => {
    const { requestId, url, tabId, responseHeaders = [], statusCode, method } = details;
    const reqHeaders = pendingReqHeaders[requestId] || [];
    delete pendingReqHeaders[requestId];  // BUG: Deleted immediately!

    if (!url.startsWith('http') || tabId < 0) return;
    if (statusCode < 200 || statusCode >= 300) return;
    if (method === 'POST') return;

    const contentType = getHeaderValue(responseHeaders, 'content-type');
    const ext = urlExtension(url);

    let kind = null;
    let format = null;
    let mediaType = null;

    // 1. Check for HLS streams
    if (HLS_MIME_TYPES.has(contentType) || (ext && HLS_EXTENSIONS.has(ext))) {
      kind = 'stream';
      format = 'm3u8';
      mediaType = 'hls';
    }
    // 2. Check for DASH streams
    else if (DASH_MIME_TYPES.has(contentType) || (ext && DASH_EXTENSIONS.has(ext))) {
      kind = 'stream';
      format = 'mpd';
      mediaType = 'dash';
    }
    // 3. Check for video files (MP4, WebM, etc.)
    else if (VIDEO_MIME_TYPES.has(contentType) || (ext && VIDEO_EXTENSIONS.has(ext))) {
      kind = 'stream';
      format = ext || contentType.split('/')[1] || 'video';
      mediaType = 'video';
    }
    // 4. Check for subtitles
    else if (contentType in SUBTITLE_MIME_MAP) {
      const mapped = SUBTITLE_MIME_MAP[contentType];
      if (mapped === null) {
        if (ext && SUBTITLE_EXTENSIONS.has(ext)) {
          kind = 'subtitle';
          format = ext;
        }
      } else {
        kind = 'subtitle';
        format = mapped;
      }
    } else if (ext && SUBTITLE_EXTENSIONS.has(ext)) {
      kind = 'subtitle';
      format = ext;
    }

    if (!kind || !format) return;

    let size = 0;
    for (const h of responseHeaders) {
      if (h.name.toLowerCase() === 'content-length') {
        size = parseInt(h.value) || 0;
        break;
      }
    }

    // Store full headers (for MPV/ffmpeg commands) and sanitized headers (for content script)
    const fullHeaders = headersArrayToObject(reqHeaders);
    const sanitizedHeaders = sanitizeHeaders(reqHeaders);
    const timestamp = Date.now();
    const name = deriveFilename(url, responseHeaders, kind === 'stream' ? 'stream.m3u8' : 'subtitle');
    const key = kind === 'stream' ? `streams_${tabId}` : `subs_${tabId}`;

    // Early-exit optimization: Check for duplicates and limits before expensive operations
    // Note: The actual duplicate check inside queuedSave is the authoritative check
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};

    if (Object.values(items).some((item) => item.url === url)) {
      return;
    }
    if (Object.keys(items).length >= MAX_ITEMS_PER_TAB) {
      return;
    }

    // Extract metadata from URL and headers
    const metadata = extractMediaMetadata(url, responseHeaders, format, size, mediaType);

    const itemData = {
      url, format, name, size, headers: fullHeaders, tabId, timestamp, kind,
      mediaType,
      ...metadata
    };
    
    // For HLS streams, check if it's a master playlist and parse variants
    if (mediaType === 'hls') {
      try {
        // Ensure content script is ready before attempting to fetch
        const isReady = await ensureContentScriptReady(tabId);
        if (!isReady) {
          throw new Error('Content script not ready');
        }

        // Send message to content script in the specific tab to fetch the m3u8
        const safeHeaders = getSafeHeadersForContentScript(fullHeaders);

        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'fetchM3U8',
          url: url,
          headers: safeHeaders
        });

        if (response && response.success) {
          // Parse the m3u8 content in the service worker (all heavy logic stays here)
          const playlistInfo = parseHLSMasterPlaylistContent(url, response.content);
          await enrichHlsItemWithDuration(itemData, playlistInfo, tabId);
        }
      } catch (e) {
        // If content script messaging fails (e.g., content script not loaded yet),
        // fall back to direct fetch (may fail with 403 on some CDNs)
        console.warn('Content script fetch failed, trying fallback:', e);
        try {
          const playlistInfo = await parseHLSMasterPlaylist(url, fullHeaders);
          await enrichHlsItemWithDuration(itemData, playlistInfo, tabId);
        } catch (fallbackError) {
          console.warn('Fallback parse also failed:', fallbackError);
        }
      }
    }
    
    const result = await queuedSave(key, requestId, itemData, url);

    // If queuedSave returned null, it means the item was a duplicate or limit was reached
    if (result === null) {
      return;
    }

    await updateBadge(tabId);

    // Try to notify popup with the actual item data
    chrome.runtime.sendMessage({ cmd: 'ITEM_DETECTED', tabId, item: itemData }, () => {
      // Ignore errors (popup may be closed)
      chrome.runtime.lastError;
    });
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
  ['responseHeaders']
);
```

##### `onRemoved` Listener - Lines 1084-1086

```javascript
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await chrome.storage.local.remove([`subs_${tabId}`, `streams_${tabId}`]);
});
```

##### `onUpdated` Listener - Lines 1088-1093

```javascript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    await chrome.storage.local.remove([`subs_${tabId}`, `streams_${tabId}`]);
    await updateBadge(tabId);
  }
});
```

##### `onMessage` Listener - Lines 1095-1149

```javascript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.cmd === 'GET_ITEMS') {
    const tabId = message.tabId;
    chrome.storage.local.get([`streams_${tabId}`, `subs_${tabId}`], (data) => {
      sendResponse({ streams: data[`streams_${tabId}`] || {}, subtitles: data[`subs_${tabId}`] || {} });
    });
    return true;
  }

  if (message.cmd === 'CLEAR_ITEMS') {
    const tabId = message.tabId;
    chrome.storage.local.remove([`streams_${tabId}`, `subs_${tabId}`], () => {
      updateBadge(tabId);
      sendResponse();
    });
    return true;
  }

  if (message.cmd === 'BUILD_MPV') {
    const { streamItem, subtitleItems } = message;
    sendResponse({ command: buildMpvCommand(streamItem, subtitleItems || []) });
    return true;
  }

  if (message.cmd === 'BUILD_FFMPEG') {
    const { streamItem, subtitleItems, outputFormat, outputFilename } = message;
    sendResponse({ command: buildFfmpegCommand(streamItem, subtitleItems || [], outputFormat, outputFilename) });
    return true;
  }

  if (message.cmd === 'DOWNLOAD_VIDEO') {
    const { url, filename, headers } = message;
    downloadVideo(url, filename, headers)
      .then(downloadId => sendResponse({ success: true, downloadId }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.cmd === 'DOWNLOAD_SUBTITLE') {
    console.log('[ServiceWorker] Received DOWNLOAD_SUBTITLE command');
    const { url, filename, headers } = message;
    
    downloadSubtitle(url, filename, headers)
      .then(downloadId => {
        sendResponse({ success: true, downloadId });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
```

---

### 2.2 Content Script Functions ([`content-script.js`](content-script.js))

#### Message Listener - Lines 8-52

```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[ContentScript] Received message:', request.action, 'from sender:', sender);

  if (request.action === 'ping') {
    console.log('[ContentScript] Ping received, responding');
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'fetchM3U8') {
    console.log('[ContentScript] fetchM3U8 action received');
    
    fetchM3U8Content(request.url, request.headers)
      .then(content => {
        sendResponse({ success: true, content });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'fetchMediaPlaylist') {
    console.log('[ContentScript] fetchMediaPlaylist action received');
    
    fetchM3U8Content(request.url, request.headers)
      .then(content => {
        sendResponse({ success: true, content });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});
```

#### `fetchM3U8Content()` - Lines 56-146

```javascript
async function fetchM3U8Content(url, headers = {}) {
  try {
    // Build fetch options
    const fetchOptions = {
      method: 'GET',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000)
    };

    // Check if we have any headers to process
    const headerKeys = Object.keys(headers || {});

    if (headerKeys.length > 0) {
      // Build headers object - pass through most headers
      // The browser will silently ignore headers it doesn't allow
      const safeHeaders = {};
      
      // Headers that would definitely cause fetch to throw an error
      // DUPLICATE DEFINITION - different from service-worker.js!
      const forbiddenHeaders = new Set([
        'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
        'connection', 'content-length', 'cookie', 'cookie2', 'date', 'expect', 'host', 'keep-alive',
        'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
      ]);
      
      for (const [key, value] of Object.entries(headers)) {
        if (!key || value === undefined) {
          continue;
        }
        
        const lowerKey = key.toLowerCase();
        
        // Skip headers that would cause fetch to throw
        if (forbiddenHeaders.has(lowerKey)) {
          continue;
        }
        
        safeHeaders[key] = value;
      }
      
      // Add headers to fetch options
      const safeHeaderKeys = Object.keys(safeHeaders);
      if (safeHeaderKeys.length > 0) {
        fetchOptions.headers = safeHeaders;
      }
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    return content;
  } catch (error) {
    throw error;
  }
}
```

---

### 2.3 Popup Script Functions ([`popup.js`](popup.js))

#### Constants - Lines 6-32

```javascript
// Lines 6-24: Language name mapping (DUPLICATE of service-worker.js LANGUAGE_CODE_MAP)
const LANGUAGE_NAMES = {
  'en': 'English', 'es': 'Spanish', 'fr': 'French', ...
};

// Line 27: Language detection cache
const languageCache = new Map();

// Lines 30-32: Theme management
const THEME_KEY = 'subtitle-catcher-theme';
const THEMES = ['auto', 'light', 'dark'];
let currentThemeIndex = 0;
```

#### `detectSubtitleLanguage()` - Lines 35-77

```javascript
async function detectSubtitleLanguage(url, headers = {}) {
  if (languageCache.has(url)) {
    return languageCache.get(url);
  }
  
  try {
    // Fetch first ~5KB of subtitle file for language detection
    const fetchHeaders = new Headers();
    Object.entries(headers).forEach(([k, v]) => fetchHeaders.set(k, v));
    
    const response = await fetch(url, { 
      method: 'GET',
      headers: fetchHeaders,
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) return null;
    
    const text = await response.text();
    
    // Extract text content from subtitle formats
    const contentText = extractSubtitleText(text);
    
    if (!contentText || contentText.length < 20) return null;
    
    // Use Chrome's built-in language detection API
    const result = await chrome.i18n.detectLanguage(contentText.substring(0, 2000));
    
    if (result?.languages?.length > 0) {
      const detected = result.languages[0];
      if (detected.percentage > 50) {
        const langCode = detected.language.toLowerCase();
        languageCache.set(url, langCode);
        return langCode;
      }
    }
    
    return null;
  } catch (e) {
    console.warn('Language detection failed:', e);
    return null;
  }
}
```

#### `extractSubtitleText()` - Lines 80-110

```javascript
function extractSubtitleText(rawText) {
  let text = rawText;
  
  // Remove WebVTT header
  text = text.replace(/^WEBVTT.*?\n\n/gis, '');
  
  // Remove SRT/VTT timestamp lines
  text = text.replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}[^\n]*/g, '');
  
  // Remove numeric indices (SRT format)
  text = text.replace(/^\d+\s*$/gm, '');
  
  // Remove ASS/SSA style tags and headers
  text = text.replace(/\{\\[^}]+\}/g, '');
  text = text.replace(/^\[Script Info\].*?\n\n/gis, '');
  text = text.replace(/^\[V4\+? Styles\].*?\n\n/gis, '');
  text = text.replace(/^Format:.*$/gm, '');
  text = text.replace(/^Style:.*$/gm, '');
  text = text.replace(/^Dialogue:.*?,/gm, '');
  
  // Remove HTML/VTT tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Remove cue settings (VTT)
  text = text.replace(/position:\d+%.*$/gm, '');
  
  // Remove extra whitespace and empty lines
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}
```

#### Main IIFE - Lines 171-1876

The popup logic is wrapped in an async IIFE. Key state variables:

```javascript
// Lines 195-199: State variables
let streamItems = {};
let subtitleItems = {};
let videoFileItems = {};
let selectedStreamId = null;
let btnSelectAllSection = null;

// Lines 201-204: Section containers
let streamsSection = null;
let subtitlesSection = null;
let videoFilesSection = null;

// Line 611: Subtitle language cache
const subtitleLanguageCache = new Map();

// Line 866: Selected variants map
const selectedVariants = new Map();
```

#### Key Popup Functions

##### `getEffectiveStreamItem()` - Lines 389-409

```javascript
function getEffectiveStreamItem(streamId) {
  // streamId is the URL
  const streamItem = Object.values(streamItems).find(s => s.url === streamId);
  if (!streamItem) return null;
  
  // Check if a variant is selected for this stream
  const selectedVariant = selectedVariants.get(streamId);
  if (selectedVariant && selectedVariant.variant) {
    // Return a modified stream item with the variant URL
    return {
      ...streamItem,
      url: selectedVariant.variant.url,
      variantName: selectedVariant.variant.name,
      resolution: selectedVariant.variant.resolution || streamItem.resolution,
      bitrate: selectedVariant.variant.bitrate || streamItem.bitrate,
      codec: selectedVariant.variant.codec || streamItem.codec
    };
  }
  
  return streamItem;
}
```

##### `updateCommandBar()` - Lines 515-590

Updates the command bar UI based on current selection state.

##### `getSelectedSubtitles()` - Lines 613-637

```javascript
function getSelectedSubtitles() {
  return Array.from(container.querySelectorAll('.list-item[data-kind="subtitle"] input[type="checkbox"]:checked'))
    .map(cb => {
      const listItem = cb.closest('.list-item');
      const url = listItem?.dataset.subtitleUrl;
      if (!url) return null;

      // Find by URL - guaranteed unique
      const foundItem = Object.values(subtitleItems).find(s => s.url === url);
      if (!foundItem) return null;

      // Include detected language code and name if available
      const langCode = subtitleLanguageCache.get(foundItem.url);
      if (langCode) {
        return {
          ...foundItem,
          languageCode: langCode,
          languageName: getLanguageName(langCode)
        };
      }

      return foundItem;
    })
    .filter(Boolean);
}
```

##### `appendStreamCard()` - Lines 1130-1341

Creates and appends a stream card to the UI.

##### `appendVideoFileCard()` - Lines 1343-1420

Creates and appends a video file card to the UI.

##### `appendSubtitleCard()` - Lines 1422-1527

Creates and appends a subtitle card to the UI.

---

## 3. Message Protocol Specification

### 3.1 Service Worker → Content Script Messages

| Action | Direction | Payload | Response |
|--------|-----------|---------|----------|
| `ping` | SW → CS | `{ action: 'ping' }` | `{ success: true }` |
| `fetchM3U8` | SW → CS | `{ action: 'fetchM3U8', url: string, headers: object }` | `{ success: boolean, content?: string, error?: string }` |
| `fetchMediaPlaylist` | SW → CS | `{ action: 'fetchMediaPlaylist', url: string, headers: object }` | `{ success: boolean, content?: string, error?: string }` |

### 3.2 Service Worker → Popup Messages

| Command | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `ITEM_DETECTED` | SW → Popup | `{ cmd: 'ITEM_DETECTED', tabId: number, item: object }` | None (fire-and-forget) |

### 3.3 Popup → Service Worker Messages

| Command | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `GET_ITEMS` | Popup → SW | `{ cmd: 'GET_ITEMS', tabId: number }` | `{ streams: object, subtitles: object }` |
| `CLEAR_ITEMS` | Popup → SW | `{ cmd: 'CLEAR_ITEMS', tabId: number }` | `{}` |
| `BUILD_MPV` | Popup → SW | `{ cmd: 'BUILD_MPV', streamItem: object, subtitleItems: array }` | `{ command: string }` |
| `BUILD_FFMPEG` | Popup → SW | `{ cmd: 'BUILD_FFMPEG', streamItem: object, subtitleItems: array, outputFormat: string, outputFilename: string }` | `{ command: string }` |
| `DOWNLOAD_VIDEO` | Popup → SW | `{ cmd: 'DOWNLOAD_VIDEO', url: string, filename: string, headers: object }` | `{ success: boolean, downloadId?: number, error?: string }` |
| `DOWNLOAD_SUBTITLE` | Popup → SW | `{ cmd: 'DOWNLOAD_SUBTITLE', url: string, filename: string, headers: object }` | `{ success: boolean, downloadId?: number, error?: string }` |

---

## 4. Storage Schema

### 4.1 Storage Keys

| Key Pattern | Description | Value Type |
|-------------|-------------|------------|
| `streams_${tabId}` | Captured streams for a tab | `Record<string, StreamItem>` |
| `subs_${tabId}` | Captured subtitles for a tab | `Record<string, SubtitleItem>` |

### 4.2 StreamItem Structure

```typescript
interface StreamItem {
  url: string;              // The stream URL
  format: string;           // 'm3u8', 'mpd', 'mp4', etc.
  name: string;             // Derived filename
  size: number;             // Content-Length in bytes
  headers: Record<string, string>;  // Request headers
  tabId: number;            // Tab ID where captured
  timestamp: number;        // Capture timestamp (used as ID)
  kind: 'stream';           // Item kind identifier
  mediaType: 'hls' | 'dash' | 'video' | 'other';
  
  // Optional metadata
  resolution?: string;      // e.g., '1080p'
  quality?: string;         // e.g., 'FHD', 'HD', '4K'
  codec?: string;           // e.g., 'H264', 'H265'
  bitrate?: string;         // e.g., '5.0Mbps'
  hdr?: boolean;            // HDR flag
  
  // HLS-specific
  isMasterPlaylist?: boolean;
  variants?: Variant[];
  duration?: number;        // In seconds
  durationFormatted?: string;  // e.g., '2h 15m'
}

interface Variant {
  url: string;
  bandwidth: number;
  bitrate: string;
  resolution: string;
  codec: string;
  audioCodec: string;
  codecs: string;
  frameRate: number;
  audioLanguages: string[];
  name: string;
  estimatedSize?: number;
  estimatedSizeFormatted?: string;
}
```

### 4.3 SubtitleItem Structure

```typescript
interface SubtitleItem {
  url: string;
  format: string;           // 'vtt', 'srt', 'ass', etc.
  name: string;
  size: number;
  headers: Record<string, string>;
  tabId: number;
  timestamp: number;
  kind: 'subtitle';
}
```

---

## 5. Data Flow Analysis

### 5.1 Request Capture Flow

```
1. Browser initiates request
   │
   ▼
2. onBeforeSendHeaders fires
   │  → Store headers in pendingReqHeaders[requestId]
   │
   ▼
3. Response received
   │  → onBeforeSendHeaders fires
   │  → Retrieve headers from pendingReqHeaders[requestId]
   │  → DELETE pendingReqHeaders[requestId]  ← BUG: Too early!
   │
   ▼
4. Content-Type detection
   │  → Check MIME type
   │  → Check URL extension
   │
   ▼
5. For HLS: Fetch and parse playlist
   │  → ensureContentScriptReady()
   │  → Send fetchM3U8 to content script
   │  → Parse response
   │  → Enrich with duration/variants
   │
   ▼
6. Save to storage
   │  → queuedSave() with duplicate check
   │
   ▼
7. Update badge
   │
   ▼
8. Notify popup (if open)
   │  → ITEM_DETECTED message
```

### 5.2 Popup Initialization Flow

```
1. Popup opens
   │
   ▼
2. Query active tab
   │
   ▼
3. Send GET_ITEMS to service worker
   │
   ▼
4. Service worker reads from storage
   │  → chrome.storage.local.get([`streams_${tabId}`, `subs_${tabId}`])
   │
   ▼
5. Popup renders items
   │  → Create sections
   │  → Append cards
   │  → Update command bar
   │
   ▼
6. Listen for ITEM_DETECTED messages
   │  → Update internal state
   │  → Append new cards
```

---

## 6. Bug Patterns with Exact Locations

### 6.1 Race Condition: Header Deletion

**Location**: [`service-worker.js:935`](service-worker.js:935)

```javascript
// BUG: Headers deleted immediately after first access
const reqHeaders = pendingReqHeaders[requestId] || [];
delete pendingReqHeaders[requestId];  // ← BUG HERE
```

**Problem**: If the same request generates multiple response events, headers are lost.

**Fix**:
```javascript
// Use TTL-based cleanup instead
const reqHeaders = pendingReqHeaders[requestId] || [];
setTimeout(() => delete pendingReqHeaders[requestId], 60000);
```

### 6.2 Duplicate Header Definitions

**Locations**: 
- [`service-worker.js:43-47`](service-worker.js:43)
- [`content-script.js:83-87`](content-script.js:83)

```javascript
// service-worker.js
const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', ...
]);

// content-script.js - DUPLICATE!
const forbiddenHeaders = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', ...
]);
```

**Problem**: Two different definitions can diverge over time.

**Fix**: Create shared module `shared/headers.js` and import in both.

### 6.3 Content Script Injection Race

**Location**: [`service-worker.js:220-255`](service-worker.js:220)

```javascript
async function ensureContentScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.success) {
      return true;
    }
  } catch (error) {
    // Will inject
  }
  // ... injection logic
}
```

**Problem**: No caching, called multiple times per request, 200ms delay is arbitrary.

**Fix**:
```javascript
const contentScriptReady = new Map(); // tabId -> Promise<boolean>

async function ensureContentScriptReady(tabId) {
  if (!contentScriptReady.has(tabId)) {
    contentScriptReady.set(tabId, doEnsureReady(tabId));
  }
  return contentScriptReady.get(tabId);
}

// Clear on navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    contentScriptReady.delete(tabId);
  }
});
```

### 6.4 Duplicate Check at Multiple Levels

**Locations**:
- [`service-worker.js:1005-1010`](service-worker.js:1005) - Early check
- [`service-worker.js:69-72`](service-worker.js:69) - Inside queuedSave

```javascript
// Early check (line 1005)
if (Object.values(items).some((item) => item.url === url)) {
  return;
}

// Inside queuedSave (line 69)
if (url && Object.values(items).some((item) => item.url === url)) {
  return null;
}
```

**Problem**: Redundant checks, potential for inconsistency.

**Fix**: Remove early check, rely only on queuedSave's check.

### 6.5 Selection State Loss on Popup Close

**Location**: [`popup.js:195-199`](popup.js:195)

```javascript
let streamItems = {};
let subtitleItems = {};
let videoFileItems = {};
let selectedStreamId = null;  // Lost when popup closes!
```

**Problem**: Selection state is in-memory only.

**Fix**: Persist to `chrome.storage.session`:
```javascript
// On selection change
await chrome.storage.session.set({
  [`selection_${tabId}`]: {
    streamId: selectedStreamId,
    subtitleIds: Array.from(selectedSubtitleIds)
  }
});
```

---

## 7. Rewrite Implementation Steps

### Phase 1: Create Shared Modules

#### Step 1.1: Create `shared/constants.js`

```javascript
// shared/constants.js
// MIME type mappings
export const SUBTITLE_MIME_MAP = {
  'text/vtt': 'vtt',
  'text/webvtt': 'vtt',
  'application/x-subrip': 'srt',
  'text/x-ssa': 'ass',
  'text/x-ass': 'ass',
  'application/ttml+xml': 'ttml',
  'application/ttaf+xml': 'ttml',
  'text/ttml': 'ttml',
  'application/xml': null,
  'text/xml': null,
  'text/plain': null,
  'application/octet-stream': null,
};

export const SUBTITLE_EXTENSIONS = new Set([
  'vtt', 'srt', 'ass', 'ssa', 'sub', 'ttml', 'dfxp', 'sbv', 'stl', 'lrc', 'smi'
]);

export const VIDEO_MIME_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/x-matroska', 'video/avi', 'video/quicktime',
  'video/x-flv', 'video/x-ms-wmv', 'video/3gpp', 'video/ogg', 'video/mpeg'
]);

export const HLS_EXTENSIONS = new Set(['m3u8', 'm3u']);
export const HLS_MIME_TYPES = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl']);

export const DASH_EXTENSIONS = new Set(['mpd']);
export const DASH_MIME_TYPES = new Set([
  'application/dash+xml',
  'application/vnd.mpeg.dash.mpd'
]);

// Headers to strip from commands (not useful for external tools)
export const STRIP_HEADERS = new Set([
  'range', 'content-length', 'content-type', 'accept-encoding',
  'upgrade-insecure-requests', 'cache-control', 'pragma'
]);

// Forbidden headers (browser-controlled, cannot be set via fetch)
export const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie',
  'cookie2', 'date', 'expect', 'host', 'keep-alive', 'origin', 'referer',
  'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);

// Limits
export const MAX_ITEMS_PER_TAB = 50;
export const FETCH_TIMEOUT_MS = 5000;
export const M3U8_FETCH_TIMEOUT_MS = 10000;
```

#### Step 1.2: Create `shared/headers.js`

```javascript
// shared/headers.js
import { STRIP_HEADERS } from './constants.js';

/**
 * Convert headers array to object
 * @param {Array<{name: string, value: string}>} headerArray
 * @returns {Record<string, string>}
 */
export function headersArrayToObject(headerArray) {
  const headers = {};
  for (const h of headerArray) {
    const name = h.name || '';
    if (name) {
      headers[name] = h.value || '';
    }
  }
  return headers;
}

/**
 * Sanitize headers for external tools (mpv, ffmpeg)
 * Removes STRIP_HEADERS only (for command generation)
 * NOTE: FORBIDDEN_HEADERS is NOT used here - that's the content script's responsibility
 * @param {Array<{name: string, value: string}> | Record<string, string>} input
 * @returns {Record<string, string>}
 */
export function sanitizeHeaders(input) {
  const headers = {};
  const entries = Array.isArray(input)
    ? input.map(h => [h.name, h.value])
    : Object.entries(input);
  
  for (const [name, value] of entries) {
    if (!name) continue;
    const lowerName = name.toLowerCase();
    // Only strip headers that cause problems for mpv/ffmpeg
    // Do NOT filter FORBIDDEN_HEADERS here - pass all to content script
    if (!STRIP_HEADERS.has(lowerName)) {
      headers[name] = value || '';
    }
  }
  return headers;
}

/**
 * Check if a header should be stripped (for mpv/ffmpeg commands)
 * @param {string} name
 * @returns {boolean}
 */
export function shouldStripHeader(name) {
  return STRIP_HEADERS.has(name.toLowerCase());
}
```

#### Step 1.3: Content Script Headers Module

```javascript
// content/headers.js
// NOTE: FORBIDDEN_HEADERS is defined ONLY in content script
// It's the content script's responsibility to filter headers that can't be set via fetch
// Service worker passes ALL headers - content script decides what to use

const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie',
  'cookie2', 'date', 'expect', 'host', 'keep-alive', 'origin', 'referer',
  'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);

/**
 * Filter headers for fetch API - removes browser-forbidden headers
 * Service worker passes ALL headers, content script filters what it can use
 * @param {Record<string, string>} headers
 * @returns {Record<string, string>}
 */
export function filterFetchHeaders(headers) {
  const safeHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!name || value === undefined) continue;
    
    // Content script responsibility: skip headers browser won't allow
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      console.log(`[ContentScript] Skipping forbidden header: ${name}`);
      continue;
    }
    
    safeHeaders[name] = value;
  }
  return safeHeaders;
}
```

#### Step 1.4: Create `shared/types.js` (JSDoc)

```javascript
// shared/types.js
/**
 * @typedef {'stream' | 'subtitle'} ItemKind
 * @typedef {'hls' | 'dash' | 'video' | 'other'} MediaType
 */

/**
 * @typedef {Object} MediaItem
 * @property {string} id - UUID
 * @property {string} url
 * @property {number} tabId
 * @property {number} timestamp
 * @property {ItemKind} kind
 * @property {string} format
 * @property {string} name
 * @property {number} [size]
 * @property {Record<string, string>} headers
 */

/**
 * @typedef {MediaItem & {
 *   kind: 'stream',
 *   mediaType: MediaType,
 *   variants?: Variant[],
 *   selectedVariantId?: string,
 *   duration?: number,
 *   resolution?: string,
 *   codec?: string
 * }} StreamItem
 */

/**
 * @typedef {MediaItem & {
 *   kind: 'subtitle',
 *   detectedLanguage?: string,
 *   selected: boolean
 * }} SubtitleItem
 */

/**
 * @typedef {Object} Variant
 * @property {string} url
 * @property {number} bandwidth
 * @property {string} bitrate
 * @property {string} resolution
 * @property {string} codec
 * @property {string} audioCodec
 * @property {string} codecs
 * @property {number} frameRate
 * @property {string[]} audioLanguages
 * @property {string} name
 * @property {number} [estimatedSize]
 * @property {string} [estimatedSizeFormatted]
 */

/**
 * @typedef {Object} TabState
 * @property {number} tabId
 * @property {Record<string, StreamItem>} streams
 * @property {Record<string, SubtitleItem>} subtitles
 * @property {string|null} selectedStreamId
 * @property {Set<string>} selectedSubtitleIds
 */

/**
 * @typedef {Object} MessagePayload
 * @property {string} cmd - Command name
 * @property {number} [tabId]
 * @property {Object} [item]
 * @property {StreamItem} [streamItem]
 * @property {SubtitleItem[]} [subtitleItems]
 * @property {string} [outputFormat]
 * @property {string} [outputFilename]
 * @property {string} [url]
 * @property {string} [filename]
 * @property {Record<string, string>} [headers]
 */
```

### Phase 2: Create Storage Layer

#### Step 2.1: Create `background/storage.js`

```javascript
// background/storage.js

/**
 * Storage Manager - Single source of truth for all data
 */
export class StorageManager {
  constructor() {
    this._changeListeners = new Set();
    this._saveQueues = new Map(); // key -> Promise chain
    
    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        this._notifyListeners(changes);
      }
    });
  }
  
  /**
   * Get all items for a tab
   * @param {number} tabId
   * @returns {Promise<{streams: Record<string, Object>, subtitles: Record<string, Object>}>}
   */
  async getTabItems(tabId) {
    const streamKey = `streams_${tabId}`;
    const subKey = `subs_${tabId}`;
    const data = await chrome.storage.local.get([streamKey, subKey]);
    return {
      streams: data[streamKey] || {},
      subtitles: data[subKey] || {}
    };
  }
  
  /**
   * Add an item with deduplication
   * @param {number} tabId
   * @param {Object} item
   * @returns {Promise<boolean>} - True if added, false if duplicate/limit
   */
  async addItem(tabId, item) {
    const key = item.kind === 'stream' ? `streams_${tabId}` : `subs_${tabId}`;
    
    // Queue saves per key to prevent race conditions
    if (!this._saveQueues.has(key)) {
      this._saveQueues.set(key, Promise.resolve());
    }
    
    const queue = this._saveQueues.get(key);
    this._saveQueues.set(key, queue.then(async () => {
      const data = await chrome.storage.local.get([key]);
      const items = data[key] || {};
      
      // Check for duplicate by URL
      if (Object.values(items).some(i => i.url === item.url)) {
        return false;
      }
      
      // Check limit
      if (Object.keys(items).length >= 50) {
        return false;
      }
      
      // Add item
      items[item.id || Date.now().toString()] = item;
      await chrome.storage.local.set({ [key]: items });
      return true;
    }));
    
    return this._saveQueues.get(key);
  }
  
  /**
   * Clear all items for a tab
   * @param {number} tabId
   */
  async clearTab(tabId) {
    await chrome.storage.local.remove([`streams_${tabId}`, `subs_${tabId}`]);
  }
  
  /**
   * Subscribe to storage changes
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onChange(callback) {
    this._changeListeners.add(callback);
    return () => this._changeListeners.delete(callback);
  }
  
  _notifyListeners(changes) {
    for (const callback of this._changeListeners) {
      try {
        callback(changes);
      } catch (e) {
        console.error('Storage change listener error:', e);
      }
    }
  }
}

// Singleton instance
export const storage = new StorageManager();
```

### Phase 3: Refactor Service Worker

#### Step 3.1: Create `background/capture.js`

```javascript
// background/capture.js
import { storage } from './storage.js';
import { sanitizeHeaders, headersArrayToObject } from '../shared/headers.js';
import {
  HLS_MIME_TYPES, HLS_EXTENSIONS, DASH_MIME_TYPES, DASH_EXTENSIONS,
  VIDEO_MIME_TYPES, SUBTITLE_MIME_MAP, SUBTITLE_EXTENSIONS
} from '../shared/constants.js';

// In-memory request headers with TTL cleanup
const pendingHeaders = new Map();
const HEADER_TTL_MS = 60000;

// Content script ready state cache
const contentScriptReady = new Map();

/**
 * Initialize capture listeners
 */
export function initCapture() {
  // Store request headers
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      pendingHeaders.set(details.requestId, {
        headers: details.requestHeaders || [],
        timestamp: Date.now()
      });
      
      // Cleanup old entries
      for (const [id, data] of pendingHeaders) {
        if (Date.now() - data.timestamp > HEADER_TTL_MS) {
          pendingHeaders.delete(id);
        }
      }
    },
    { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
    ['requestHeaders', 'extraHeaders']
  );
  
  // Process responses
  chrome.webRequest.onResponseStarted.addListener(
    handleResponse,
    { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
    ['responseHeaders']
  );
  
  // Clear content script cache on navigation
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      contentScriptReady.delete(tabId);
    }
  });
}

async function handleResponse(details) {
  const { requestId, url, tabId, responseHeaders = [], statusCode, method } = details;
  
  // Validate request
  if (!url.startsWith('http') || tabId < 0) return;
  if (statusCode < 200 || statusCode >= 300) return;
  if (method === 'POST') return;
  
  // Get stored headers
  const headerData = pendingHeaders.get(requestId);
  if (!headerData) return;
  
  // Detect content type
  const contentType = getHeaderValue(responseHeaders, 'content-type');
  const ext = getUrlExtension(url);
  const detection = detectContentType(contentType, ext);
  
  if (!detection) return;
  
  // Build item data
  const item = {
    id: generateId(),
    url,
    tabId,
    timestamp: Date.now(),
    kind: detection.kind,
    format: detection.format,
    mediaType: detection.mediaType,
    name: deriveFilename(url, responseHeaders),
    size: getContentLength(responseHeaders),
    headers: headersArrayToObject(headerData.headers)
  };
  
  // Save with deduplication
  const added = await storage.addItem(tabId, item);
  if (!added) return;
  
  // Update badge
  updateBadge(tabId);
  
  // Notify popup
  notifyPopup(tabId, item);
}

// Helper functions...
function getHeaderValue(headers, name) {
  const target = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === target) {
      return (h.value || '').split(';')[0].trim().toLowerCase();
    }
  }
  return '';
}

function getUrlExtension(url) {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('.');
    if (parts.length < 2) return null;
    return parts[parts.length - 1].toLowerCase().split('/')[0];
  } catch {
    return null;
  }
}

function detectContentType(contentType, ext) {
  // HLS
  if (HLS_MIME_TYPES.has(contentType) || (ext && HLS_EXTENSIONS.has(ext))) {
    return { kind: 'stream', format: 'm3u8', mediaType: 'hls' };
  }
  // DASH
  if (DASH_MIME_TYPES.has(contentType) || (ext && DASH_EXTENSIONS.has(ext))) {
    return { kind: 'stream', format: 'mpd', mediaType: 'dash' };
  }
  // Video
  if (VIDEO_MIME_TYPES.has(contentType) || (ext && VIDEO_EXTENSIONS.has(ext))) {
    return { kind: 'stream', format: ext || 'video', mediaType: 'video' };
  }
  // Subtitle
  if (contentType in SUBTITLE_MIME_MAP) {
    const mapped = SUBTITLE_MIME_MAP[contentType];
    if (mapped) return { kind: 'subtitle', format: mapped, mediaType: null };
    if (ext && SUBTITLE_EXTENSIONS.has(ext)) {
      return { kind: 'subtitle', format: ext, mediaType: null };
    }
  }
  if (ext && SUBTITLE_EXTENSIONS.has(ext)) {
    return { kind: 'subtitle', format: ext, mediaType: null };
  }
  return null;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function deriveFilename(url, headers) {
  for (const h of headers) {
    if (h.name.toLowerCase() === 'content-disposition') {
      const match = h.value.match(/filename\*?=(?:UTF-8'')?["']?([^;"'\r\n]+)/i);
      if (match) return decodeURIComponent(match[1].trim().replace(/['"]/g, ''));
    }
  }
  try {
    const { pathname } = new URL(url);
    return pathname.split('/').pop() || 'media';
  } catch {
    return 'media';
  }
}

function getContentLength(headers) {
  for (const h of headers) {
    if (h.name.toLowerCase() === 'content-length') {
      return parseInt(h.value) || 0;
    }
  }
  return 0;
}

async function updateBadge(tabId) {
  const { streams, subtitles } = await storage.getTabItems(tabId);
  const count = Object.keys(streams).length + Object.keys(subtitles).length;
  const text = count > 0 ? String(count) : '';
  try {
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#0077FF', tabId });
  } catch {}
}

function notifyPopup(tabId, item) {
  chrome.runtime.sendMessage({ cmd: 'ITEM_DETECTED', tabId, item }).catch(() => {});
}
```

---

## 8. New Architecture Design

### 8.1 Proposed File Structure

```
src/
├── background/
│   ├── index.js          # Entry point
│   ├── capture.js        # Request interception
│   ├── storage.js        # Storage abstraction
│   ├── hls-parser.js     # HLS parsing
│   ├── commands.js       # mpv/ffmpeg builders
│   └── downloads.js      # Download handlers
│
├── content/
│   ├── index.js          # Message handlers
│   └── fetcher.js        # Page-context fetch
│
├── popup/
│   ├── index.js          # Entry point
│   ├── store.js          # Reactive state
│   ├── components/
│   │   ├── App.js
│   │   ├── StreamItem.js
│   │   ├── SubtitleItem.js
│   │   └── CommandBar.js
│   └── utils.js
│
├── shared/
│   ├── constants.js      # All constants
│   ├── headers.js        # Header utilities
│   └── types.js          # JSDoc types
│
├── manifest.json
└── popup.html
```

### 8.2 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     Network Requests                         ││
│  └──────────────────────────┬──────────────────────────────────┘│
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Service Worker                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   capture.js │───►│  storage.js  │◄───│  commands.js │      │
│  │              │    │              │    │              │      │
│  │ webRequest   │    │ TabState     │    │ mpv/ffmpeg   │      │
│  │ listeners    │    │ management   │    │ builders     │      │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘      │
│         │                   │                                   │
│         │    ┌──────────────┴──────────────┐                   │
│         │    │         Messages             │                   │
│         │    │  GET_ITEMS, BUILD_MPV, etc.  │                   │
│         │    └──────────────┬──────────────┘                   │
└─────────┼───────────────────┼───────────────────────────────────┘
          │                   │
          │ sendMessage       │ sendMessage
          ▼                   ▼
┌─────────────────┐   ┌───────────────────────────────────────────┐
│ Content Script  │   │                  Popup                     │
│                 │   │  ┌──────────────┐    ┌──────────────┐     │
│ fetchM3U8       │   │  │   store.js   │───►│  components  │     │
│ fetchMedia      │   │  │              │    │              │     │
│                 │   │  │ Reactive     │    │ StreamItem   │     │
│ (page context   │   │  │ state mgmt   │    │ SubtitleItem │     │
│  with cookies)  │   │  └──────────────┘    │ CommandBar   │     │
│                 │   │                      └──────────────┘     │
└─────────────────┘   └───────────────────────────────────────────┘
```

### 8.3 Key Improvements

1. **Single Source of Truth**: `storage.js` manages all state
2. **Shared Constants**: No duplicate header definitions
3. **TTL-based Cleanup**: Headers don't leak memory
4. **Cached Content Script State**: No repeated injection attempts
5. **Reactive Store**: Popup UI updates automatically
6. **Component-based UI**: Easier to maintain and test

---

## Appendix A: Quick Reference

### A.1 All Message Types

| Direction | Message | Purpose |
|-----------|---------|---------|
| SW → CS | `ping` | Check if content script is ready |
| SW → CS | `fetchM3U8` | Fetch m3u8 content in page context |
| SW → CS | `fetchMediaPlaylist` | Fetch media playlist for duration |
| SW → Popup | `ITEM_DETECTED` | Notify popup of new item |
| Popup → SW | `GET_ITEMS` | Get all items for tab |
| Popup → SW | `CLEAR_ITEMS` | Clear all items for tab |
| Popup → SW | `BUILD_MPV` | Build mpv command |
| Popup → SW | `BUILD_FFMPEG` | Build ffmpeg command |
| Popup → SW | `DOWNLOAD_VIDEO` | Download video file |
| Popup → SW | `DOWNLOAD_SUBTITLE` | Download subtitle file |

### A.2 Storage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `streams_${tabId}` | `Record<string, StreamItem>` | HLS/DASH/video streams |
| `subs_${tabId}` | `Record<string, SubtitleItem>` | Subtitle files |

### A.3 Critical Line Numbers

| Issue | File | Line |
|-------|------|------|
| Header deletion bug | service-worker.js | 935 |
| Duplicate FORBIDDEN_HEADERS | content-script.js | 83-87 |
| Content script race | service-worker.js | 220-255 |
| Duplicate check #1 | service-worker.js | 1005-1010 |
| Duplicate check #2 | service-worker.js | 69-72 |
| Selection state loss | popup.js | 195-199 |

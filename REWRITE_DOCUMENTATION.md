# Stream + Subtitle Catcher - First-Principles Rewrite Documentation

This document provides a comprehensive analysis of the current codebase from first principles, identifying architectural flaws, bug patterns, and proposing a clean-slate redesign.

## Executive Summary

The current codebase is a **39KB service-worker + 68KB popup.js + 6KB content-script** that attempts to capture HLS/m3u8 streams and subtitle files from web pages. The code suffers from:

1. **Race conditions** in storage operations
2. **Spaghetti message passing** between service worker, content script, and popup
3. **Duplicate request handling** causing repeated network fetches
4. **Complex DOM manipulation** with multiple rendering paths
5. **Lack of state management** - data lives in multiple places
6. **Header sanitization bugs** - inconsistent filtering between components
7. **Variant selection complexity** - HLS master playlist handling is fragile

---

## 1. Current Architecture Analysis

### 1.1 Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Chrome Extension                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │  Content Script  │    │  Service Worker  │               │
│  │  (content-script.js)  │  (service-worker.js)            │
│  │                  │    │                  │               │
│  │  • Runs in page  │    │  • Background    │               │
│  │    context       │    │    process       │               │
│  │  • Fetches m3u8  │    │  • WebRequest    │               │
│  │    content       │    │    listener      │               │
│  │  • Has access to │    │  • Storage       │               │
│  │    page cookies  │    │    management    │               │
│  │    & headers     │    │  • Command       │               │
│  │                  │    │    building      │               │
│  └────────┬─────────┘    └────────┬─────────┘               │
│           │                      │                          │
│           └──────────────────────┘                          │
│           Chrome Runtime Messaging                           │
│                      │                                      │
│                      ▼                                      │
│           ┌──────────────────┐                              │
│           │     Popup UI     │                              │
│           │  (popup.js +     │                              │
│           │   popup.html)    │                              │
│           │                  │                              │
│           │  • Renders lists │                              │
│           │  • Selection     │                              │
│           │    management    │                              │
│           │  • Command gen   │                              │
│           └──────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Problems

#### The Header Capture Problem

```javascript
// CURRENT PROBLEMATIC FLOW:

// 1. Service Worker captures request headers BEFORE response
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    pendingReqHeaders[details.requestId] = details.requestHeaders || [];
  },
  // ...
);

// 2. Service Worker processes response and looks up headers
chrome.webRequest.onResponseStarted.addListener(
  async (details) => {
    const { requestId } = details;
    const reqHeaders = pendingReqHeaders[requestId] || [];  // RACE CONDITION!
    delete pendingReqHeaders[requestId];  // Deleted but may be needed again
    // ...
  }
);
```

**Bug**: Headers are deleted immediately after first access, but the same request might generate multiple events or need to be re-fetched.

#### The Content Script Messaging Problem

```javascript
// Service Worker attempts to fetch m3u8 content
// But service worker can't use the page's Origin/Referer/Cookies!

// SOLUTION: Send message to content script to fetch
const response = await chrome.tabs.sendMessage(tabId, {
  action: 'fetchM3U8',
  url: url,
  headers: safeHeaders  // Headers passed through
});

// PROBLEM: Content script may not be injected yet!
// WORKAROUND: ensureContentScriptReady() tries to inject
// But injection is async and may fail
```

**Bug**: Multiple concurrent requests can cause "Could not establish connection" errors.

#### The Storage Race Condition

```javascript
// Queued save to prevent race conditions - but queue is per-key
const saveQueue = {};
async function queuedSave(key, requestId, itemData, url) {
  if (!saveQueue[key]) {
    saveQueue[key] = Promise.resolve();
  }
  saveQueue[key] = saveQueue[key].then(async () => {
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};
    // ...duplicate check inside queue
    items[requestId] = itemData;
    await chrome.storage.local.set({ [key]: items });
  });
}
```

**Bug**: This pattern is good but incomplete - duplicate checks happen at multiple levels inconsistently.

### 1.3 State Management Issues

Current state is scattered across:

| Location | Data | Problems |
|----------|------|----------|
| `chrome.storage.local` | `streams_${tabId}`, `subs_${tabId}` | Async, not reactive |
| `service-worker.js` | `pendingReqHeaders` | Memory leak risk (requestId never expires) |
| `popup.js` | `streamItems`, `subtitleItems` | Duplicates storage, no sync mechanism |
| `popup.js` | `selectedStreamId`, `selectedVariants` | Local to popup only |
| `popup.js` | `languageCache`, `subtitleLanguageCache` | Lost on popup close |

---

## 2. Bug Patterns Identified

### 2.1 Duplicate Request Handling

```javascript
// In service-worker.js onResponseStarted:

// Early check (race-prone)
const stored = await chrome.storage.local.get([key]);
const items = stored[key] || {};
if (Object.values(items).some((item) => item.url === url)) {
  return;  // Duplicate found
}

// But then also does:
const result = await queuedSave(key, requestId, itemData, url);
// queuedSave checks AGAIN

// And notification is sent regardless of duplicate status
chrome.runtime.sendMessage({ cmd: 'ITEM_DETECTED', tabId, item: itemData });
```

**Issue**: Duplicate checks at multiple levels with inconsistent logic.

### 2.2 Message Passing Errors

```javascript
// popup.js receiving new items
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.cmd === 'ITEM_DETECTED' && msg.tabId === tabId) {
    // Update internal state
    streamItems[msg.item.timestamp] = msg.item;
    // ...
  }
});

// PROBLEM: Message may arrive when popup is closed
// When reopened, it calls GET_ITEMS which gets from storage
// But the real-time message may have been lost
```

### 2.3 HLS Variant Selection Complexity

```javascript
// Variants are stored in Map: selectedVariants
const selectedVariants = new Map();

// When building command:
function getEffectiveStreamItem(streamId) {
  const streamItem = Object.values(streamItems).find(s => s.url === streamId);
  const selectedVariant = selectedVariants.get(streamId);
  if (selectedVariant && selectedVariant.variant) {
    return {
      ...streamItem,
      url: selectedVariant.variant.url,  // URL override
      // ...other props
    };
  }
  return streamItem;
}
```

**Issue**: URL replacement happens late in the flow, causing mismatches between storage and runtime state.

### 2.4 Header Sanitization Inconsistency

```javascript
// Service Worker defines:
const STRIP_HEADERS = new Set(['range', 'content-length', ...]);
const FORBIDDEN_HEADERS = new Set(['accept-charset', 'cookie', ...]);

// Service Worker sanitization:
function sanitizeHeaders(reqHeaders) {
  // Strips both STRIP and FORBIDDEN
}

// Content Script has its OWN forbidden headers list:
const forbiddenHeaders = new Set([
  'accept-charset', 'accept-encoding', ...  // DUPLICATE DEFINITION
]);
```

**Issue**: Header filtering logic is duplicated and may diverge.

### 2.5 DOM Manipulation Hell

The popup has multiple card creation paths:

1. `appendStreamCard()` - For HLS/DASH streams
2. `appendVideoFileCard()` - For direct MP4/WebM
3. `appendSubtitleCard()` - For subtitle files

Each has:
- Different HTML structure
- Different event handlers
- Different selection mechanisms (radio vs checkbox)
- Different metadata display

**Result**: 1000+ lines of DOM manipulation code with inconsistent patterns.

---

## 3. First Principles Redesign

### 3.1 Core Purpose (What does this extension actually do?)

1. **Capture** HTTP requests for media streams and subtitles
2. **Store** the URLs and headers needed to access them
3. **Display** them in a UI for user selection
4. **Generate** commands for external tools (mpv, ffmpeg)
5. **Download** files directly when possible

### 3.2 Architectural Principles

#### Principle 1: Single Source of Truth

```
Storage Layer (chrome.storage.local)
    │
    ▼
State Manager (reactive store)
    │
    ├──► Service Worker (captures, writes)
    ├──► Popup UI (reads, renders, selects)
    └──► Background Sync (badge updates)
```

#### Principle 2: Event-Driven Architecture

```javascript
// Instead of polling and manual sync:

// Events:
STREAM_DETECTED    → Write to storage → Notify popup
SUBTITLE_DETECTED  → Write to storage → Notify popup  
TAB_NAVIGATED      → Clear storage → Update badge
SELECTION_CHANGED  → Update UI state → Enable commands
```

#### Principle 3: Immutable State Updates

```javascript
// Instead of mutating objects:
const newState = {
  ...oldState,
  streams: {
    ...oldState.streams,
    [newStream.id]: newStream
  }
};
await storage.set(newState);
```

#### Principle 4: Component-Based UI

```
Popup Structure:
├── Store (holds state, provides actions)
├── Sections
│   ├── StreamsSection
│   │   └── StreamItem[] (radio selection)
│   ├── VideoFilesSection  
│   │   └── VideoFileItem[] (radio selection)
│   └── SubtitlesSection
│       └── SubtitleItem[] (checkbox selection)
├── CommandBar
│   ├── SelectionSummary
│   └── ActionButtons (mpv, ffmpeg, download)
└── ToastNotifications
```

### 3.3 New Data Model

```typescript
// Core Types

interface MediaItem {
  id: string;           // UUID, not timestamp
  url: string;
  tabId: number;
  timestamp: number;
  kind: 'stream' | 'subtitle' | 'video-file';
  format: string;       // 'm3u8', 'vtt', 'mp4', etc.
  name: string;
  size?: number;
  headers: Record<string, string>;
}

interface StreamItem extends MediaItem {
  kind: 'stream';
  mediaType: 'hls' | 'dash' | 'other';
  variants?: Variant[];     // For HLS master playlists
  selectedVariantId?: string;
  duration?: number;
  resolution?: string;
  codec?: string;
}

interface SubtitleItem extends MediaItem {
  kind: 'subtitle';
  detectedLanguage?: string;
  selected: boolean;        // Selection state stored with item
}

interface TabState {
  tabId: number;
  streams: Record<string, StreamItem>;
  subtitles: Record<string, SubtitleItem>;
  selectedStreamId: string | null;
}

interface AppState {
  tabs: Record<number, TabState>;
  currentTheme: 'light' | 'dark' | 'auto';
}
```

### 3.4 New File Structure

```
src/
├── background/           (Service Worker)
│   ├── index.js        # Entry point, listener registration
│   ├── capture.js      # webRequest handlers
│   ├── storage.js      # Storage abstraction layer
│   ├── hls-parser.js   # HLS playlist parsing
│   ├── commands.js     # mpv/ffmpeg command builders
│   └── downloads.js    # Download handlers
│
├── content/            (Content Script)
│   ├── index.js        # Message handlers
│   └── fetcher.js      # Fetch proxy for page context
│
├── popup/              (Popup UI)
│   ├── index.js        # Entry point
│   ├── store.js        # Reactive state management
│   ├── components/     # UI components
│   │   ├── App.js
│   │   ├── Section.js
│   │   ├── StreamItem.js
│   │   ├── SubtitleItem.js
│   │   ├── CommandBar.js
│   │   └── Toast.js
│   └── utils.js        # Helpers (formatters, etc.)
│
├── shared/             # Shared code
│   ├── constants.js    # MIME types, header lists
│   ├── types.js        # TypeScript definitions (JSDoc)
│   └── headers.js      # Header sanitization (single source)
│
├── manifest.json
└── popup.html
```

---

## 4. Implementation Plan

### Phase 1: Foundation (Shared Layer)

1. **Create `shared/constants.js`**
   - All MIME type mappings
   - All header lists (STRIP_HEADERS, FORBIDDEN_HEADERS)
   - Extension constants (MAX_ITEMS, TIMEOUTS)

2. **Create `shared/headers.js`**
   ```javascript
   export function sanitizeHeaders(headers, options = {}) {
     // Single implementation used by all components
   }
   
   export function buildMpvHeaders(headers) {
     // Format for mpv --http-header-fields
   }
   
   export function buildFfmpegHeaders(headers) {
     // Format for ffmpeg -headers
   }
   ```

3. **Create `shared/types.js`**
   - JSDoc type definitions
   - Ensure type consistency across codebase

### Phase 2: Storage Layer

1. **Create `background/storage.js`**
   ```javascript
   class StorageManager {
     async getTabState(tabId) {}
     async setTabState(tabId, state) {}
     async addItem(tabId, item) {}
     async removeItem(tabId, itemId) {}
     async clearTab(tabId) {}
     async updateItem(tabId, itemId, updates) {}
     
     // Event emitter for changes
     onChange(callback) {}
   }
   ```

### Phase 3: Capture Logic

1. **Refactor `background/capture.js`**
   - Use StorageManager instead of direct chrome.storage calls
   - Remove duplicate checking (let storage handle it)
   - Simplify header capture flow

2. **Create request deduplication**
   ```javascript
   // Use URL + content-hash as dedupe key
   const dedupeKey = `${url}:${contentHash || 'unknown'}`;
   ```

### Phase 4: HLS Handling

1. **Create `background/hls-parser.js`**
   ```javascript
   export function parseMasterPlaylist(content, baseUrl) {
     // Returns variants array
   }
   
   export function calculateDuration(content) {
     // Returns duration in seconds from media playlist
   }
   
   export async function enrichStreamWithHlsData(stream, tabId) {
     // Fetches via content script, parses, updates stream
   }
   ```

### Phase 5: UI Layer

1. **Create `popup/store.js`**
   ```javascript
   class PopupStore {
     constructor() {
       this.state = {
         items: [],
         selectedStreamId: null,
         selectedSubtitleIds: new Set(),
       };
       this.listeners = new Set();
     }
     
     // Reactive updates
     setState(updates) {
       this.state = { ...this.state, ...updates };
       this.notify();
     }
     
     // Actions
     selectStream(streamId) {}
     toggleSubtitle(subtitleId) {}
     selectAllSubtitles() {}
     deselectAll() {}
     
     // Computed
     get selectedStream() {}
     get selectedSubtitles() {}
     get canGenerateMpv() {}
   }
   ```

2. **Create components**
   - Each component is a pure function: `render(props) -> HTMLElement`
   - No side effects in render
   - Event handlers call store actions

### Phase 6: Integration

1. Wire up message passing between background and popup
2. Add error boundaries and retry logic
3. Implement proper cleanup on tab close

---

## 5. Critical Bug Fixes Needed

### 5.1 Fix Request Deduplication

**Current Issue**: Same URL can be captured multiple times

**Fix**:
```javascript
// In capture.js - use LRU cache for seen URLs
const seenUrls = new LRUCache({ max: 1000, ttl: 60000 });

async function onResponseStarted(details) {
  const dedupeKey = `${details.url}:${details.tabId}`;
  if (seenUrls.has(dedupeKey)) {
    return; // Skip duplicate
  }
  seenUrls.set(dedupeKey, true);
  // ...proceed with capture
}
```

### 5.2 Fix Content Script Injection Race

**Current Issue**: Messages sent before content script ready fail

**Fix**:
```javascript
// In background/capture.js
const contentScriptReady = new Map(); // tabId -> Promise

async function ensureContentScript(tabId) {
  if (!contentScriptReady.has(tabId)) {
    const promise = injectAndVerify(tabId);
    contentScriptReady.set(tabId, promise);
  }
  return contentScriptReady.get(tabId);
}

// On tab navigation, clear the promise
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    contentScriptReady.delete(tabId);
  }
});
```

### 5.3 Fix Header Sanitization

**Current Issue**: Different sanitization in service worker vs content script

**Fix**: Single shared implementation in `shared/headers.js`

### 5.4 Fix Storage Race Conditions

**Current Issue**: Multiple simultaneous saves can lose data

**Fix**: Use chrome.storage with atomic updates via get-set pattern
```javascript
async function atomicUpdate(key, updater) {
  const { [key]: data } = await chrome.storage.local.get(key);
  const newData = updater(data || {});
  await chrome.storage.local.set({ [key]: newData });
}
```

### 5.5 Fix Popup Selection State Loss

**Current Issue**: Selections lost when popup closes

**Fix**: Store selections in chrome.storage.session (or sync with storage)
```javascript
// When selection changes in popup:
await chrome.storage.session.set({
  [`selections_${tabId}`]: {
    streamId: selectedStreamId,
    subtitleIds: Array.from(selectedSubtitleIds)
  }
});
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

- Header sanitization functions
- HLS playlist parsing
- Command builders (mpv, ffmpeg)
- URL deduplication logic

### 6.2 Integration Tests

- Capture flow: Request → Storage → Popup display
- Selection flow: Click → State update → Command generation
- Download flow: Click → Download API → Completion

### 6.3 Manual Test Cases

1. **YouTube**: Play video, verify no duplicate captures
2. **Netflix/Hulu**: Verify stream detection with DRM
3. **HLS with variants**: Master playlist with 5+ quality levels
4. **Subtitles**: Multiple language tracks, verify detection
5. **Tab navigation**: Fast back/forward, verify cleanup
6. **Popup lifecycle**: Open, select, close, reopen - verify persistence

---

## 7. Migration Path

### Option A: Big Bang Rewrite
- Pro: Clean slate, no legacy code
- Con: Risky, long development time
- Recommended: **No** (too risky)

### Option B: Incremental Refactor
1. Phase 1: Extract shared utilities (headers, constants)
2. Phase 2: Create storage abstraction layer
3. Phase 3: Refactor service worker capture logic
4. Phase 4: Refactor popup with new store
5. Phase 5: Remove legacy code

**Recommended: Option B**

---

## 8. Performance Considerations

### 8.1 Current Bottlenecks

1. **HLS Parsing**: Synchronous parsing of large playlists blocks the service worker
2. **Language Detection**: Fetches subtitle content on every popup open
3. **DOM Updates**: Full re-renders on every item detection

### 8.2 Optimizations

1. **Offload HLS parsing** to content script (runs in page context, has more resources)
2. **Cache language detection** persistently (IndexedDB, not just memory)
3. **Virtual scrolling** for long lists (only render visible items)
4. **Debounced updates** - batch multiple detections into single render

---

## 9. Security Considerations

### 9.1 Header Exposure

**Risk**: Captured headers may contain sensitive info (cookies, tokens)

**Mitigations**:
- Never log full headers to console (current code does this!)
- Sanitize before any logging
- Warn user if headers contain sensitive patterns

### 9.2 Content Script Isolation

**Risk**: Content script runs in page context, can be tampered with

**Mitigations**:
- Validate all responses from content script
- Use structured cloning for messages
- Don't trust page-modified data

---

## 10. Summary

The current codebase works but is fragile due to:

1. ❌ Scattered state management
2. ❌ Race conditions in storage
3. ❌ Inconsistent header handling
4. ❌ Complex DOM manipulation
5. ❌ Poor error handling

The rewrite should prioritize:

1. ✅ Single source of truth (storage layer)
2. ✅ Reactive state management (store pattern)
3. ✅ Shared utilities (header sanitization)
4. ✅ Component-based UI
5. ✅ Comprehensive error handling
6. ✅ Test coverage

Estimated effort: **3-4 weeks** for incremental refactor

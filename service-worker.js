// Combined Stream + Subtitle Catcher service worker
import {
  SUBTITLE_MIME_MAP,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  VIDEO_MIME_TYPES,
  HLS_EXTENSIONS,
  HLS_MIME_TYPES,
  FETCH_TIMEOUT_MS,
  M3U8_FETCH_TIMEOUT_MS,
  HEADER_TTL_MS
} from './modules/constants.js';
import { storage } from './modules/storage.js';
import {
  parseHLSMasterPlaylistContent,
  parseHLSMasterPlaylist,
  enrichHlsItem
} from './modules/hls-parser.js';
import {
  urlExtension,
  deriveFilename,
  getHeaderValue,
  headersArrayToObject,
  sanitizeHeaders,
  getSafeHeadersForContentScript,
  resolveUrl,
  formatBitrate,
  formatSize,
  formatDuration,
  extractMediaMetadata
} from './modules/utils.js';
import {
  shellEscapeSingle,
  normalizeFilename,
  buildMpvHeaderOption,
  buildMpvCommand,
  buildFfmpegHeaders,
  getFfmpegLanguageCode,
  buildFfmpegCommand,
  LANGUAGE_CODE_MAP
} from './modules/commands.js';

const pendingReqHeaders = {};
const headerCleanupTimers = new Map();

// Cache for content script ready state per tab to avoid redundant injections
// Cleared on navigation to ensure freshness
const contentScriptReadyCache = new Map();


// Helper function to ensure content script is ready in a tab
async function ensureContentScriptReady(tabId) {
  // BUG FIX (Phase 1): Cache content script ready state per tab to avoid redundant injections
  // This prevents multiple injection attempts when multiple requests come in rapid succession
  if (contentScriptReadyCache.has(tabId)) {
    return contentScriptReadyCache.get(tabId);
  }

  try {
    // Try to ping the content script
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    if (response && response.success) {
      // Cache the ready state for this tab
      contentScriptReadyCache.set(tabId, true);
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
        // Cache the ready state for this tab
        contentScriptReadyCache.set(tabId, true);
        return true;
      }
    } catch (verifyError) {
      console.warn('Content script injection verification failed:', verifyError.message);
    }
  } catch (injectError) {
    console.warn('Failed to inject content script:', injectError.message);
  }

  contentScriptReadyCache.set(tabId, false);
  return false;
}

// Helper function to delay execution
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateBadge(tabId) {
  const counts = await storage.getTabItemCounts(tabId);
  const count = counts.streams + counts.subtitles;
  const text = count > 0 ? String(count) : '';
  try {
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#0077FF', tabId });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
  } catch {}
}

// Keep service worker alive by pinging every 20 seconds
// This prevents it from sleeping and missing webRequest events
let keepAliveInterval = setInterval(() => {
  // Keep-alive ping
}, 20000);

// Clean up interval when service worker terminates
self.addEventListener('beforeunload', () => {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Store headers for response handler
    pendingReqHeaders[details.requestId] = details.requestHeaders || [];
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.webRequest.onResponseStarted.addListener(
  async (details) => {
    const { requestId, url, tabId, responseHeaders = [], statusCode, method } = details;
    const reqHeaders = pendingReqHeaders[requestId] || [];

    // BUG FIX (Phase 1): Use TTL-based cleanup instead of immediate deletion
    // This prevents race conditions where headers are deleted before async operations complete
    // Clear any existing timer for this requestId to avoid duplicate cleanups
    if (headerCleanupTimers.has(requestId)) {
      clearTimeout(headerCleanupTimers.get(requestId));
    }
    // Schedule cleanup after 60 seconds
    headerCleanupTimers.set(requestId, setTimeout(() => {
      delete pendingReqHeaders[requestId];
      headerCleanupTimers.delete(requestId);
    }, HEADER_TTL_MS));

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
    // 2. Check for video files (MP4, WebM, etc.)
    else if (VIDEO_MIME_TYPES.has(contentType) || (ext && VIDEO_EXTENSIONS.has(ext))) {
      kind = 'stream';
      format = ext || contentType.split('/')[1] || 'video';
      mediaType = 'video';
    }
    // 3. Check for subtitles
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

    // Early-exit optimization: Check for duplicates and limits before expensive operations
    // Note: The actual duplicate check inside storage.addItem is the authoritative check
    if (await storage.hasItem(tabId, url, kind)) {
      return;
    }
    if (await storage.isLimitReached(tabId, kind)) {
      return;
    }

    // Extract metadata from URL and headers
    const metadata = extractMediaMetadata(url, responseHeaders, format, size, mediaType);

    const itemData = {
      url, format, name, size, headers: fullHeaders, tabId, timestamp, kind,
      mediaType,
      requestId,
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
        // The content script runs in the page context and can use the page's Origin/Referer headers
        // Pass headers so the content script can use them for authentication
        // Use sanitized headers for content script (browser handles Origin/Referer automatically)
        const safeHeaders = getSafeHeadersForContentScript(fullHeaders);
        console.log('[ServiceWorker] Sending fetchM3U8 message to tab', tabId);
        console.log('[ServiceWorker] URL:', url);
        console.log('[ServiceWorker] Headers being sent:', JSON.stringify(safeHeaders, null, 2));

        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'fetchM3U8',
          url: url,
          headers: safeHeaders
        });

        console.log('[ServiceWorker] Received response from content script:', response);

        if (response && response.success) {
          // Parse the m3u8 content in the service worker (all heavy logic stays here)
          const playlistInfo = parseHLSMasterPlaylistContent(url, response.content);
          await enrichHlsItem(itemData, playlistInfo, tabId, ensureContentScriptReady, getSafeHeadersForContentScript);
        }
      } catch (e) {
        // If content script messaging fails (e.g., content script not loaded yet),
        // fall back to direct fetch (may fail with 403 on some CDNs)
        console.warn('Content script fetch failed, trying fallback:', e);
        try {
          const playlistInfo = await parseHLSMasterPlaylist(url, fullHeaders);
          await enrichHlsItem(itemData, playlistInfo, tabId, ensureContentScriptReady, getSafeHeadersForContentScript);
        } catch (fallbackError) {
          console.warn('Fallback parse also failed:', fallbackError);
        }
      }
    }

    const result = await storage.addItem(tabId, itemData);

    // If storage.addItem returned null, it means the item was a duplicate or limit was reached
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

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // BUG FIX (Phase 1): Clean up content script cache when tab is closed
  contentScriptReadyCache.delete(tabId);
  await storage.clearTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    // BUG FIX (Phase 1): Clear content script ready cache on navigation
    // This ensures content script is re-injected after page navigation
    contentScriptReadyCache.delete(tabId);
    console.log(`[ServiceWorker] Cleared content script cache for tab ${tabId} due to navigation`);

    await storage.clearTab(tabId);
    await updateBadge(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.cmd === 'GET_ITEMS') {
    const tabId = message.tabId;
    storage.getTabItems(tabId).then((items) => {
      sendResponse(items);
    });
    return true;
  }

  if (message.cmd === 'CLEAR_ITEMS') {
    const tabId = message.tabId;
    storage.clearTab(tabId).then(() => {
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

});
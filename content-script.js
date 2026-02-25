// Content script for fetching m3u8 playlists in page context
// This allows the fetch to automatically use the page's Origin and Referer headers
// Acts as a simple proxy - just fetches and returns raw content

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'fetchM3U8' || request.action === 'fetchMediaPlaylist') {
    fetchM3U8Content(request.url, request.headers)
      .then(content => sendResponse({ success: true, content }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

// Forbidden headers that cannot be set via JavaScript fetch (browser-controlled)
// See: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);

// Simple fetch function - just gets the content, no parsing
// headers parameter allows proxying headers from the service worker
async function fetchM3U8Content(url, headers = {}) {
  console.log('[ContentScript] fetchM3U8Content:', url);

  try {
    // Build fetch options
    const fetchOptions = {
      method: 'GET',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000)
    };

    // Filter out forbidden headers that would cause fetch to throw
    const safeHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (!key || value === undefined) continue;
      if (!FORBIDDEN_HEADERS.has(key.toLowerCase())) {
        safeHeaders[key] = value;
      }
    }

    if (Object.keys(safeHeaders).length > 0) {
      fetchOptions.headers = safeHeaders;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    console.error('[ContentScript] fetchM3U8Content failed:', error.message);
    throw error;
  }
}



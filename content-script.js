// Content script for fetching m3u8 playlists in page context
// This allows the fetch to automatically use the page's Origin and Referer headers
// Acts as a simple proxy - just fetches and returns raw content

console.log('[ContentScript] HLS content script loaded - version with debug logging');

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[ContentScript] Received message:', request.action, 'from sender:', sender);

  if (request.action === 'ping') {
    console.log('[ContentScript] Ping received, responding');
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'fetchM3U8') {
    console.log('[ContentScript] fetchM3U8 action received');
    console.log('[ContentScript] URL:', request.url);
    console.log('[ContentScript] Headers received:', JSON.stringify(request.headers, null, 2));
    
    fetchM3U8Content(request.url, request.headers)
      .then(content => {
        console.log('[ContentScript] fetchM3U8 success, content length:', content.length);
        sendResponse({ success: true, content });
      })
      .catch(error => {
        console.error('[ContentScript] fetchM3U8 failed:', error.message);
        console.error('[ContentScript] Error stack:', error.stack);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'fetchMediaPlaylist') {
    console.log('[ContentScript] fetchMediaPlaylist action received');
    console.log('[ContentScript] URL:', request.url);
    console.log('[ContentScript] Headers received:', JSON.stringify(request.headers, null, 2));
    
    fetchM3U8Content(request.url, request.headers)
      .then(content => {
        console.log('[ContentScript] fetchMediaPlaylist success, content length:', content.length);
        sendResponse({ success: true, content });
      })
      .catch(error => {
        console.error('[ContentScript] fetchMediaPlaylist failed:', error.message);
        console.error('[ContentScript] Error stack:', error.stack);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

// Simple fetch function - just gets the content, no parsing
// headers parameter allows proxying headers from the service worker
async function fetchM3U8Content(url, headers = {}) {
  console.log('[ContentScript] fetchM3U8Content called');
  console.log('[ContentScript] URL:', url);
  console.log('[ContentScript] Raw headers object:', headers);
  console.log('[ContentScript] Header keys:', Object.keys(headers));

  try {
    // Build fetch options
    const fetchOptions = {
      method: 'GET',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000)
    };
    console.log('[ContentScript] Initial fetchOptions:', JSON.stringify(fetchOptions, null, 2));

    // Check if we have any headers to process
    const headerKeys = Object.keys(headers || {});
    console.log('[ContentScript] Number of headers to process:', headerKeys.length);

    if (headerKeys.length > 0) {
      console.log('[ContentScript] Processing headers...');

      // Build headers object - pass through most headers
      // The browser will silently ignore headers it doesn't allow (like User-Agent in some cases)
      const safeHeaders = {};

      // BUG FIX (Phase 1): Content script filters FORBIDDEN_HEADERS
      // Service worker now passes ALL headers, content script filters what it can't use.
      // These are forbidden header names that cannot be set via JavaScript fetch.
      // See: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
      const forbiddenHeaders = new Set([
        'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
        'connection', 'content-length', 'cookie', 'cookie2', 'date', 'expect', 'host', 'keep-alive',
        'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
      ]);
      
      for (const [key, value] of Object.entries(headers)) {
        console.log(`[ContentScript] Processing header: "${key}" = "${value}"`);
        
        if (!key || value === undefined) {
          console.log(`[ContentScript] Skipping empty header: ${key}`);
          continue;
        }
        
        const lowerKey = key.toLowerCase();
        
        // Skip headers that would cause fetch to throw
        if (forbiddenHeaders.has(lowerKey)) {
          console.log(`[ContentScript] Header "${key}" is FORBIDDEN, skipping`);
          continue;
        }
        
        console.log(`[ContentScript] Header "${key}" is ALLOWED`);
        safeHeaders[key] = value;
      }
      
      console.log('[ContentScript] Safe headers to use:', JSON.stringify(safeHeaders, null, 2));
      
      // Add headers to fetch options (browser will handle which ones it actually sends)
      const safeHeaderKeys = Object.keys(safeHeaders);
      if (safeHeaderKeys.length > 0) {
        fetchOptions.headers = safeHeaders;
        console.log('[ContentScript] Added headers to fetchOptions');
      } else {
        console.log('[ContentScript] No valid headers to add, using default fetch');
      }
    } else {
      console.log('[ContentScript] No headers provided, using default fetch');
    }

    console.log('[ContentScript] Final fetchOptions:', JSON.stringify(fetchOptions, null, 2));
    console.log('[ContentScript] About to call fetch...');

    const response = await fetch(url, fetchOptions);

    console.log('[ContentScript] Fetch completed');
    console.log('[ContentScript] Response status:', response.status);
    console.log('[ContentScript] Response statusText:', response.statusText);
    console.log('[ContentScript] Response headers:', [...response.headers.entries()]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    console.log('[ContentScript] Content received, length:', content.length);
    return content;
  } catch (error) {
    console.error('[ContentScript] Exception in fetchM3U8Content:', error.message);
    console.error('[ContentScript] Error name:', error.name);
    console.error('[ContentScript] Error stack:', error.stack);
    throw error;
  }
}

console.log('[ContentScript] Content script setup complete');

// Content script for fetching m3u8 playlists in page context
// This allows the fetch to automatically use the page's Origin and Referer headers
// Acts as a simple proxy - just fetches and returns raw content

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchM3U8') {
    fetchM3U8Content(request.url)
      .then(content => sendResponse({ success: true, content }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'fetchMediaPlaylist') {
    console.log('[ContentScript] fetchMediaPlaylist action received for:', request.url);
    fetchM3U8Content(request.url)
      .then(content => {
        console.log('[ContentScript] Media playlist fetched successfully, length:', content.length);
        sendResponse({ success: true, content });
      })
      .catch(error => {
        console.error('[ContentScript] Media playlist fetch failed:', error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

// Simple fetch function - just gets the content, no parsing
async function fetchM3U8Content(url) {
  console.log('[ContentScript] Fetching m3u8:', url);

  // Fetch in page context - automatically gets proper Origin/Referer headers
  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(10000)
  });

  console.log('[ContentScript] Fetch response status:', response.status);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const content = await response.text();
  return content;
}

console.log('[ContentScript] HLS content script loaded');

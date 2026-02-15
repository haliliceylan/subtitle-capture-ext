// Combined Stream + Subtitle Catcher service worker
const SUBTITLE_MIME_MAP = {
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

const SUBTITLE_EXTENSIONS = new Set(['vtt', 'srt', 'ass', 'ssa', 'sub', 'ttml', 'dfxp', 'sbv', 'stl', 'lrc', 'smi']);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv']);
const VIDEO_MIME_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/x-matroska', 'video/avi', 'video/quicktime',
  'video/x-flv', 'video/x-ms-wmv', 'video/3gpp', 'video/ogg', 'video/mpeg'
]);

const HLS_EXTENSIONS = new Set(['m3u8', 'm3u']);
const HLS_MIME_TYPES = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl']);

const DASH_EXTENSIONS = new Set(['mpd']);
const DASH_MIME_TYPES = new Set([
  'application/dash+xml',
  'application/vnd.mpeg.dash.mpd'
]);

const STRIP_HEADERS = new Set([
  'range', 'content-length', 'content-type', 'accept-encoding', 'accept', 'accept-language',
  'upgrade-insecure-requests', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'cache-control', 'pragma'
]);

const pendingReqHeaders = {};

// Queue to prevent race conditions when saving items
const saveQueue = {};
async function queuedSave(key, requestId, itemData) {
  // Create queue for this key if it doesn't exist
  if (!saveQueue[key]) {
    saveQueue[key] = Promise.resolve();
  }
  
  // Chain this save operation
  saveQueue[key] = saveQueue[key].then(async () => {
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};
    items[requestId] = itemData;
    await chrome.storage.local.set({ [key]: items });
    return items;
  });
  
  return saveQueue[key];
}

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

function getHeaderValue(responseHeaders, name) {
  const target = name.toLowerCase();
  for (const h of responseHeaders) {
    if (h.name.toLowerCase() === target) {
      return (h.value || '').split(';')[0].trim().toLowerCase();
    }
  }
  return '';
}

function sanitizeHeaders(reqHeaders) {
  const headers = {};
  for (const h of reqHeaders) {
    const k = h.name || '';
    if (!k) continue;
    if (!STRIP_HEADERS.has(k.toLowerCase())) {
      headers[k] = h.value || '';
    }
  }
  return headers;
}

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

function shellEscapeSingle(value) {
  return String(value).replace(/'/g, `'\\''`);
}

function buildMpvHeaderOption(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '';
  const joined = entries.map(([k, v]) => `${k}: ${v}`).join(',');
  return `--http-header-fields='${shellEscapeSingle(joined)}'`;
}

function buildMpvCommand(streamItem, subtitleItems = []) {
  const streamUrl = streamItem?.url;
  if (!streamUrl) return '';
  
  // Build header option for stream (applies to all requests including subtitles)
  const headerOpt = buildMpvHeaderOption(streamItem.headers || {});
  
  // Build subtitle options - each subtitle gets its own --sub-file flag
  // If subtitle needs auth headers, they're included in the main header option
  const subOpts = subtitleItems
    .filter((s) => s?.url)
    .map((s, idx) => {
      // Add subtitle-specific headers if they differ from stream headers
      const subHeaders = s.headers || {};
      const needsCustomHeaders = Object.keys(subHeaders).length > 0 && 
                                  JSON.stringify(subHeaders) !== JSON.stringify(streamItem.headers || {});
      
      if (needsCustomHeaders) {
        // For subtitles with different headers, use http-header-fields per subtitle
        const subHeaderOpt = buildMpvHeaderOption(subHeaders).replace('--http-header-fields=', '');
        return `--sub-file='${shellEscapeSingle(s.url)}' --sub-file-paths='' --http-header-fields=${subHeaderOpt}`;
      }
      return `--sub-file='${shellEscapeSingle(s.url)}'`;
    })
    .join(' ');
  
  return [
    'mpv',
    headerOpt,
    `--force-window=immediate`,
    `--sub-auto=fuzzy`,  // Auto-load subtitles with similar names
    subOpts,
    `'${shellEscapeSingle(streamUrl)}'`
  ].filter(Boolean).join(' ');
}

function buildFfmpegHeaders(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '';
  // Format: 'Header1: value1\r\nHeader2: value2\r\n'
  const joined = entries.map(([k, v]) => `${k}: ${v}`).join('\r\n');
  return `-headers '${shellEscapeSingle(joined + '\r\n')}'`;
}

function buildFfmpegCommand(streamItem, subtitleItems = []) {
  const streamUrl = streamItem?.url;
  if (!streamUrl) return '';
  
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
  
  // Add output options
  parts.push('-c copy');
  
  // If we have subtitles, configure subtitle codec for mp4 container
  if (validSubtitles.length > 0) {
    parts.push('-c:s mov_text');
  }
  
  // Output filename
  parts.push('output.mp4');
  
  return parts.filter(Boolean).join(' ');
}

async function downloadVideo(url, filename, headers = {}) {
  // Build headers array for chrome.downloads API
  const headerArray = Object.entries(headers).map(([name, value]) => ({ name, value }));
  
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
    delete pendingReqHeaders[requestId];

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

    const headers = sanitizeHeaders(reqHeaders);
    const timestamp = Date.now();
    const name = deriveFilename(url, responseHeaders, kind === 'stream' ? 'stream.m3u8' : 'subtitle');
    const key = kind === 'stream' ? `streams_${tabId}` : `subs_${tabId}`;

    // Check for duplicates before queuing
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};
    
    if (Object.values(items).some((item) => item.url === url)) {
      return;
    }
    if (Object.keys(items).length >= 50) {
      return;
    }

    // Extract metadata from URL and headers
    const metadata = extractMediaMetadata(url, responseHeaders, format, size, mediaType);

    const itemData = {
      url, format, name, size, headers, tabId, timestamp, kind,
      mediaType,
      ...metadata
    };
    
    await queuedSave(key, requestId, itemData);
    
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
  await chrome.storage.local.remove([`subs_${tabId}`, `streams_${tabId}`]);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    await chrome.storage.local.remove([`subs_${tabId}`, `streams_${tabId}`]);
    await updateBadge(tabId);
  }
});

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
    const { streamItem, subtitleItems } = message;
    sendResponse({ command: buildFfmpegCommand(streamItem, subtitleItems || []) });
    return true;
  }

  if (message.cmd === 'DOWNLOAD_VIDEO') {
    const { url, filename, headers } = message;
    downloadVideo(url, filename, headers)
      .then(downloadId => sendResponse({ success: true, downloadId }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
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
    if (Object.keys(items).length >= 50) {
      return null; // Max items reached, skip saving
    }

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

// Resolve relative URL to absolute URL
function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
}

// Format bandwidth (bps) to human-readable string
function formatBitrate(bps) {
  if (!bps || bps <= 0) return null;
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(1)}Mbps`;
  } else if (bps >= 1000) {
    return `${Math.round(bps / 1000)}Kbps`;
  }
  return `${bps}bps`;
}

// Format size in bytes to human-readable string
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

// Format duration in seconds to human-readable string (e.g., "2h 15m" or "45m 30s")
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

// Fetch and parse media playlist to calculate total duration
async function getMediaPlaylistDuration(mediaUrl, tabId) {
  console.log('[DEBUG] Fetching media playlist duration via content script:', mediaUrl);

  try {
    // Send message to content script to fetch the media playlist
    // The content script runs in the page context and can use the page's Origin/Referer headers
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'fetchMediaPlaylist',
      url: mediaUrl
    });

    if (!response || !response.success) {
      console.warn('[DEBUG] Media playlist fetch failed:', response?.error || 'Unknown error');
      return null;
    }

    console.log('[DEBUG] Media playlist fetched successfully, parsing duration...');

    const content = response.content;
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);

    let totalDuration = 0;
    let segmentCount = 0;

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        // Parse duration from #EXTINF:10.000, or #EXTINF:10,
        const durationMatch = line.match(/#EXTINF:([\d.]+)/);
        if (durationMatch) {
          totalDuration += parseFloat(durationMatch[1]);
          segmentCount++;
        }
      }
    }

    console.log(`[DEBUG] Parsed media playlist: ${segmentCount} segments, total duration: ${totalDuration}s`);

    return totalDuration > 0 ? totalDuration : null;
  } catch (error) {
    console.warn('[DEBUG] Failed to fetch media playlist duration:', error);
    return null;
  }
}

// Parse codec string to extract video codec
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

// Derive display name for variant
function deriveVariantName(variant) {
  const parts = [];
  if (variant.resolution) parts.push(variant.resolution);
  if (variant.codec && variant.codec !== 'AAC' && variant.codec !== 'Opus') parts.push(variant.codec);
  if (variant.bitrate) parts.push(variant.bitrate);
  
  if (parts.length === 0) return 'Default';
  return parts.join(' · ');
}

// Parse HLS master playlist content (used when content is already fetched)
function parseHLSMasterPlaylistContent(url, content) {
  try {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);

    // Check if this is a master playlist
    if (!lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
      // Not a master playlist (might be a media playlist)
      return { isMasterPlaylist: false, variants: [] };
    }

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
          codecs: currentVariant.codecs,
          frameRate: currentVariant.frameRate
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

// Parse HLS master playlist and extract variant streams (fetches content directly)
async function parseHLSMasterPlaylist(url, headers = {}) {
  try {
    // DEBUG: Log headers being used for fetch
    console.log('[DEBUG] parseHLSMasterPlaylist called with URL:', url);
    console.log('[DEBUG] Headers passed to function:', JSON.stringify(headers, null, 2));

    // Fetch the playlist content using the exact same headers from the original request
    // headers is already sanitized from sanitizeHeaders()
    const fetchHeaders = new Headers();
    Object.entries(headers).forEach(([k, v]) => {
      if (k && v !== undefined) {
        fetchHeaders.set(k, v);
      }
    });

    // DEBUG: Log headers actually being sent
    const headersSent = {};
    fetchHeaders.forEach((v, k) => { headersSent[k] = v; });
    console.log('[DEBUG] Headers being sent in fetch:', JSON.stringify(headersSent, null, 2));

    const response = await fetch(url, {
      method: 'GET',
      headers: fetchHeaders,
      signal: AbortSignal.timeout(5000),
      referrer: headers.Referer || headers.referer || '',
      referrerPolicy: 'no-referrer-when-downgrade'
    });

    console.log('[DEBUG] Fetch response status:', response.status);

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

function normalizeFilename(title) {
  if (!title || !title.trim()) return 'output';
  return title
    .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim()
    .replace(/\.$/, '')             // Remove trailing period
    .substring(0, 100);             // Limit length
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

// Language code mapping for ffmpeg (ISO 639-2 codes where available)
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

function getFfmpegLanguageCode(langCode) {
  if (!langCode) return null;
  const normalized = langCode.toLowerCase();
  return LANGUAGE_CODE_MAP[normalized] || LANGUAGE_CODE_MAP[normalized.split('-')[0]] || normalized;
}

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
    
    // DEBUG: Log captured headers for HLS requests
    const url = details.url || '';
    if (url.includes('.m3u8') || url.includes('.m3u')) {
      console.log('[DEBUG] onBeforeSendHeaders captured for:', url);
      const headerNames = (details.requestHeaders || []).map(h => h.name);
      console.log('[DEBUG] Captured header names:', headerNames);
      const originHeader = (details.requestHeaders || []).find(h => h.name.toLowerCase() === 'origin');
      const refererHeader = (details.requestHeaders || []).find(h => h.name.toLowerCase() === 'referer');
      console.log('[DEBUG] Origin header:', originHeader ? originHeader.value : 'NOT PRESENT');
      console.log('[DEBUG] Referer header:', refererHeader ? refererHeader.value : 'NOT PRESENT');
    }
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

    // Early-exit optimization: Check for duplicates and limits before expensive operations
    // Note: The actual duplicate check inside queuedSave is the authoritative check
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
    
    // For HLS streams, check if it's a master playlist and parse variants
    if (mediaType === 'hls') {
      try {
        console.log('[DEBUG] About to fetch m3u8 via content script for:', url);

        // Send message to content script in the specific tab to fetch the m3u8
        // The content script runs in the page context and can use the page's Origin/Referer headers
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'fetchM3U8',
          url: url
        });

        console.log('[DEBUG] Content script response:', response);

        if (response && response.success) {
          // Parse the m3u8 content in the service worker (all heavy logic stays here)
          const playlistInfo = parseHLSMasterPlaylistContent(url, response.content);
          if (playlistInfo.isMasterPlaylist && playlistInfo.variants.length > 0) {
            itemData.isMasterPlaylist = true;
            itemData.variants = playlistInfo.variants;
            // Update name to indicate it's a master playlist
            itemData.name = name.replace(/\.m3u8$/i, '') + ' (Master)';
            
            // Fetch duration from the first variant (highest quality, already sorted by bandwidth)
            const firstVariant = playlistInfo.variants[0];
            if (firstVariant && firstVariant.url) {
              try {
                const duration = await getMediaPlaylistDuration(firstVariant.url, tabId);
                if (duration) {
                  itemData.duration = duration;
                  itemData.durationFormatted = formatDuration(duration);

                  // Calculate estimated size for each variant
                  itemData.variants = playlistInfo.variants.map(variant => {
                    if (variant.bandwidth && duration) {
                      const estimatedSizeBytes = (duration * variant.bandwidth) / 8;
                      variant.estimatedSize = estimatedSizeBytes;
                      variant.estimatedSizeFormatted = formatSize(estimatedSizeBytes);
                      console.log(`[DEBUG] Calculated size for variant ${variant.resolution || 'unknown'}: ${variant.estimatedSizeFormatted} (${estimatedSizeBytes} bytes)`);
                    }
                    return variant;
                  });

                  console.log(`[DEBUG] HLS duration: ${duration}s, formatted: ${itemData.durationFormatted}`);
                } else {
                  console.warn('[DEBUG] No duration returned from media playlist');
                }
              } catch (durationError) {
                console.warn('Failed to fetch duration for HLS stream:', durationError);
              }
            }
          }
        }
      } catch (e) {
        // If content script messaging fails (e.g., content script not loaded yet),
        // fall back to direct fetch (may fail with 403 on some CDNs)
        console.warn('Content script fetch failed, trying fallback:', e);
        try {
          const playlistInfo = await parseHLSMasterPlaylist(url, headers);
          if (playlistInfo.isMasterPlaylist && playlistInfo.variants.length > 0) {
            itemData.isMasterPlaylist = true;
            itemData.variants = playlistInfo.variants;
            itemData.name = name.replace(/\.m3u8$/i, '') + ' (Master)';

            // Fetch duration from the first variant (highest quality, already sorted by bandwidth)
            const firstVariant = playlistInfo.variants[0];
            if (firstVariant && firstVariant.url) {
              try {
                const duration = await getMediaPlaylistDuration(firstVariant.url, tabId);
                if (duration) {
                  itemData.duration = duration;
                  itemData.durationFormatted = formatDuration(duration);

                  // Calculate estimated size for each variant
                  itemData.variants = playlistInfo.variants.map(variant => {
                    if (variant.bandwidth && duration) {
                      const estimatedSizeBytes = (duration * variant.bandwidth) / 8;
                      variant.estimatedSize = estimatedSizeBytes;
                      variant.estimatedSizeFormatted = formatSize(estimatedSizeBytes);
                      console.log(`[DEBUG] Calculated size for variant ${variant.resolution || 'unknown'}: ${variant.estimatedSizeFormatted} (${estimatedSizeBytes} bytes)`);
                    }
                    return variant;
                  });

                  console.log(`[DEBUG] HLS duration (fallback): ${duration}s, formatted: ${itemData.durationFormatted}`);
                } else {
                  console.warn('[DEBUG] No duration returned from media playlist (fallback)');
                }
              } catch (durationError) {
                console.warn('Failed to fetch duration for HLS stream (fallback):', durationError);
              }
            }
          }
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
});
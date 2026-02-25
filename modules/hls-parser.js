/**
 * HLS Parser Module for Stream + Subtitle Catcher Extension
 * Handles all HLS playlist parsing logic including master playlists,
 * variant extraction, codec parsing, and duration calculation.
 * @module modules/hls-parser
 */

import { FORBIDDEN_HEADERS, FETCH_TIMEOUT_MS } from './constants.js';
import { storage } from './storage.js';
import { resolveUrl, formatBitrate, formatSize, formatDuration } from './utils.js';

/**
 * Helper function to delay execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse codec string to extract video codec
 * @param {string} codecsString - Comma-separated codec string from HLS playlist
 * @returns {string|null} Video codec identifier (e.g., "H264", "H265", "VP9", "AV1")
 */
export function parseCodec(codecsString) {
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

/**
 * Parse audio codec from codecs string
 * @param {string} codecsString - Comma-separated codec string from HLS playlist
 * @returns {string|null} Audio codec identifier (e.g., "AAC", "Opus", "AC3")
 */
export function parseAudioCodec(codecsString) {
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

/**
 * Parse audio groups from #EXT-X-MEDIA tags
 * @param {string[]} lines - Array of playlist lines
 * @returns {Map<string, string[]>} Map of group-id to array of audio track languages
 */
export function parseAudioGroups(lines) {
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

/**
 * Derive display name for variant
 * @param {Object} variant - Variant object with resolution, codec, bitrate properties
 * @param {string} [variant.resolution] - Resolution string (e.g., "1080p")
 * @param {string} [variant.codec] - Codec identifier
 * @param {string} [variant.bitrate] - Formatted bitrate string
 * @returns {string} Display name for the variant
 */
export function deriveVariantName(variant) {
  const parts = [];
  if (variant.resolution) parts.push(variant.resolution);
  if (variant.codec && variant.codec !== 'AAC' && variant.codec !== 'Opus') parts.push(variant.codec);
  if (variant.bitrate) parts.push(variant.bitrate);

  if (parts.length === 0) return 'Default';
  return parts.join(' · ');
}

/**
 * Fetch and parse media playlist to calculate total duration
 * Requires dependencies from the service worker for content script communication
 * @param {string} mediaUrl - URL of the media playlist
 * @param {number} tabId - Tab ID for content script communication
 * @param {Object} headers - Headers to use for fetching
 * @param {Function} ensureContentScriptReady - Function to ensure content script is ready
 * @param {Function} getSafeHeadersForContentScript - Function to get safe headers for content script
 * @param {number} [retries=3] - Number of retry attempts
 * @returns {Promise<number|null>} Total duration in seconds, or null if calculation fails
 */
export async function getMediaPlaylistDuration(
  mediaUrl,
  tabId,
  headers = {},
  ensureContentScriptReady,
  getSafeHeadersForContentScript,
  retries = 3
) {
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

      // Send message to content script to fetch the media playlist
      // The content script runs in the page context and can use the page's Origin/Referer headers
      // Sanitize headers for content script (browser handles Origin/Referer automatically)
      const safeHeaders = getSafeHeadersForContentScript(headers);
      console.log('[HLS Parser] Sending fetchMediaPlaylist message to tab', tabId);
      console.log('[HLS Parser] URL:', mediaUrl);
      console.log('[HLS Parser] Headers being sent:', JSON.stringify(safeHeaders, null, 2));

      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'fetchMediaPlaylist',
        url: mediaUrl,
        headers: safeHeaders
      });

      console.log('[HLS Parser] Received response from content script:', response);

      if (!response || !response.success) {
        lastError = new Error(response?.error || 'Unknown error');
        continue;
      }

      const content = response.content;
      const lines = content.split('\n').map(l => l.trim()).filter(l => l);

      let totalDuration = 0;

      for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
          // Parse duration from #EXTINF:10.000, or #EXTINF:10,
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

  console.warn('[HLS Parser] Failed to get media playlist duration after', retries, 'attempts:', lastError?.message);
  return null;
}

/**
 * Parse HLS master playlist content (used when content is already fetched)
 * @param {string} url - URL of the playlist
 * @param {string} content - Raw playlist content
 * @returns {Object} Parsed playlist info with isMasterPlaylist flag and variants array
 */
export function parseHLSMasterPlaylistContent(url, content) {
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
    console.warn('[HLS Parser] Failed to parse HLS master playlist content:', error);
    return { isMasterPlaylist: false, variants: [], error: error.message };
  }
}

/**
 * Parse HLS master playlist and extract variant streams (fetches content directly)
 * @param {string} url - URL of the playlist
 * @param {Object} [headers={}] - Headers to use for fetching
 * @returns {Promise<Object>} Parsed playlist info with isMasterPlaylist flag and variants array
 */
export async function parseHLSMasterPlaylist(url, headers = {}) {
  try {
    // Fetch the playlist content using the exact same headers from the original request
    // headers is already sanitized from sanitizeHeaders()
    const fetchHeaders = new Headers();
    Object.entries(headers).forEach(([k, v]) => {
      if (k && v !== undefined) {
        // Skip forbidden headers that cannot be set via JavaScript
        // These are browser-controlled headers that will cause "Unsafe header" errors
        if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) {
          try {
            fetchHeaders.set(k, v);
          } catch (e) {
            // Silently skip headers that can't be set (e.g., invalid header names)
            console.warn('[HLS Parser] Skipping header that cannot be set:', k);
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
    console.warn('[HLS Parser] Failed to parse HLS master playlist:', error);
    return { isMasterPlaylist: false, variants: [], error: error.message };
  }
}

/**
 * Enrich HLS item data with duration and estimated sizes for variants
 * Requires dependencies from the service worker for content script communication
 * @param {Object} itemData - The HLS item data object to enrich
 * @param {Object} playlistInfo - Parsed playlist info from parseHLSMasterPlaylistContent
 * @param {number} tabId - Tab ID for content script communication
 * @param {Function} ensureContentScriptReady - Function to ensure content script is ready
 * @param {Function} getSafeHeadersForContentScript - Function to get safe headers for content script
 * @returns {Promise<Object>} Enriched item data
 */
export async function enrichHlsItem(
  itemData,
  playlistInfo,
  tabId,
  ensureContentScriptReady,
  getSafeHeadersForContentScript
) {
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
      const duration = await getMediaPlaylistDuration(
        firstVariant.url,
        tabId,
        itemData.headers,
        ensureContentScriptReady,
        getSafeHeadersForContentScript
      );
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
      console.warn('[HLS Parser] Failed to fetch duration for HLS stream:', durationError);
    }
  }

  return itemData;
}

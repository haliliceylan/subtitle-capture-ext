/**
 * Shared utility functions for the Stream + Subtitle Catcher extension.
 * @module utils
 */

import { STRIP_HEADERS } from './constants.js';

/**
 * Extracts the file extension from a URL.
 * @param {string} url - The URL to extract extension from.
 * @returns {string|null} The file extension in lowercase, or null if not found.
 */
export function urlExtension(url) {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('.');
    if (parts.length < 2) return null;
    return parts[parts.length - 1].toLowerCase().split('/')[0];
  } catch {
    return null;
  }
}

/**
 * Derives a filename from URL and response headers.
 * Falls back to a default name if no filename can be determined.
 * @param {string} url - The URL of the resource.
 * @param {Array<{name: string, value: string}>} responseHeaders - Response headers array.
 * @param {string} [fallback='media'] - Fallback filename if none can be derived.
 * @returns {string} The derived filename.
 */
export function deriveFilename(url, responseHeaders, fallback = 'media') {
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

/**
 * Gets a header value from response headers (case-insensitive).
 * @param {Array<{name: string, value: string}>} responseHeaders - Response headers array.
 * @param {string} name - The header name to search for.
 * @returns {string} The header value (content-type only, stripped of charset), or empty string.
 */
export function getHeaderValue(responseHeaders, name) {
  const target = name.toLowerCase();
  for (const h of responseHeaders) {
    if (h.name.toLowerCase() === target) {
      return (h.value || '').split(';')[0].trim().toLowerCase();
    }
  }
  return '';
}

/**
 * Converts headers array to a plain object (keeps ALL headers).
 * @param {Array<{name: string, value: string}>} reqHeaders - Request headers array.
 * @returns {Object.<string, string>} Headers as a key-value object.
 */
export function headersArrayToObject(reqHeaders) {
  const headers = {};
  for (const h of reqHeaders) {
    const k = h.name || '';
    if (!k) continue;
    headers[k] = h.value || '';
  }
  return headers;
}

/**
 * Sanitizes headers by stripping response-related headers (STRIP_HEADERS).
 * This is the canonical header sanitization function used throughout the extension.
 * @param {Object.<string, string>} headers - Headers object.
 * @returns {Object.<string, string>} Sanitized headers object.
 */
function stripStripHeaders(headers) {
  const sanitized = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!k) continue;
    if (!STRIP_HEADERS.has(k.toLowerCase())) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/**
 * Sanitizes headers for content script fetch.
 * Converts headers array to object while stripping response-related headers (STRIP_HEADERS).
 * @param {Array<{name: string, value: string}>} reqHeaders - Request headers array.
 * @returns {Object.<string, string>} Sanitized headers object.
 */
export function sanitizeHeaders(reqHeaders) {
  const headers = {};
  for (const h of reqHeaders || []) {
    const k = h.name || '';
    if (k) headers[k] = h.value || '';
  }
  return stripStripHeaders(headers);
}

/**
 * Gets headers for content script from stored full headers object.
 * Only strips response-related headers (STRIP_HEADERS).
 * @param {Object.<string, string>} fullHeaders - Full headers object.
 * @returns {Object.<string, string>} Safe headers for content script.
 */
export function getSafeHeadersForContentScript(fullHeaders) {
  return stripStripHeaders(fullHeaders);
}

/**
 * Resolves a relative URL to an absolute URL.
 * @param {string} baseUrl - The base URL.
 * @param {string} relativeUrl - The relative URL to resolve.
 * @returns {string} The absolute URL, or the relative URL if resolution fails.
 */
export function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
}

/**
 * Formats bitrate in bps to human-readable string.
 * @param {number} bps - Bitrate in bits per second.
 * @returns {string|null} Formatted bitrate string (e.g., "1.5Mbps", "500Kbps"), or null if invalid.
 */
export function formatBitrate(bps) {
  if (!bps || bps <= 0) return null;
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(1)}Mbps`;
  } else if (bps >= 1000) {
    return `${Math.round(bps / 1000)}Kbps`;
  }
  return `${bps}bps`;
}

/**
 * Formats size in bytes to human-readable string.
 * @param {number} bytes - Size in bytes.
 * @returns {string|null} Formatted size string (e.g., "1.5 MB", "500 KB"), or null if invalid.
 */
export function formatSize(bytes) {
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

/**
 * Formats duration in seconds to human-readable string.
 * @param {number} seconds - Duration in seconds.
 * @returns {string|null} Formatted duration string (e.g., "2h 15m", "45m 30s"), or null if invalid.
 */
export function formatDuration(seconds) {
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

/**
 * Extracts media metadata from URL and headers.
 * @param {string} url - The media URL.
 * @param {Array<{name: string, value: string}>} responseHeaders - Response headers array.
 * @param {string} format - The media format.
 * @param {number} size - Content size in bytes.
 * @param {string} mediaType - The media type (hls, dash, video).
 * @returns {Object} Extracted metadata object with properties like resolution, quality, codec, etc.
 */
export function extractMediaMetadata(url, responseHeaders, format, size, mediaType) {
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

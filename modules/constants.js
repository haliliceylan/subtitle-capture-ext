/**
 * Shared Constants Module for Stream + Subtitle Catcher Extension
 * @module modules/constants
 */

/**
 * MIME type to subtitle extension mapping.
 * Maps MIME types to their corresponding subtitle file extensions.
 * Values can be null for generic types that need further detection.
 * @constant {Object<string, string|null>}
 */
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

/**
 * Common subtitle file extensions.
 * Used for URL-based subtitle detection.
 * @constant {Set<string>}
 */
export const SUBTITLE_EXTENSIONS = new Set(['vtt', 'srt', 'ass', 'ssa', 'sub', 'ttml', 'dfxp', 'sbv', 'stl', 'lrc', 'smi']);

/**
 * Video file extensions.
 * Used for direct video file detection from URLs.
 * @constant {Set<string>}
 */
export const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv']);

/**
 * Video MIME types.
 * Used for content-type based video detection.
 * @constant {Set<string>}
 */
export const VIDEO_MIME_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/x-matroska', 'video/avi', 'video/quicktime',
  'video/x-flv', 'video/x-ms-wmv', 'video/3gpp', 'video/ogg', 'video/mpeg'
]);

/**
 * HLS (HTTP Live Streaming) file extensions.
 * Used for detecting HLS playlist files.
 * @constant {Set<string>}
 */
export const HLS_EXTENSIONS = new Set(['m3u8', 'm3u']);

/**
 * HLS MIME types.
 * Used for content-type based HLS stream detection.
 * @constant {Set<string>}
 */
export const HLS_MIME_TYPES = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl']);

/**
 * DASH (Dynamic Adaptive Streaming over HTTP) file extensions.
 * Used for detecting DASH manifest files.
 * @constant {Set<string>}
 */
export const DASH_EXTENSIONS = new Set(['mpd']);

/**
 * DASH MIME types.
 * Used for content-type based DASH stream detection.
 * @constant {Set<string>}
 */
export const DASH_MIME_TYPES = new Set([
  'application/dash+xml',
  'application/vnd.mpeg.dash.mpd'
]);

/**
 * Headers to strip from requests.
 * These headers are removed when forwarding requests to avoid conflicts.
 * @constant {Set<string>}
 */
export const STRIP_HEADERS = new Set([
  'range', 'content-length', 'content-type', 'accept-encoding',
  'upgrade-insecure-requests', 'cache-control', 'pragma'
]);

/**
 * Forbidden headers that cannot be set via JavaScript fetch (browser-controlled).
 * See: https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
 * Note: We allow some headers like dnt, user-agent, sec-fetch-* to be passed through.
 * The browser will silently ignore headers it doesn't allow.
 * This is still needed for chrome.downloads API which can't handle forbidden headers.
 * @constant {Set<string>}
 */
export const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
  'connection', 'content-length', 'cookie', 'cookie2', 'date', 'expect', 'host', 'keep-alive',
  'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
]);

/**
 * Maximum number of captured items to store per tab.
 * Prevents excessive memory usage.
 * @constant {number}
 */
export const MAX_ITEMS_PER_TAB = 50;

/**
 * Default timeout for fetch operations in milliseconds.
 * @constant {number}
 */
export const FETCH_TIMEOUT_MS = 5000;

/**
 * Extended timeout for m3u8 playlist fetch operations in milliseconds.
 * HLS playlists may need more time due to network conditions.
 * @constant {number}
 */
export const M3U8_FETCH_TIMEOUT_MS = 10000;

/**
 * Time-to-live for pending request headers in milliseconds.
 * Headers are kept for 60 seconds before cleanup to ensure async operations can access them.
 * Used for TTL-based cleanup to prevent race conditions.
 * @constant {number}
 */
export const HEADER_TTL_MS = 60000;

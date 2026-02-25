/**
 * MPV and FFmpeg command builders for the Stream + Subtitle Catcher extension.
 * @module commands
 */

/**
 * Escapes a string for safe use within single quotes in shell commands.
 * @param {string} value - The string to escape.
 * @returns {string} The escaped string.
 */
export function shellEscapeSingle(value) {
  return String(value).replace(/'/g, `'\\''`);
}

/**
 * Normalizes a filename by removing invalid characters and limiting length.
 * @param {string} title - The original filename/title.
 * @returns {string} The normalized filename.
 */
export function normalizeFilename(title) {
  if (!title || !title.trim()) return 'output';
  return title
    .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim()
    .replace(/\.$/, '')             // Remove trailing period
    .substring(0, 100);             // Limit length
}

/**
 * Builds mpv HTTP header option string.
 * Format: --http-header-fields='Header1: value1','Header2: value2'
 * @param {Object.<string, string>} headers - Headers object.
 * @returns {string} The mpv header option string, or empty string if no headers.
 */
export function buildMpvHeaderOption(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '';
  // Format headers as comma-separated quoted strings
  // Format: --http-header-fields='Header1: value1','Header2: value2'
  const quotedHeaders = entries.map(([k, v]) => `'${shellEscapeSingle(k)}: ${shellEscapeSingle(v)}'`).join(',');
  return `--http-header-fields=${quotedHeaders}`;
}

/**
 * Builds an mpv command string for playing a stream with optional subtitles.
 * @param {Object} streamItem - The stream item with url and headers.
 * @param {string} streamItem.url - The stream URL.
 * @param {Object.<string, string>} [streamItem.headers] - Request headers.
 * @param {Array<Object>} [subtitleItems=[]] - Array of subtitle items.
 * @param {string} subtitleItems[].url - Subtitle URL.
 * @returns {string} The complete mpv command string.
 */
export function buildMpvCommand(streamItem, subtitleItems = []) {
  const streamUrl = streamItem?.url;
  if (!streamUrl) return '';

  const headers = streamItem.headers || {};

  // Extract user-agent if present
  const userAgent = headers['User-Agent'] || headers['user-agent'];
  const otherHeaders = { ...headers };
  delete otherHeaders['User-Agent'];
  delete otherHeaders['user-agent'];

  // Build header option for stream (using demuxer-lavf-o format)
  const headerOpt = buildMpvHeaderOption(otherHeaders);

  // Build user-agent option
  const userAgentOpt = userAgent ? `  --user-agent='${shellEscapeSingle(userAgent)}' \\\n` : '';

  // Build subtitle options - each subtitle gets its own --sub-file flag
  const subOpts = subtitleItems
    .filter((s) => s?.url)
    .map((s) => {
      return `  --sub-file='${shellEscapeSingle(s.url)}' \\\n`;
    })
    .join('');

  // Build the command with proper line continuation
  const parts = [
    'mpv \\\n',
    `  --force-window=immediate \\\n`,
    `  --sub-auto=fuzzy \\\n`,
    `  --demuxer-lavf-o=allowed_extensions=ALL \\\n`,
    subOpts,
    userAgentOpt,
    headerOpt ? `  ${headerOpt} \\\n` : '',
    `  '${shellEscapeSingle(streamUrl)}' \\\n`,
    `  --msg-level=ffmpeg=trace,demuxer=trace,network=trace \\\n`,
    `  --log-file=mpv-trace.log`
  ];

  return parts.filter(Boolean).join('');
}

/**
 * Builds ffmpeg headers option string.
 * Format: -headers 'Header1: value1\r\nHeader2: value2\r\n'
 * @param {Object.<string, string>} headers - Headers object.
 * @returns {string} The ffmpeg headers option string, or empty string if no headers.
 */
export function buildFfmpegHeaders(headers) {
  const entries = Object.entries(headers || {});
  if (!entries.length) return '';
  // Format: 'Header1: value1\r\nHeader2: value2\r\n'
  const joined = entries.map(([k, v]) => `${k}: ${v}`).join('\r\n');
  return `-headers '${shellEscapeSingle(joined + '\r\n')}'`;
}

/**
 * Language code mapping for ffmpeg (ISO 639-2 codes where available).
 * Keep in sync with popup.js LANGUAGE_NAMES.
 * @type {Object.<string, string>}
 */
export const LANGUAGE_CODE_MAP = {
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

/**
 * Converts a language code to ffmpeg-compatible ISO 639-2 code.
 * Falls back to the original code if no mapping exists.
 * @param {string} langCode - The language code to convert.
 * @returns {string|null} The ffmpeg language code, or null if input is empty.
 */
export function getFfmpegLanguageCode(langCode) {
  if (!langCode) return null;
  const normalized = langCode.toLowerCase();
  return LANGUAGE_CODE_MAP[normalized] || LANGUAGE_CODE_MAP[normalized.split('-')[0]] || normalized;
}

/**
 * Builds an ffmpeg command string for downloading/converting a stream with optional subtitles.
 * @param {Object} streamItem - The stream item with url and headers.
 * @param {string} streamItem.url - The stream URL.
 * @param {Object.<string, string>} [streamItem.headers] - Request headers.
 * @param {Array<Object>} [subtitleItems=[]] - Array of subtitle items.
 * @param {string} subtitleItems[].url - Subtitle URL.
 * @param {string} [subtitleItems[].languageCode] - Subtitle language code.
 * @param {string} [subtitleItems[].langCode] - Alternative language code property.
 * @param {string} [subtitleItems[].languageName] - Subtitle language name.
 * @param {string} [subtitleItems[].langName] - Alternative language name property.
 * @param {string} [outputFormat='mp4'] - Output format ('mp4' or 'mkv').
 * @param {string} [outputFilename=null] - Desired output filename (without extension).
 * @returns {string} The complete ffmpeg command string.
 */
export function buildFfmpegCommand(streamItem, subtitleItems = [], outputFormat = 'mp4', outputFilename = null) {
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

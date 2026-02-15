// ============================================================
// Subtitle Catcher — Popup Script
// ============================================================

// Language code to name mapping
const LANGUAGE_NAMES = {
  'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
  'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
  'ar': 'Arabic', 'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch',
  'sv': 'Swedish', 'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'el': 'Greek',
  'he': 'Hebrew', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay',
  'cs': 'Czech', 'sk': 'Slovak', 'hu': 'Hungarian', 'ro': 'Romanian', 'bg': 'Bulgarian',
  'uk': 'Ukrainian', 'hr': 'Croatian', 'sr': 'Serbian', 'sl': 'Slovenian', 'et': 'Estonian',
  'lv': 'Latvian', 'lt': 'Lithuanian', 'fa': 'Persian', 'ur': 'Urdu', 'bn': 'Bengali',
  'ta': 'Tamil', 'te': 'Telugu', 'ml': 'Malayalam', 'kn': 'Kannada', 'mr': 'Marathi',
  'gu': 'Gujarati', 'pa': 'Punjabi', 'sw': 'Swahili', 'af': 'Afrikaans', 'ca': 'Catalan',
  'eu': 'Basque', 'gl': 'Galician', 'hy': 'Armenian', 'ka': 'Georgian', 'mn': 'Mongolian',
  'ne': 'Nepali', 'si': 'Sinhala', 'km': 'Khmer', 'lo': 'Lao', 'my': 'Burmese',
  'am': 'Amharic', 'zu': 'Zulu', 'xh': 'Xhosa', 'yo': 'Yoruba', 'ig': 'Igbo',
  'ha': 'Hausa', 'tl': 'Filipino', 'jv': 'Javanese', 'su': 'Sundanese', 'mg': 'Malagasy',
  'nb': 'Norwegian Bokmål', 'nn': 'Norwegian Nynorsk', 'zh-cn': 'Chinese (Simplified)', 
  'zh-tw': 'Chinese (Traditional)', 'pt-br': 'Portuguese (Brazil)', 'pt-pt': 'Portuguese (Portugal)',
  'es-419': 'Spanish (Latin America)', 'en-gb': 'English (UK)', 'en-us': 'English (US)'
};

// Cache for detected languages
const languageCache = new Map();

// Detect language from subtitle content
async function detectSubtitleLanguage(url, headers = {}) {
  if (languageCache.has(url)) {
    return languageCache.get(url);
  }
  
  try {
    // Fetch first ~5KB of subtitle file for language detection
    const fetchHeaders = new Headers();
    Object.entries(headers).forEach(([k, v]) => fetchHeaders.set(k, v));
    
    const response = await fetch(url, { 
      method: 'GET',
      headers: fetchHeaders,
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) return null;
    
    const text = await response.text();
    
    // Extract text content from subtitle formats (remove timestamps, indices, tags)
    const contentText = extractSubtitleText(text);
    
    if (!contentText || contentText.length < 20) return null;
    
    // Use Chrome's built-in language detection API
    const result = await chrome.i18n.detectLanguage(contentText.substring(0, 2000));
    
    if (result?.languages?.length > 0) {
      const detected = result.languages[0];
      if (detected.percentage > 50) {
        const langCode = detected.language.toLowerCase();
        languageCache.set(url, langCode);
        return langCode;
      }
    }
    
    return null;
  } catch (e) {
    console.warn('Language detection failed:', e);
    return null;
  }
}

// Extract plain text from subtitle content (SRT, VTT, ASS, etc.)
function extractSubtitleText(rawText) {
  let text = rawText;
  
  // Remove WebVTT header
  text = text.replace(/^WEBVTT.*?\n\n/gis, '');
  
  // Remove SRT/VTT timestamp lines (e.g., "00:00:01,000 --> 00:00:04,000" or "00:00:01.000 --> 00:00:04.000")
  text = text.replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}[^\n]*/g, '');
  
  // Remove numeric indices (SRT format)
  text = text.replace(/^\d+\s*$/gm, '');
  
  // Remove ASS/SSA style tags and headers
  text = text.replace(/\{\\[^}]+\}/g, '');
  text = text.replace(/^\[Script Info\].*?\n\n/gis, '');
  text = text.replace(/^\[V4\+? Styles\].*?\n\n/gis, '');
  text = text.replace(/^Format:.*$/gm, '');
  text = text.replace(/^Style:.*$/gm, '');
  text = text.replace(/^Dialogue:.*?,/gm, '');
  
  // Remove HTML/VTT tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Remove cue settings (VTT)
  text = text.replace(/position:\d+%.*$/gm, '');
  
  // Remove extra whitespace and empty lines
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Get display name for language code
function getLanguageName(code) {
  if (!code) return null;
  const normalized = code.toLowerCase();
  return LANGUAGE_NAMES[normalized] || LANGUAGE_NAMES[normalized.split('-')[0]] || code.toUpperCase();
}

(async () => {
  const container = document.getElementById('list-container');
  const stateEmpty = document.getElementById('state-empty');
  const stateLoading = document.getElementById('state-loading');
  const btnClear = document.getElementById('btn-clear');
  const btnSelectAll = document.getElementById('btn-select-all');
  const toast = document.getElementById('toast');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showEmpty(); return; }
  const tabId = tab.id;

  let streamItems = {};
  let subtitleItems = {};

  chrome.runtime.sendMessage({ cmd: 'GET_ITEMS', tabId }, (payload) => {
    stateLoading.style.display = 'none';
    streamItems = payload?.streams || {};
    subtitleItems = payload?.subtitles || {};

    const streamList = Object.values(streamItems);
    const subList = Object.values(subtitleItems);

    if (!streamList.length && !subList.length) {
      showEmpty();
      return;
    }

    streamList.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendCard(`stream-${item.timestamp}`, item));
    subList.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendCard(`sub-${item.timestamp}`, item));
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.cmd === 'ITEM_DETECTED' && msg.tabId === tabId) {
      stateEmpty.style.display = 'none';
      
      // Update internal state so mpv button can find the item
      if (msg.item.kind === 'stream') {
        streamItems[msg.item.timestamp] = msg.item;
      } else if (msg.item.kind === 'subtitle') {
        subtitleItems[msg.item.timestamp] = msg.item;
      }
      
      appendCard(`${msg.item.kind}-${msg.item.timestamp}`, msg.item);
    }
  });

  btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ cmd: 'CLEAR_ITEMS', tabId }, () => {
      container.querySelectorAll('.sub-card').forEach(c => c.remove());
      streamItems = {};
      subtitleItems = {};
      languageCache.clear();
      updateSelectAllButton();
      showEmpty();
      showToast('Cleared');
    });
  });

  // Select all subtitles functionality
  btnSelectAll.addEventListener('click', () => {
    const checkboxes = container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
    });
    
    updateSelectAllButton();
    showToast(allChecked ? 'All subtitles deselected' : 'All subtitles selected');
  });

  function updateSelectAllButton() {
    const checkboxes = container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]');
    const subtitleCount = checkboxes.length;
    
    if (subtitleCount === 0) {
      btnSelectAll.style.display = 'none';
    } else {
      btnSelectAll.style.display = 'block';
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      btnSelectAll.textContent = allChecked ? 'Deselect all' : 'Select all';
      btnSelectAll.classList.toggle('all-selected', allChecked);
    }
  }

  // ── Render helpers ────────────────────────────────────────

  function showEmpty() {
    stateLoading.style.display = 'none';
    stateEmpty.style.display = 'flex';
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function timeAgo(ts) {
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  }

  function buildHeadersText(headers) {
    return Object.entries(headers)
      .map(([k, v]) => `<span class="header-key">${escHtml(k)}</span>: <span class="header-val">${escHtml(v)}</span>`)
      .join('\n');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function appendCard(id, item) {
    // Use URL-based ID to prevent duplicates from same-timestamp items
    const urlHash = item.url?.slice(-50) || Math.random().toString(36);
    const uniqueId = `${id}-${urlHash.replace(/[^a-zA-Z0-9]/g, '')}`;
    
    if (container.querySelector(`[data-id="${CSS.escape(uniqueId)}"]`)) return;

    stateEmpty.style.display = 'none';
    stateLoading.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = uniqueId;
    card.dataset.timestamp = item.timestamp;
    card.dataset.kind = item.kind || 'subtitle';

    const sizeTxt = formatSize(item.size);
    const metaParts = [item.format?.toUpperCase()];
    
    // Add resolution/quality for streams
    if (item.resolution) metaParts.push(item.resolution);
    if (item.quality && !item.resolution) metaParts.push(item.quality);
    if (item.codec) metaParts.push(item.codec);
    if (item.bitrate) metaParts.push(item.bitrate);
    if (item.hdr) metaParts.push('HDR');
    if (item.estimatedQuality) metaParts.push(`~${item.estimatedQuality}`);
    
    // Add size and time
    if (sizeTxt) metaParts.push(sizeTxt);
    metaParts.push(timeAgo(item.timestamp));
    
    const meta = metaParts.filter(Boolean).join(' · ');

    const hasHeaders = item.headers && Object.keys(item.headers).length > 0;
    const isStream = item.kind === 'stream';
    const isHlsOrDash = isStream && (item.mediaType === 'hls' || item.mediaType === 'dash');
    const isVideoFile = isStream && item.mediaType === 'video';

    // Build action buttons based on stream type
    let actionButtons = '';
    // Format selector HTML (only for HLS/DASH streams with ffmpeg)
    const formatSelectorHtml = isHlsOrDash ? `
      <div class="format-selector">
        <label for="format-select-${uniqueId}">Output:</label>
        <select id="format-select-${uniqueId}" class="format-select" data-stream-id="${uniqueId}">
          <option value="mp4" selected>MP4</option>
          <option value="mkv">MKV</option>
        </select>
      </div>
    ` : '';

    if (isHlsOrDash) {
      // HLS/DASH streams: show mpv and ffmpeg buttons
      actionButtons = `
        <button class="action-btn btn-download" data-action="mpv" style="background: #FF6B35; border-color: #FF6B35;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          mpv
        </button>
        <button class="action-btn btn-ffmpeg" data-action="ffmpeg">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 2v20M2 12h20"/>
          </svg>
          ffmpeg
        </button>`;
    } else if (isVideoFile) {
      // Single video files: show direct download button
      actionButtons = `
        <button class="action-btn btn-direct-download" data-action="direct-download">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>`;
    } else if (isStream) {
      // Other stream types: just mpv button
      actionButtons = `
        <button class="action-btn btn-download" data-action="mpv" style="background: #FF6B35; border-color: #FF6B35;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          mpv
        </button>`;
    } else {
      // Subtitles: download link
      actionButtons = `
        <a class="action-btn btn-download" data-action="download" href="${escHtml(item.url)}" download="${escHtml(item.name)}" target="_blank">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </a>`;
    }

    card.innerHTML = `
      <div class="card-main">
        <span class="badge-format" style="background: ${isStream ? '#FF6B35' : '#0077FF'}">${escHtml(item.format || '?')}</span>
        <div class="card-info">
          <div class="card-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
          <div class="card-url" title="${escHtml(item.url)}">${escHtml(item.url)}</div>
          <div class="card-meta">${escHtml(meta)}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="action-btn btn-copy" data-action="copy">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
          Copy URL
        </button>
        ${actionButtons}
        ${hasHeaders ? `
        <button class="action-btn btn-headers" data-action="headers">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          Headers
        </button>` : ''}
      </div>
      ${formatSelectorHtml}
      ${hasHeaders ? `
      <div class="headers-panel" id="hp-${escHtml(uniqueId)}">
${buildHeadersText(item.headers)}
      </div>` : ''}
    `;

    card.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url)
        .then(() => showToast('URL copied!'))
        .catch(() => showToast('Copy failed', true));
    });

    if (isStream) {
      // mpv button handler
      card.querySelector('[data-action="mpv"]')?.addEventListener('click', () => {
        const selectedSubs = getSelectedSubtitles();

        chrome.runtime.sendMessage({ cmd: 'BUILD_MPV', streamItem: item, subtitleItems: selectedSubs }, (response) => {
          if (response?.command) {
            navigator.clipboard.writeText(response.command)
              .then(() => showToast('mpv command copied!'))
              .catch(() => showToast('Copy failed', true));
          } else {
            showToast('Failed to build command', true);
          }
        });
      });

      // ffmpeg button handler (only for HLS/DASH streams)
      card.querySelector('[data-action="ffmpeg"]')?.addEventListener('click', () => {
        const selectedSubs = getSelectedSubtitles();
        const formatSelect = card.querySelector('.format-select');
        const outputFormat = formatSelect ? formatSelect.value : 'mp4';

        chrome.runtime.sendMessage({ cmd: 'BUILD_FFMPEG', streamItem: item, subtitleItems: selectedSubs, outputFormat }, (response) => {
          if (response?.command) {
            navigator.clipboard.writeText(response.command)
              .then(() => showToast('ffmpeg command copied!'))
              .catch(() => showToast('Copy failed', true));
          } else {
            showToast('Failed to build command', true);
          }
        });
      });

      // Direct download handler (only for single video files)
      card.querySelector('[data-action="direct-download"]')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ 
          cmd: 'DOWNLOAD_VIDEO', 
          url: item.url, 
          filename: item.name,
          headers: item.headers || {}
        }, (response) => {
          if (response?.success) {
            showToast('Download started!');
          } else {
            showToast('Download failed: ' + (response?.error || 'Unknown error'), true);
          }
        });
      });
    }

    // Helper function to get selected subtitles
    function getSelectedSubtitles() {
      return Array.from(container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]:checked'))
        .map(cb => {
          const subCard = cb.closest('.sub-card');
          const timestamp = subCard?.dataset.timestamp;
          if (!timestamp) return null;
          
          // Find the subtitle item by matching timestamp
          const foundItem = Object.values(subtitleItems).find(s => String(s.timestamp) === timestamp);
          return foundItem || null;
        })
        .filter(Boolean);
    }

    if (hasHeaders) {
      card.querySelector('[data-action="headers"]')?.addEventListener('click', () => {
        const panel = document.getElementById(`hp-${uniqueId}`);
        if (panel) panel.classList.toggle('visible');
      });

      card.querySelector('[data-action="headers"]')?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const curlHeaders = Object.entries(item.headers)
          .map(([k, v]) => `-H '${k}: ${v.replace(/'/g, "'\\''")}'`)
          .join(' \\\n  ');
        const curl = `curl \\\n  ${curlHeaders} \\\n  '${item.url}'`;
        navigator.clipboard.writeText(curl)
          .then(() => showToast('curl command copied!'))
          .catch(() => showToast('Copy failed', true));
      });
    }

    if (!isStream) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.cssText = 'margin-left: 8px; cursor: pointer;';
      checkbox.title = 'Include in mpv command';
      checkbox.addEventListener('change', updateSelectAllButton);
      card.querySelector('.card-main').appendChild(checkbox);
      
      // Add language detection for subtitles
      const langBadge = document.createElement('span');
      langBadge.className = 'badge-language';
      langBadge.style.cssText = 'background: #28a745; color: #fff; font-size: 9px; font-weight: 600; padding: 2px 5px; border-radius: 4px; margin-left: 6px; text-transform: uppercase; opacity: 0; transition: opacity 0.2s;';
      langBadge.textContent = '...';
      card.querySelector('.card-info').appendChild(langBadge);
      
      // Detect language asynchronously
      detectSubtitleLanguage(item.url, item.headers).then(langCode => {
        if (langCode) {
          const langName = getLanguageName(langCode);
          langBadge.textContent = langName || langCode.toUpperCase();
          langBadge.title = `Detected language: ${langName || langCode}`;
          langBadge.style.opacity = '1';
        } else {
          langBadge.remove();
        }
      }).catch(() => {
        langBadge.remove();
      });
    }

    container.appendChild(card);
    updateSelectAllButton();
  }

  // ── Toast notification ────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.style.background = isError ? '#e74c3c' : '#1e1e2e';
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

})();

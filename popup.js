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

// Theme management
const THEME_KEY = 'subtitle-catcher-theme';
const THEMES = ['auto', 'light', 'dark'];
let currentThemeIndex = 0;

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

// Theme functions
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getEffectiveTheme(theme) {
  if (theme === 'auto') {
    return getSystemTheme();
  }
  return theme;
}

function applyTheme(theme) {
  const effectiveTheme = getEffectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  
  // Update theme toggle button icon
  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    if (theme === 'dark' || (theme === 'auto' && effectiveTheme === 'dark')) {
      themeBtn.textContent = '☀️';
      themeBtn.title = `Theme: ${theme} (click to cycle)`;
    } else {
      themeBtn.textContent = '🌙';
      themeBtn.title = `Theme: ${theme} (click to cycle)`;
    }
  }
}

function cycleTheme() {
  currentThemeIndex = (currentThemeIndex + 1) % THEMES.length;
  const newTheme = THEMES[currentThemeIndex];
  localStorage.setItem(THEME_KEY, newTheme);
  applyTheme(newTheme);
  showToast(`Theme: ${newTheme}`);
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'auto';
  currentThemeIndex = THEMES.indexOf(savedTheme);
  if (currentThemeIndex === -1) currentThemeIndex = 0;
  applyTheme(savedTheme);
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const currentTheme = THEMES[currentThemeIndex];
    if (currentTheme === 'auto') {
      applyTheme('auto');
    }
  });
}

(async () => {
  const container = document.getElementById('list-container');
  const stateEmpty = document.getElementById('state-empty');
  const stateLoading = document.getElementById('state-loading');
  const btnClear = document.getElementById('btn-clear');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const toast = document.getElementById('toast');
  const commandBar = document.getElementById('command-bar');
  const commandSelection = document.getElementById('command-selection');
  const btnCommandMpv = document.getElementById('btn-command-mpv');
  const btnCommandFfmpeg = document.getElementById('btn-command-ffmpeg');
  const ffmpegFormatSelect = document.getElementById('ffmpeg-format-select');

  // Initialize theme
  initTheme();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showEmpty(); return; }
  const tabId = tab.id;
  const tabTitle = tab.title || '';

  let streamItems = {};
  let subtitleItems = {};
  let videoFileItems = {};
  let selectedStreamId = null;
  let btnSelectAllSection = null;

  // Section containers
  let streamsSection = null;
  let subtitlesSection = null;
  let videoFilesSection = null;

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

    // Separate video files from streams
    const hlsDashStreams = streamList.filter(item => item.mediaType === 'hls' || item.mediaType === 'dash');
    const otherStreams = streamList.filter(item => item.mediaType !== 'hls' && item.mediaType !== 'dash' && item.mediaType !== 'video');
    const videoFiles = streamList.filter(item => item.mediaType === 'video');
    
    // Store video files separately
    videoFiles.forEach(item => videoFileItems[item.timestamp] = item);

    // Create sections
    createSections();

    // Render items in sections
    hlsDashStreams.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendStreamCard(`stream-${item.timestamp}`, item));
    otherStreams.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendStreamCard(`stream-${item.timestamp}`, item));
    videoFiles.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendVideoFileCard(`video-${item.timestamp}`, item));
    subList.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendSubtitleCard(`sub-${item.timestamp}`, item));

    updateCommandBar();
    updateSelectAllButton();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.cmd === 'ITEM_DETECTED' && msg.tabId === tabId) {
      stateEmpty.style.display = 'none';
      
      // Update internal state
      if (msg.item.kind === 'stream') {
        streamItems[msg.item.timestamp] = msg.item;
        if (msg.item.mediaType === 'video') {
          videoFileItems[msg.item.timestamp] = msg.item;
        }
      } else if (msg.item.kind === 'subtitle') {
        subtitleItems[msg.item.timestamp] = msg.item;
      }
      
      // Create sections if they don't exist
      if (!streamsSection) createSections();
      
      // Append to appropriate section
      if (msg.item.kind === 'stream') {
        if (msg.item.mediaType === 'video') {
          appendVideoFileCard(`video-${msg.item.timestamp}`, msg.item);
        } else {
          appendStreamCard(`stream-${msg.item.timestamp}`, msg.item);
        }
      } else {
        appendSubtitleCard(`sub-${msg.item.timestamp}`, msg.item);
      }
      
      updateCommandBar();
      updateSelectAllButton();
    }
  });

  btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ cmd: 'CLEAR_ITEMS', tabId }, () => {
      container.querySelectorAll('.sub-card').forEach(c => c.remove());
      // Remove section headers
      container.querySelectorAll('.section-header').forEach(h => h.remove());
      streamsSection = null;
      subtitlesSection = null;
      videoFilesSection = null;
      streamItems = {};
      subtitleItems = {};
      videoFileItems = {};
      selectedStreamId = null;
      btnSelectAllSection = null;
      languageCache.clear();
      updateSelectAllButton();
      updateCommandBar();
      showEmpty();
      showToast('Cleared');
    });
  });

  // Theme toggle button
  btnThemeToggle.addEventListener('click', cycleTheme);

  // Select all subtitles functionality - now in section header
  function handleSelectAllClick() {
    const checkboxes = container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
    });
    
    updateSelectAllButton();
    updateCommandBar();
    showToast(allChecked ? 'All subtitles deselected' : 'All subtitles selected');
  }

  // Helper function to get stream item with variant URL if selected
  function getEffectiveStreamItem(streamId) {
    // streamId is now the URL
    const streamItem = Object.values(streamItems).find(s => s.url === streamId);
    if (!streamItem) return null;
    
    // Check if a variant is selected for this stream
    const selectedVariant = selectedVariants.get(streamId);
    if (selectedVariant && selectedVariant.variant) {
      // Return a modified stream item with the variant URL
      return {
        ...streamItem,
        url: selectedVariant.variant.url,
        variantName: selectedVariant.variant.name,
        resolution: selectedVariant.variant.resolution || streamItem.resolution,
        bitrate: selectedVariant.variant.bitrate || streamItem.bitrate,
        codec: selectedVariant.variant.codec || streamItem.codec
      };
    }
    
    return streamItem;
  }

  // Command bar MPV button
  btnCommandMpv.addEventListener('click', () => {
    if (!selectedStreamId) return;
    
    const streamItem = getEffectiveStreamItem(selectedStreamId);
    
    if (!streamItem) {
      showToast('Stream not found', true);
      return;
    }
    
    const selectedSubs = getSelectedSubtitles();
    
    chrome.runtime.sendMessage({ cmd: 'BUILD_MPV', streamItem, subtitleItems: selectedSubs }, (response) => {
      if (response?.command) {
        navigator.clipboard.writeText(response.command)
          .then(() => showToast('mpv command copied!'))
          .catch(() => showToast('Copy failed', true));
      } else {
        showToast('Failed to build command', true);
      }
    });
  });

  // Command bar FFMPEG button - copies command immediately
  btnCommandFfmpeg.addEventListener('click', () => {
    if (!selectedStreamId) return;
    
    const streamItem = getEffectiveStreamItem(selectedStreamId);
    
    if (!streamItem) {
      showToast('Stream not found', true);
      return;
    }
    
    const selectedSubs = getSelectedSubtitles();
    const outputFormat = ffmpegFormatSelect?.value || 'mp4';
    
    chrome.runtime.sendMessage({ cmd: 'BUILD_FFMPEG', streamItem, subtitleItems: selectedSubs, outputFormat, outputFilename: tabTitle }, (response) => {
      if (response?.command) {
        navigator.clipboard.writeText(response.command)
          .then(() => showToast('ffmpeg command copied!'))
          .catch(() => showToast('Copy failed', true));
      } else {
        showToast('Failed to build command', true);
      }
    });
  });

  function updateSelectAllButton() {
    const checkboxes = container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]');
    const subtitleCount = checkboxes.length;
    
    if (!btnSelectAllSection) return;
    
    if (subtitleCount === 0) {
      btnSelectAllSection.style.display = 'none';
    } else {
      btnSelectAllSection.style.display = 'block';
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      btnSelectAllSection.textContent = allChecked ? 'Deselect all' : 'Select all';
      btnSelectAllSection.classList.toggle('all-selected', allChecked);
    }
  }

  function updateCommandBar() {
    const selectedSubs = getSelectedSubtitles();
    const subtitleCount = selectedSubs.length;
    
    if (!selectedStreamId) {
      commandBar.classList.add('disabled');
      commandSelection.innerHTML = '<span class="empty">Select a stream to begin</span>';
    } else {
      commandBar.classList.remove('disabled');
      const streamItem = getEffectiveStreamItem(selectedStreamId);
      let streamName = streamItem?.name || 'Unknown';
      
      // If a variant is selected, show variant info in command bar
      const selectedVariant = selectedVariants.get(selectedStreamId);
      if (selectedVariant && selectedVariant.variant) {
        streamName += ` (${selectedVariant.variant.name})`;
      }
      
      if (subtitleCount > 0) {
        commandSelection.innerHTML = `Selected: <span class="stream-name">${escHtml(streamName)}</span> + <span class="subtitle-count">${subtitleCount} subtitle${subtitleCount !== 1 ? 's' : ''}</span>`;
      } else {
        commandSelection.innerHTML = `Selected: <span class="stream-name">${escHtml(streamName)}</span>`;
      }
    }
  }

  // Store detected language codes for subtitles
  const subtitleLanguageCache = new Map();

  function getSelectedSubtitles() {
    return Array.from(container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]:checked'))
      .map(cb => {
        const subCard = cb.closest('.sub-card');
        const url = subCard?.dataset.subtitleUrl;
        if (!url) return null;
        
        // Find by URL - guaranteed unique
        const foundItem = Object.values(subtitleItems).find(s => s.url === url);
        if (!foundItem) return null;
        
        // Include detected language code if available
        const langCode = subtitleLanguageCache.get(foundItem.url);
        if (langCode) {
          return {
            ...foundItem,
            languageCode: langCode,
            languageName: getLanguageName(langCode)
          };
        }
        
        return foundItem;
      })
      .filter(Boolean);
  }

  // ── Render helpers ────────────────────────────────────────

  function createSections() {
    // Clear existing sections first
    container.querySelectorAll('.section-header').forEach(h => h.remove());
    btnSelectAllSection = null;
    
    // Create Streams section
    streamsSection = document.createElement('div');
    streamsSection.className = 'section-header';
    streamsSection.dataset.section = 'streams';
    streamsSection.innerHTML = '<span class="section-header-icon">📡</span> Streams';
    streamsSection.style.display = 'none';
    container.appendChild(streamsSection);
    
    // Create Video Files section
    videoFilesSection = document.createElement('div');
    videoFilesSection.className = 'section-header';
    videoFilesSection.dataset.section = 'video-files';
    videoFilesSection.innerHTML = '<span class="section-header-icon">📼</span> Video Files';
    videoFilesSection.style.display = 'none';
    container.appendChild(videoFilesSection);
    
    // Create Subtitles section with select all button
    subtitlesSection = document.createElement('div');
    subtitlesSection.className = 'section-header';
    subtitlesSection.dataset.section = 'subtitles';
    subtitlesSection.style.display = 'none';
    
    // Create section header with select all button
    const headerContent = document.createElement('div');
    headerContent.className = 'section-header-content';
    
    const titleSpan = document.createElement('span');
    titleSpan.innerHTML = '<span class="section-header-icon">📄</span> Subtitles';
    
    btnSelectAllSection = document.createElement('button');
    btnSelectAllSection.className = 'btn-select-all-section';
    btnSelectAllSection.textContent = 'Select all';
    btnSelectAllSection.addEventListener('click', handleSelectAllClick);
    
    headerContent.appendChild(titleSpan);
    headerContent.appendChild(btnSelectAllSection);
    subtitlesSection.appendChild(headerContent);
    
    container.appendChild(subtitlesSection);
  }

  function showSection(sectionName) {
    const section = container.querySelector(`.section-header[data-section="${sectionName}"]`);
    if (section) section.style.display = 'flex';
  }

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

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  // Store selected variant info for each stream
  const selectedVariants = new Map();

  function appendStreamCard(id, item) {
    showSection('streams');
    
    // Use URL-based ID to prevent duplicates from same-timestamp items
    const urlHash = item.url?.slice(-50) || Math.random().toString(36);
    const uniqueId = `${id}-${urlHash.replace(/[^a-zA-Z0-9]/g, '')}`;
    const timestamp = item.timestamp;
    
    if (container.querySelector(`[data-id="${CSS.escape(uniqueId)}"]`)) return;

    stateEmpty.style.display = 'none';
    stateLoading.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = uniqueId;
    card.dataset.timestamp = timestamp;
    card.dataset.kind = 'stream';
    card.dataset.streamUrl = item.url;

    const sizeTxt = formatSize(item.size);
    const metaParts = [item.format?.toUpperCase()];
    
    // Add resolution/quality for streams
    if (item.resolution) metaParts.push(item.resolution);
    if (item.quality && !item.resolution) metaParts.push(item.quality);
    if (item.codec) metaParts.push(item.codec);
    if (item.bitrate) metaParts.push(item.bitrate);
    if (item.hdr) metaParts.push('HDR');
    if (item.estimatedQuality) metaParts.push(`~${item.estimatedQuality}`);
    
    // Add duration for HLS streams
    if (item.durationFormatted) metaParts.push(item.durationFormatted);
    
    // Add variant count for master playlists
    if (item.isMasterPlaylist && item.variants) {
      metaParts.push(`${item.variants.length} quality options`);
    }
    
    // Add size and time
    if (sizeTxt) metaParts.push(sizeTxt);
    metaParts.push(timeAgo(item.timestamp));
    
    const meta = metaParts.filter(Boolean).join(' · ');
    const isHlsOrDash = item.mediaType === 'hls' || item.mediaType === 'dash';

    card.innerHTML = `
      <div class="card-main">
        <div class="card-selector">
          <input type="radio" name="stream-select" value="${item.url}" data-stream-id="${item.url}">
        </div>
        <span class="badge-format" style="background: #FF6B35">${escHtml(item.format || '?')}</span>
        <div class="card-info">
          <div class="card-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
          <div class="card-url" title="${escHtml(item.url)}">${escHtml(item.url)}</div>
          <div class="card-meta">${escHtml(meta)}</div>
        </div>
        <button class="action-btn btn-icon" data-action="copy" title="Copy URL">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>
      </div>
    `;

    // Add variant subitems if this is a master playlist
    if (item.isMasterPlaylist && item.variants && item.variants.length > 0) {
      const variantsContainer = document.createElement('div');
      variantsContainer.className = 'variants-container';
      
      const variantsToggle = document.createElement('button');
      variantsToggle.className = 'variants-toggle';
      variantsToggle.innerHTML = `
        <span class="variants-toggle-icon">▼</span>
        <span>${item.variants.length} qualities</span>
      `;
      
      const variantsList = document.createElement('div');
      variantsList.className = 'variants-list';
      
      // Create variant subitems
      item.variants.forEach((variant, index) => {
        const variantItem = document.createElement('div');
        variantItem.className = 'variant-subitem';
        variantItem.dataset.variantIndex = index;
        
        // Use pre-calculated estimated size from service worker
        const estimatedSize = variant.estimatedSizeFormatted || '';
        
        const detailsParts = [];
        if (variant.resolution) detailsParts.push(`<span class="variant-detail-item">📐 ${variant.resolution}</span>`);
        if (variant.bitrate) detailsParts.push(`<span class="variant-detail-item">📊 ${variant.bitrate}</span>`);
        if (variant.codec) detailsParts.push(`<span class="variant-detail-item">🎬 ${variant.codec}</span>`);
        
        variantItem.innerHTML = `
          <div class="variant-selector">
            <input type="radio" name="variant-select-${urlHash}" value="${index}" data-variant-index="${index}">
          </div>
          <div class="variant-info">
            <div class="variant-name">${escHtml(variant.name)}</div>
            <div class="variant-details">${detailsParts.join('')}</div>
          </div>
          ${estimatedSize ? `<div class="variant-estimated-size">${escHtml(estimatedSize)}</div>` : ''}
        `;
        
        // Variant selection handler
        const variantRadio = variantItem.querySelector('input[type="radio"]');
        variantRadio.addEventListener('change', () => {
          if (variantRadio.checked) {
            // Update visual selection
            variantsList.querySelectorAll('.variant-subitem').forEach(v => v.classList.remove('selected'));
            variantItem.classList.add('selected');
            
            // Store selected variant
            selectedVariants.set(item.url, {
              index: index,
              variant: variant
            });
            
            // Also select the parent stream
            const parentRadio = card.querySelector('input[type="radio"][name="stream-select"]');
            if (parentRadio && !parentRadio.checked) {
              parentRadio.checked = true;
              parentRadio.dispatchEvent(new Event('change'));
            }
            
            updateCommandBar();
          }
        });
        
        variantsList.appendChild(variantItem);
      });
      
      // Toggle expand/collapse
      variantsToggle.addEventListener('click', () => {
        const isExpanded = variantsList.classList.toggle('expanded');
        variantsToggle.classList.toggle('expanded', isExpanded);
      });
      
      variantsContainer.appendChild(variantsToggle);
      variantsContainer.appendChild(variantsList);
      card.appendChild(variantsContainer);
    }

    // Radio button change handler
    const radio = card.querySelector('input[type="radio"][name="stream-select"]');
    radio.addEventListener('change', () => {
      if (radio.checked) {
        const card = radio.closest('.sub-card');
        selectedStreamId = card.dataset.streamUrl;  // Use URL as ID
        // Update visual selection
        container.querySelectorAll('.sub-card[data-kind="stream"]').forEach(c => c.classList.remove('selected-stream'));
        card.classList.add('selected-stream');
        updateCommandBar();
      }
    });

    // Copy URL button
    card.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url)
        .then(() => showToast('URL copied!'))
        .catch(() => showToast('Copy failed', true));
    });

    // Insert after streams section header
    const sectionHeader = container.querySelector('.section-header[data-section="streams"]');
    if (sectionHeader) {
      sectionHeader.after(card);
    } else {
      container.appendChild(card);
    }
  }

  function appendVideoFileCard(id, item) {
    showSection('video-files');
    
    // Use URL-based ID to prevent duplicates from same-timestamp items
    const urlHash = item.url?.slice(-50) || Math.random().toString(36);
    const uniqueId = `${id}-${urlHash.replace(/[^a-zA-Z0-9]/g, '')}`;
    const timestamp = item.timestamp;
    
    if (container.querySelector(`[data-id="${CSS.escape(uniqueId)}"]`)) return;

    stateEmpty.style.display = 'none';
    stateLoading.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = uniqueId;
    card.dataset.timestamp = timestamp;
    card.dataset.kind = 'video-file';

    const sizeTxt = formatSize(item.size);
    const metaParts = [item.format?.toUpperCase()];
    
    if (item.resolution) metaParts.push(item.resolution);
    if (item.quality && !item.resolution) metaParts.push(item.quality);
    
    if (sizeTxt) metaParts.push(sizeTxt);
    metaParts.push(timeAgo(item.timestamp));
    
    const meta = metaParts.filter(Boolean).join(' · ');

    card.innerHTML = `
      <div class="card-main">
        <div class="card-selector">
          <input type="radio" name="stream-select" value="${timestamp}" data-stream-id="${timestamp}">
        </div>
        <span class="badge-format" style="background: #10B981">${escHtml(item.format || 'MP4')}</span>
        <div class="card-info">
          <div class="card-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
          <div class="card-url" title="${escHtml(item.url)}">${escHtml(item.url)}</div>
          <div class="card-meta">${escHtml(meta)}</div>
        </div>
        <button class="action-btn btn-icon" data-action="copy" title="Copy URL">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>
      </div>
      <div class="card-actions">
        <button class="action-btn btn-direct-download" data-action="direct-download">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>
      </div>
    `;

    // Radio button change handler
    const radio = card.querySelector('input[type="radio"]');
    radio.addEventListener('change', () => {
      if (radio.checked) {
        selectedStreamId = String(timestamp);
        // Update visual selection
        container.querySelectorAll('.sub-card[data-kind="stream"], .sub-card[data-kind="video-file"]').forEach(c => c.classList.remove('selected-stream'));
        card.classList.add('selected-stream');
        updateCommandBar();
      }
    });

    // Copy URL button
    card.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url)
        .then(() => showToast('URL copied!'))
        .catch(() => showToast('Copy failed', true));
    });

    // Direct download handler
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

    // Insert after video files section header
    const sectionHeader = container.querySelector('.section-header[data-section="video-files"]');
    if (sectionHeader) {
      sectionHeader.after(card);
    } else {
      container.appendChild(card);
    }
  }

  function appendSubtitleCard(id, item) {
    showSection('subtitles');
    
    // Use URL-based ID to prevent duplicates from same-timestamp items
    const urlHash = item.url?.slice(-50) || Math.random().toString(36);
    const uniqueId = `${id}-${urlHash.replace(/[^a-zA-Z0-9]/g, '')}`;
    const timestamp = item.timestamp;
    
    if (container.querySelector(`[data-id="${CSS.escape(uniqueId)}"]`)) return;

    stateEmpty.style.display = 'none';
    stateLoading.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = uniqueId;
    card.dataset.timestamp = timestamp;
    card.dataset.kind = 'subtitle';
    card.dataset.subtitleUrl = item.url;

    const sizeTxt = formatSize(item.size);
    const metaParts = [item.format?.toUpperCase()];
    
    if (sizeTxt) metaParts.push(sizeTxt);
    metaParts.push(timeAgo(item.timestamp));
    
    const meta = metaParts.filter(Boolean).join(' · ');

    card.innerHTML = `
      <div class="card-main">
        <div class="card-selector">
          <input type="checkbox" data-sub-id="${timestamp}">
        </div>
        <span class="badge-format" style="background: #0077FF">${escHtml(item.format || '?')}</span>
        <div class="card-info">
          <div class="card-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
          <div class="card-url" title="${escHtml(item.url)}">${escHtml(item.url)}</div>
          <div class="card-meta">${escHtml(meta)}</div>
        </div>
      </div>
      <div class="card-actions">
        <a class="action-btn btn-download" href="${escHtml(item.url)}" download="${escHtml(item.name)}" target="_blank">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </a>
      </div>
    `;

    // Checkbox change handler
    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      updateSelectAllButton();
      updateCommandBar();
    });

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
        // Store the detected language code for use when building ffmpeg command
        subtitleLanguageCache.set(item.url, langCode);
      } else {
        langBadge.remove();
      }
    }).catch(() => {
      langBadge.remove();
    });

    // Insert after subtitles section header (or at the end if no video files)
    const sectionHeader = container.querySelector('.section-header[data-section="subtitles"]');
    if (sectionHeader) {
      sectionHeader.after(card);
    } else {
      container.appendChild(card);
    }
    
    updateSelectAllButton();
  }

  // ── Toast notification ────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.style.background = isError ? 'var(--bg-toast-error)' : 'var(--bg-toast)';
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

})();

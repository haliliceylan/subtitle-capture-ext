// ============================================================
// Subtitle Catcher — Popup Script
// ============================================================

// Language code to name mapping - keep in sync with service-worker.js LANGUAGE_CODE_MAP
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
    if (chrome.runtime.lastError) {
      console.error('Failed to get items:', chrome.runtime.lastError.message);
      showToast('Failed to load items', true);
      stateLoading.style.display = 'none';
      return;
    }
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
    
    // Initialize keyboard navigation
    initKeyboardNavigation();

    // Render items in sections
    hlsDashStreams.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendStreamCard(`stream-${item.timestamp}`, item));
    otherStreams.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendStreamCard(`stream-${item.timestamp}`, item));
    videoFiles.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendVideoFileCard(`video-${item.timestamp}`, item));
    subList.sort((a, b) => b.timestamp - a.timestamp).forEach((item) => appendSubtitleCard(`sub-${item.timestamp}`, item));

    updateCommandBar();
    updateSelectAllButton();
    updateSectionEmptyStates();
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
      updateSectionEmptyStates();
    }
  });

  btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ cmd: 'CLEAR_ITEMS', tabId }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to clear items:', chrome.runtime.lastError.message);
        showToast('Failed to clear items', true);
        return;
      }
      // Remove both old cards and new list items
      container.querySelectorAll('.sub-card, .list-item-wrapper').forEach(c => c.remove());
      // Remove section headers and empty states
      container.querySelectorAll('.section-header, .section-empty-state').forEach(h => h.remove());
      streamsSection = null;
      subtitlesSection = null;
      videoFilesSection = null;
      streamItems = {};
      subtitleItems = {};
      videoFileItems = {};
      selectedStreamId = null;
      btnSelectAllSection = null;
      languageCache.clear();
      subtitleLanguageCache.clear();
      selectedVariants.clear();
      updateSelectAllButton();
      updateCommandBar();
      updateSectionEmptyStates();
      showEmpty();
      showToast('Cleared');
    });
  });

  // Theme toggle button
  btnThemeToggle.addEventListener('click', cycleTheme);

  // Select all subtitles functionality - now in section header
  function handleSelectAllClick() {
    const checkboxes = container.querySelectorAll('.list-item[data-kind="subtitle"] input[type="checkbox"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      // Update visual selection state on the parent list-item
      const listItem = cb.closest('.list-item');
      if (listItem) {
        if (!allChecked) {
          listItem.classList.add('selected');
        } else {
          listItem.classList.remove('selected');
        }
      }
    });

    updateSelectAllButton();
    updateCommandBar();
    showToast(allChecked ? 'All subtitles deselected' : 'All subtitles selected');
  }

  // Helper function to get stream item with variant URL if selected
  function getEffectiveStreamItem(streamId) {
    // streamId is the URL
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

  // Helper function to get selected variant info for display
  function getSelectedVariantInfo(streamId) {
    const selectedVariant = selectedVariants.get(streamId);
    if (selectedVariant && selectedVariant.variant) {
      return selectedVariant.variant;
    }
    return null;
  }

  // Command bar MPV button
  btnCommandMpv.addEventListener('click', async () => {
    if (!selectedStreamId) return;
    
    setButtonLoading(btnCommandMpv, true);
    
    const streamItem = getEffectiveStreamItem(selectedStreamId);
    
    if (!streamItem) {
      showToast('Stream not found', true);
      setButtonLoading(btnCommandMpv, false);
      return;
    }
    
    const selectedSubs = getSelectedSubtitles();
    
    chrome.runtime.sendMessage({ cmd: 'BUILD_MPV', streamItem, subtitleItems: selectedSubs }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to build mpv command:', chrome.runtime.lastError.message);
        showToast('Failed to build mpv command', true);
        setButtonLoading(btnCommandMpv, false);
        return;
      }
      if (response?.command) {
        try {
          await navigator.clipboard.writeText(response.command);
          showToast('mpv command copied!');
        } catch {
          showToast('Copy failed', true);
        }
      } else {
        showToast('Failed to build command', true);
      }
      setButtonLoading(btnCommandMpv, false);
    });
  });

  // Command bar FFMPEG button - copies command immediately
  btnCommandFfmpeg.addEventListener('click', async () => {
    if (!selectedStreamId) return;
    
    setButtonLoading(btnCommandFfmpeg, true);
    
    const streamItem = getEffectiveStreamItem(selectedStreamId);
    
    if (!streamItem) {
      showToast('Stream not found', true);
      setButtonLoading(btnCommandFfmpeg, false);
      return;
    }
    
    const selectedSubs = getSelectedSubtitles();
    const outputFormat = ffmpegFormatSelect?.value || 'mp4';
    
    chrome.runtime.sendMessage({ cmd: 'BUILD_FFMPEG', streamItem, subtitleItems: selectedSubs, outputFormat, outputFilename: tabTitle }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to build ffmpeg command:', chrome.runtime.lastError.message);
        showToast('Failed to build ffmpeg command', true);
        setButtonLoading(btnCommandFfmpeg, false);
        return;
      }
      if (response?.command) {
        try {
          await navigator.clipboard.writeText(response.command);
          showToast('ffmpeg command copied!');
        } catch {
          showToast('Copy failed', true);
        }
      } else {
        showToast('Failed to build command', true);
      }
      setButtonLoading(btnCommandFfmpeg, false);
    });
  });

  function updateSelectAllButton() {
    const checkboxes = container.querySelectorAll('.list-item[data-kind="subtitle"] input[type="checkbox"]');
    const subtitleCount = checkboxes.length;

    if (!btnSelectAllSection) return;

    if (subtitleCount === 0) {
      btnSelectAllSection.style.display = 'none';
    } else {
      btnSelectAllSection.style.display = 'block';
      const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
      const allChecked = checkedCount === subtitleCount;
      btnSelectAllSection.textContent = allChecked ? 'Deselect all' : 'Select all';
      btnSelectAllSection.classList.toggle('all-selected', allChecked);
      
      // Update button title to show count
      btnSelectAllSection.title = `${checkedCount} of ${subtitleCount} selected`;
    }
  }

  function updateCommandBar() {
    const selectedSubs = getSelectedSubtitles();
    const subtitleCount = selectedSubs.length;
    const hasStream = !!selectedStreamId;

    // Get stream info if a stream is selected
    let streamItem = null;
    let streamName = '';
    let streamFormat = '';
    let streamResolution = '';
    let streamSize = '';
    let variantInfo = '';

    if (hasStream) {
      streamItem = getEffectiveStreamItem(selectedStreamId);
      streamName = streamItem?.name || 'Unknown';
      streamFormat = streamItem?.format?.toUpperCase() || '';
      streamResolution = streamItem?.resolution || '';
      streamSize = streamItem?.size ? formatSize(streamItem.size) : '';

      // If a variant is selected, show variant info in command bar
      const selectedVariant = selectedVariants.get(selectedStreamId);
      if (selectedVariant && selectedVariant.variant) {
        const v = selectedVariant.variant;
        // Build variant display string (e.g., "1080p" or "1080p H.264")
        const variantParts = [];
        if (v.resolution) variantParts.push(v.resolution);
        else if (v.name) variantParts.push(v.name);
        if (v.codec && !v.resolution) variantParts.push(v.codec);

        if (variantParts.length > 0) {
          variantInfo = ` (${variantParts.join(' ')})`;
        }
        // Update resolution from variant
        if (v.resolution) streamResolution = v.resolution;
      }
    }

    // Calculate total size estimate (stream + subtitles)
    let totalSize = 0;
    if (streamItem?.size) totalSize += streamItem.size;
    selectedSubs.forEach(sub => {
      if (sub.size) totalSize += sub.size;
    });
    const totalSizeFormatted = totalSize > 0 ? ` (~${formatSize(totalSize)})` : '';

    // Determine selection state and update UI
    const selectionState = {
      nothing: !hasStream && subtitleCount === 0,
      streamOnly: hasStream && subtitleCount === 0,
      streamWithSubs: hasStream && subtitleCount > 0,
      subsOnly: !hasStream && subtitleCount > 0
    };

    // Update selection summary text
    if (selectionState.nothing) {
      commandBar.classList.add('disabled');
      commandSelection.innerHTML = '<span class="empty">Select a stream or subtitles to begin</span>';
    } else if (selectionState.streamOnly) {
      commandBar.classList.remove('disabled');
      const formatBadge = streamFormat ? `<span class="format-badge">${escHtml(streamFormat)}</span>` : '';
      const resBadge = streamResolution ? `<span class="resolution-badge">${escHtml(streamResolution)}</span>` : '';
      commandSelection.innerHTML = `Selected: ${formatBadge} ${resBadge} <span class="stream-name">${escHtml(streamName)}${escHtml(variantInfo)}</span><span class="size-estimate">${escHtml(totalSizeFormatted)}</span>`;
    } else if (selectionState.streamWithSubs) {
      commandBar.classList.remove('disabled');
      const formatBadge = streamFormat ? `<span class="format-badge">${escHtml(streamFormat)}</span>` : '';
      const resBadge = streamResolution ? `<span class="resolution-badge">${escHtml(streamResolution)}</span>` : '';
      commandSelection.innerHTML = `Selected: ${formatBadge} ${resBadge} <span class="stream-name">${escHtml(streamName)}${escHtml(variantInfo)}</span> + <span class="subtitle-count">${subtitleCount} subtitle${subtitleCount !== 1 ? 's' : ''}</span><span class="size-estimate">${escHtml(totalSizeFormatted)}</span>`;
    } else if (selectionState.subsOnly) {
      commandBar.classList.remove('disabled');
      commandSelection.innerHTML = `Selected: <span class="subtitle-count">${subtitleCount} subtitle${subtitleCount !== 1 ? 's' : ''}</span><span class="size-estimate">${escHtml(totalSizeFormatted)}</span>`;
    }

    // Update button states based on selection
    updateCommandBarButtons(selectionState, hasStream, subtitleCount);
  }

  function updateCommandBarButtons(selectionState, hasStream, subtitleCount) {
    // MPV button: enabled when stream is selected
    btnCommandMpv.disabled = !hasStream;

    // FFMPEG button: enabled when stream is selected
    btnCommandFfmpeg.disabled = !hasStream;
    ffmpegFormatSelect.disabled = !hasStream;
  }

  // Store detected language codes for subtitles
  const subtitleLanguageCache = new Map();

  function getSelectedSubtitles() {
    return Array.from(container.querySelectorAll('.list-item[data-kind="subtitle"] input[type="checkbox"]:checked'))
      .map(cb => {
        const listItem = cb.closest('.list-item');
        const url = listItem?.dataset.subtitleUrl;
        if (!url) return null;

        // Find by URL - guaranteed unique
        const foundItem = Object.values(subtitleItems).find(s => s.url === url);
        if (!foundItem) return null;

        // Include detected language code and name if available
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

  /**
   * Builds a variant row HTML for inline display
   * @param {Object} variant - The variant data
   * @param {number} index - The variant index
   * @param {string} streamUrlHash - Hashed stream URL for radio name
   * @returns {string} HTML string for variant row
   */
  function buildVariantRowHtml(variant, index, streamUrlHash) {
    const estimatedSize = variant.estimatedSizeFormatted || '';
    const variantQuality = variant.resolution || '';
    const variantMeta = variant.bitrate || '';
    const variantCodecs = variant.codec || '';
    
    // Audio codec for variant - show only if non-AAC
    const audioCodec = variant.audioCodec || '';
    const audioCodecBadge = audioCodec && !audioCodec.toLowerCase().includes('aac')
      ? `<span class="item-audio-codec" title="Audio: ${escHtml(audioCodec)}">${escHtml(audioCodec)}</span>`
      : '';
    
    // Frame rate for variant - show when informative (>30 or non-standard)
    let frameRateBadge = '';
    const frameRate = variant.frameRate || '';
    if (frameRate) {
      const fps = parseFloat(frameRate);
      const isStandard = fps === 24 || fps === 25 || fps === 30;
      const isHighOrNonStandard = fps > 30 || (!isStandard && fps > 0);
      if (isHighOrNonStandard) {
        frameRateBadge = `<span class="item-frame-rate" title="Frame rate: ${escHtml(frameRate)}">${escHtml(frameRate)}</span>`;
      }
    }
    
    // Audio languages for variant - compact badges
    let languageBadges = '';
    const audioLanguages = variant.audioLanguages || [];
    if (audioLanguages.length > 0) {
      const langCodes = audioLanguages.slice(0, 2).map(lang => lang.toUpperCase().slice(0, 2));
      const extraCount = audioLanguages.length - 2;
      const langText = extraCount > 0 ? `${langCodes[0]} +${extraCount}` : langCodes.join(' ');
      const fullLangs = audioLanguages.map(l => getLanguageName(l) || l).join(', ');
      languageBadges = `<span class="item-languages" title="Languages: ${escHtml(fullLangs)}">${escHtml(langText)}</span>`;
    }

    return `
      <div class="variant-row" data-variant-index="${index}" tabindex="0" role="listitem">
        <input type="radio" class="item-selector" name="variant-select-${streamUrlHash}" value="${index}" data-variant-index="${index}" tabindex="-1">
        <span class="item-name">${escHtml(variant.name)}</span>
        ${variantQuality ? `<span class="item-quality">${escHtml(variantQuality)}</span>` : ''}
        ${variantMeta ? `<span class="item-meta">${escHtml(variantMeta)}</span>` : ''}
        ${variantCodecs ? `<span class="item-codecs">${escHtml(variantCodecs)}</span>` : ''}
        ${audioCodecBadge}
        ${frameRateBadge}
        ${languageBadges}
        ${estimatedSize ? `<span class="item-size">${escHtml(estimatedSize)}</span>` : ''}
      </div>
    `;
  }

  // Empty state messages per section
  const SECTION_EMPTY_MESSAGES = {
    'streams': {
      icon: '📡',
      text: 'No streams detected yet.',
      hint: 'Play a video to see HLS/DASH streams.'
    },
    'video-files': {
      icon: '📼',
      text: 'No video files detected yet.',
      hint: 'Play a video to see direct video files.'
    },
    'subtitles': {
      icon: '📄',
      text: 'No subtitles detected yet.',
      hint: 'Play a video with captions to see subtitle files.'
    }
  };

  function createSections() {
    // Clear existing sections first
    container.querySelectorAll('.section-header, .section-empty-state').forEach(h => h.remove());
    btnSelectAllSection = null;

    // Create Streams section
    streamsSection = document.createElement('div');
    streamsSection.className = 'section-header';
    streamsSection.dataset.section = 'streams';
    streamsSection.innerHTML = `
      <div class="section-header-left">
        <span class="section-header-icon">📡</span> Streams
      </div>
    `;
    streamsSection.style.display = 'none';
    container.appendChild(streamsSection);
    
    // Create empty state for streams
    const streamsEmptyState = createEmptyStateElement('streams');
    streamsSection.after(streamsEmptyState);

    // Create Video Files section
    videoFilesSection = document.createElement('div');
    videoFilesSection.className = 'section-header';
    videoFilesSection.dataset.section = 'video-files';
    videoFilesSection.innerHTML = `
      <div class="section-header-left">
        <span class="section-header-icon">📼</span> Video Files
      </div>
    `;
    videoFilesSection.style.display = 'none';
    container.appendChild(videoFilesSection);
    
    // Create empty state for video files
    const videoFilesEmptyState = createEmptyStateElement('video-files');
    videoFilesSection.after(videoFilesEmptyState);

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
    
    // Create empty state for subtitles
    const subtitlesEmptyState = createEmptyStateElement('subtitles');
    subtitlesSection.after(subtitlesEmptyState);
  }
  
  function createEmptyStateElement(sectionName) {
    const emptyState = document.createElement('div');
    emptyState.className = 'section-empty-state';
    emptyState.dataset.sectionEmpty = sectionName;
    emptyState.style.display = 'none';
    
    const messages = SECTION_EMPTY_MESSAGES[sectionName];
    emptyState.innerHTML = `
      <div class="section-empty-state-icon">${messages.icon}</div>
      <div class="section-empty-state-text">${messages.text}</div>
      <div class="section-empty-state-hint">${messages.hint}</div>
    `;
    
    return emptyState;
  }
  
  function updateSectionEmptyStates() {
    // Check each section and show/hide empty state
    ['streams', 'video-files', 'subtitles'].forEach(sectionName => {
      const sectionHeader = container.querySelector(`.section-header[data-section="${sectionName}"]`);
      const emptyState = container.querySelector(`.section-empty-state[data-section-empty="${sectionName}"]`);
      
      if (!sectionHeader || !emptyState) return;
      
      // Check if section has any visible items
      const sectionVisible = sectionHeader.style.display !== 'none';
      let hasItems = false;
      
      if (sectionVisible) {
        // Look for items after the section header until the next section header or empty state
        let sibling = sectionHeader.nextElementSibling;
        while (sibling && !sibling.classList.contains('section-header') && !sibling.classList.contains('section-empty-state')) {
          if (sibling.classList.contains('list-item-wrapper') && sibling.style.display !== 'none') {
            hasItems = true;
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }
      
      // Show empty state if section is visible but has no items
      if (sectionVisible && !hasItems) {
        emptyState.style.display = 'block';
      } else {
        emptyState.style.display = 'none';
      }
    });
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
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function timeAgo(ts) {
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    return `${Math.round(diff / 3600)}h ago`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Store selected variant info for each stream
  const selectedVariants = new Map();

  // ── Card Creation Helpers ─────────────────────────────────

  /**
   * Generates a unique ID from id and URL
   * @param {string} id - Base ID
   * @param {string} url - URL to hash
   * @returns {string} Unique ID
   */
  function generateUniqueId(id, url) {
    const urlHash = url?.slice(-50) || Math.random().toString(36);
    return `${id}-${urlHash.replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  /**
   * Checks if a card with the given ID already exists
   * @param {string} uniqueId - Unique ID to check
   * @returns {boolean} True if duplicate exists
   */
  function checkDuplicate(uniqueId) {
    return !!container.querySelector(`.list-item-wrapper[data-id="${CSS.escape(uniqueId)}"], .sub-card[data-id="${CSS.escape(uniqueId)}"]`);
  }

  /**
   * Creates a base card element with common properties
   * @param {string} uniqueId - Unique ID for the card
   * @param {number} timestamp - Timestamp for the card
   * @param {string} kind - Kind of card (stream, video-file, subtitle)
   * @returns {HTMLElement} The created card element
   */
  function createBaseCard(uniqueId, timestamp, kind) {
    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = uniqueId;
    card.dataset.timestamp = timestamp;
    card.dataset.kind = kind;
    return card;
  }

  /**
   * Shows the card container and hides empty/loading states
   */
  function showCardContainer() {
    stateEmpty.style.display = 'none';
    stateLoading.style.display = 'none';
  }

  /**
   * Inserts a card after its section header
   * @param {HTMLElement} card - The card to insert
   * @param {string} sectionName - Name of the section (streams, video-files, subtitles)
   */
  function insertCardAfterSection(card, sectionName) {
    const sectionHeader = container.querySelector(`.section-header[data-section="${sectionName}"]`);
    if (sectionHeader) {
      sectionHeader.after(card);
    } else {
      container.appendChild(card);
    }
  }

  /**
   * Builds a compact list item HTML
   * @param {Object} options - The item options
   * @param {string} options.kind - Item kind (stream, subtitle, video-file)
   * @param {string} options.id - Unique ID
   * @param {string} options.url - Item URL
   * @param {string} options.name - Item name
   * @param {string} options.format - Format badge text
   * @param {string} options.badgeClass - Badge CSS class (e.g., 'badge-hls', 'badge-vtt')
   * @param {string} options.inputType - Type of input (radio or checkbox)
   * @param {string} options.inputName - Name attribute for radio inputs
   * @param {string} options.inputValue - Value attribute for the input
   * @param {string} options.inputDataAttr - Data attribute name for the input
   * @param {string} options.quality - Quality text (e.g., '1080p')
   * @param {string} options.meta - Additional meta text (e.g., 'HDR')
   * @param {string} options.size - Size text (e.g., '3.2GB')
   * @param {string} options.time - Time text (e.g., '2m')
   * @param {boolean} options.hasVariants - Whether this item has variants
   * @param {string} options.audioCodec - Audio codec (e.g., "Opus", "AC3") - shown when non-AAC
   * @param {string} options.frameRate - Frame rate (e.g., "60fps") - shown when >30 or non-standard
   * @param {string[]} options.audioLanguages - Array of language codes (e.g., ["en", "ja"])
   * @param {boolean} options.hasActions - Whether to show kebab menu for actions
   * @returns {string} HTML string for list item
   */
  function buildListItemHtml(options) {
    const {
      kind,
      id,
      url,
      name,
      format,
      badgeClass = '',
      inputType,
      inputName,
      inputValue,
      inputDataAttr,
      quality = '',
      meta = '',
      size = '',
      duration = '',
      time = '',
      hasVariants = false,
      audioCodec = '',
      frameRate = '',
      audioLanguages = [],
      hasActions = false
    } = options;

    const inputNameAttr = inputName ? ` name="${inputName}"` : '';
    const expandButton = hasVariants ? `<button class="btn-expand" data-action="expand" aria-label="Show variants" tabindex="-1">▼</button>` : '';
    
    // Build audio codec badge - show only if non-AAC and non-empty
    const audioCodecBadge = audioCodec && !audioCodec.toLowerCase().includes('aac')
      ? `<span class="item-audio-codec" title="Audio: ${escHtml(audioCodec)}">${escHtml(audioCodec)}</span>`
      : '';
    
    // Build frame rate badge - show only when informative (>30 or non-standard)
    let frameRateBadge = '';
    if (frameRate) {
      const fps = parseFloat(frameRate);
      // Show if >30, or non-standard values like 23.976, 59.94
      const isStandard = fps === 24 || fps === 25 || fps === 30;
      const isHighOrNonStandard = fps > 30 || (!isStandard && fps > 0);
      if (isHighOrNonStandard) {
        frameRateBadge = `<span class="item-frame-rate" title="Frame rate: ${escHtml(frameRate)}">${escHtml(frameRate)}</span>`;
      }
    }
    
    // Build compact language badges (e.g., "EN", "JA", "EN +2")
    let languageBadges = '';
    if (audioLanguages && audioLanguages.length > 0) {
      const langCodes = audioLanguages.slice(0, 2).map(lang => lang.toUpperCase().slice(0, 2));
      const extraCount = audioLanguages.length - 2;
      const langText = extraCount > 0 ? `${langCodes[0]} +${extraCount}` : langCodes.join(' ');
      const fullLangs = audioLanguages.map(l => getLanguageName(l) || l).join(', ');
      languageBadges = `<span class="item-languages" title="Languages: ${escHtml(fullLangs)}">${escHtml(langText)}</span>`;
    }
    
    // Build kebab menu button for actions
    const kebabMenu = hasActions
      ? `<button class="btn-kebab" data-action="kebab" aria-label="Actions" tabindex="-1">⋮</button>`
      : '';

    // Build action buttons group (kebab + expand together at rightmost)
    const actionButtons = (kebabMenu || expandButton)
      ? `<span class="item-actions">${kebabMenu}${expandButton}</span>`
      : '';

    return `
      <div class="list-item" data-kind="${kind}" data-id="${id}" data-url="${escHtml(url)}" ${inputDataAttr}="${escHtml(inputValue)}" tabindex="0" role="listitem">
        <input type="${inputType}" class="item-selector"${inputNameAttr} value="${escHtml(inputValue)}" ${inputDataAttr}="${escHtml(inputValue)}" tabindex="-1">
        <span class="badge-format ${badgeClass}">${escHtml(format || '?')}</span>
        <span class="item-name" title="${escHtml(name)}">${escHtml(name)}</span>
        ${quality ? `<span class="item-quality">${escHtml(quality)}</span>` : ''}
        ${meta ? `<span class="item-meta">${escHtml(meta)}</span>` : ''}
        ${audioCodecBadge}
        ${frameRateBadge}
        ${languageBadges}
        ${duration ? `<span class="item-duration">${escHtml(duration)}</span>` : ''}
        ${size ? `<span class="item-size">${escHtml(size)}</span>` : ''}
        ${time ? `<span class="item-time">${escHtml(time)}</span>` : ''}
        ${actionButtons}
      </div>
    `;
  }

  /**
   * Builds the card-main inner HTML for stream and video file cards
   * @param {Object} item - The item data
   * @param {string} meta - Formatted meta string
   * @param {string} badgeColor - Badge background color
   * @param {string} inputType - Type of input (radio or checkbox)
   * @param {string} inputName - Name attribute for radio inputs
   * @param {string} inputValue - Value attribute for the input
   * @param {string} inputDataAttr - Data attribute name for the input
   * @param {boolean} showCopyButton - Whether to show the copy button
   * @returns {string} HTML string for card-main
   */
  function buildCardMainHtml(item, meta, badgeColor, inputType, inputName, inputValue, inputDataAttr, showCopyButton) {
    const inputNameAttr = inputName ? ` name="${inputName}"` : '';
    const copyButton = showCopyButton ? `
        <button class="action-btn btn-icon" data-action="copy" title="Copy URL">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>
      ` : '';

    return `
      <div class="card-main">
        <div class="card-selector">
          <input type="${inputType}"${inputNameAttr} value="${inputValue}" ${inputDataAttr}="${inputValue}">
        </div>
        <span class="badge-format" style="background: ${badgeColor}">${escHtml(item.format || '?')}</span>
        <div class="card-info">
          <div class="card-name" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
          <div class="card-url" title="${escHtml(item.url)}">${escHtml(item.url)}</div>
          <div class="card-meta">${escHtml(meta)}</div>
        </div>
        ${copyButton}
      </div>
    `;
  }

  /**
   * Attaches common event handlers to a card
   * @param {HTMLElement} card - The card element
   * @param {Object} item - The item data
   * @param {Object} options - Event handler options
   */
  function attachCardEventHandlers(card, item, options = {}) {
    // Copy URL button handler
    if (options.showCopyButton) {
      card.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
        navigator.clipboard.writeText(item.url)
          .then(() => showToast('URL copied!'))
          .catch(() => showToast('Copy failed', true));
      });
    }

    // Radio button change handler for stream/video-file cards
    if (options.onRadioChange) {
      const radio = card.querySelector('input[type="radio"]');
      radio?.addEventListener('change', () => {
        if (radio.checked) {
          options.onRadioChange(card, radio);
        }
      });
    }

    // Checkbox change handler for subtitle cards
    if (options.onCheckboxChange) {
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox?.addEventListener('change', () => {
        options.onCheckboxChange();
      });
    }

    // Direct download handler for video files
    if (options.onDirectDownload) {
      card.querySelector('[data-action="direct-download"]')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          cmd: 'DOWNLOAD_VIDEO',
          url: item.url,
          filename: item.name,
          headers: item.headers || {}
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to download video:', chrome.runtime.lastError.message);
            showToast('Failed to start download', true);
            return;
          }
          if (response?.success) {
            showToast('Download started!');
          } else {
            showToast('Download failed: ' + (response?.error || 'Unknown error'), true);
          }
        });
      });
    }
  }

  function appendStreamCard(id, item) {
    showSection('streams');

    const uniqueId = generateUniqueId(id, item.url);
    const timestamp = item.timestamp;
    const urlHash = item.url?.slice(-50) || Math.random().toString(36);

    if (checkDuplicate(uniqueId)) return;

    showCardContainer();

    // Determine badge class based on format
    const format = item.format?.toUpperCase() || '?';
    let badgeClass = 'badge-hls';
    if (format === 'DASH') badgeClass = 'badge-dash';
    else if (format === 'M3U8') badgeClass = 'badge-hls';

    // Build quality text
    const quality = item.resolution || item.quality || '';

    // Build meta text (HDR, codec, etc.)
    const metaParts = [];
    if (item.hdr) metaParts.push('HDR');
    if (item.codec && !quality) metaParts.push(item.codec);
    const meta = metaParts.join(' · ');

    // Size, duration and time
    const sizeTxt = formatSize(item.size);
    const timeTxt = timeAgo(item.timestamp);
    const durationTxt = item.durationFormatted || '';

    // Check if has variants
    const hasVariants = item.isMasterPlaylist && item.variants && item.variants.length > 0;
    const variantCount = hasVariants ? item.variants.length : 0;

    // Extract audio codec - from top-level or first variant
    let audioCodec = item.audioCodec || '';
    if (!audioCodec && hasVariants && item.variants[0]?.audioCodec) {
      audioCodec = item.variants[0].audioCodec;
    }

    // Extract frame rate - from top-level or first variant
    let frameRate = item.frameRate || '';
    if (!frameRate && hasVariants && item.variants[0]?.frameRate) {
      frameRate = item.variants[0].frameRate;
    }

    // Extract audio languages - from top-level or first variant
    let audioLanguages = item.audioLanguages || [];
    if ((!audioLanguages || audioLanguages.length === 0) && hasVariants && item.variants[0]?.audioLanguages) {
      audioLanguages = item.variants[0].audioLanguages;
    }

    // Create list item using new compact layout
    const listItemHtml = buildListItemHtml({
      kind: 'stream',
      id: uniqueId,
      url: item.url,
      name: item.name,
      format: format,
      badgeClass: badgeClass,
      inputType: 'radio',
      inputName: 'stream-select',
      inputValue: item.url,
      inputDataAttr: 'data-stream-id',
      quality: quality,
      meta: meta,
      size: sizeTxt,
      duration: durationTxt,
      time: timeTxt,
      hasVariants: hasVariants,
      audioCodec: audioCodec,
      frameRate: frameRate,
      audioLanguages: audioLanguages,
      hasActions: true
    });

    // Create a container for the list item and potential variants
    const wrapper = document.createElement('div');
    wrapper.className = 'list-item-wrapper';
    wrapper.dataset.id = uniqueId;
    wrapper.innerHTML = listItemHtml;

    const listItem = wrapper.querySelector('.list-item');
    listItem.dataset.streamUrl = item.url;
    listItem.dataset.timestamp = timestamp;

    // Add variant count badge to stream row if has variants
    if (hasVariants) {
      const variantCountBadge = document.createElement('span');
      variantCountBadge.className = 'variant-count';
      variantCountBadge.textContent = `${variantCount} variant${variantCount !== 1 ? 's' : ''}`;
      variantCountBadge.dataset.variantCount = 'true';
      
      // Insert before the action buttons group (kebab + expand)
      const actionButtons = listItem.querySelector('.item-actions');
      if (actionButtons) {
        actionButtons.before(variantCountBadge);
      }
    }

    // Add variant rows if this is a master playlist
    if (hasVariants) {
      // Create variant rows inline (not in a separate container)
      item.variants.forEach((variant, index) => {
        const variantRowHtml = buildVariantRowHtml(variant, index, urlHash);
        const variantRowWrapper = document.createElement('div');
        variantRowWrapper.innerHTML = variantRowHtml;
        const variantRow = variantRowWrapper.firstElementChild;
        
        // Initially hidden
        variantRow.style.display = 'none';
        variantRow.classList.add('variant-inline');
        
        // Store variant data for selection
        variantRow.dataset.variantUrl = variant.url;
        variantRow.dataset.variantName = variant.name;

        // Variant selection handler
        const variantRadio = variantRow.querySelector('input[type="radio"]');
        variantRadio.addEventListener('change', () => {
          if (variantRadio.checked) {
            // Update visual selection
            wrapper.querySelectorAll('.variant-row').forEach(v => v.classList.remove('selected'));
            variantRow.classList.add('selected');

            // Store selected variant
            selectedVariants.set(item.url, {
              index: index,
              variant: variant
            });

            // Also select the parent stream
            const parentRadio = listItem.querySelector('input[type="radio"]');
            if (parentRadio && !parentRadio.checked) {
              parentRadio.checked = true;
              parentRadio.dispatchEvent(new Event('change'));
            }

            updateCommandBar();
          }
        });

        // Click on variant row to select radio
        variantRow.addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') {
            variantRadio.checked = true;
            variantRadio.dispatchEvent(new Event('change'));
          }
        });

        wrapper.appendChild(variantRow);
      });

      // Toggle expand/collapse
      const expandBtn = listItem.querySelector('.btn-expand');
      if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isExpanded = expandBtn.classList.contains('expanded');
          
          // Toggle expand button state
          expandBtn.classList.toggle('expanded', !isExpanded);
          
          // Show/hide variant rows
          const variantRows = wrapper.querySelectorAll('.variant-row.variant-inline');
          variantRows.forEach(row => {
            row.style.display = isExpanded ? 'none' : 'flex';
          });
          
          // Show/hide variant count badge
          const variantCountBadge = listItem.querySelector('.variant-count');
          if (variantCountBadge) {
            variantCountBadge.style.display = isExpanded ? 'inline' : 'none';
          }
        });
      }
    }

    // Radio button change handler
    const radio = listItem.querySelector('input[type="radio"]');
    radio.addEventListener('change', () => {
      if (radio.checked) {
        // Remove .selected class from all stream and video-file items
        container.querySelectorAll('.list-item[data-kind="stream"], .list-item[data-kind="video-file"]').forEach(c => c.classList.remove('selected'));
        // Add .selected class to this item
        listItem.classList.add('selected');
        // Update selected stream ID
        selectedStreamId = item.url;
        updateCommandBar();
      }
    });

    // Click on list item to select radio
    listItem.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && !e.target.classList.contains('variant-count')) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    });

    // Kebab menu click handler
    const kebabBtn = listItem.querySelector('.btn-kebab');
    if (kebabBtn) {
      kebabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showKebabMenu(kebabBtn, item, 'stream');
      });
    }

    insertCardAfterSection(wrapper, 'streams');
  }

  function appendVideoFileCard(id, item) {
    showSection('video-files');

    const uniqueId = generateUniqueId(id, item.url);
    const timestamp = item.timestamp;

    if (checkDuplicate(uniqueId)) return;

    showCardContainer();

    // Build quality text
    const quality = item.resolution || item.quality || '';

    // Size and time
    const sizeTxt = formatSize(item.size);
    const timeTxt = timeAgo(item.timestamp);

    // Create list item using new compact layout
    const listItemHtml = buildListItemHtml({
      kind: 'video-file',
      id: uniqueId,
      url: item.url,
      name: item.name,
      format: item.format?.toUpperCase() || 'MP4',
      badgeClass: 'badge-mp4',
      inputType: 'radio',
      inputName: 'stream-select',
      inputValue: String(timestamp),
      inputDataAttr: 'data-stream-id',
      quality: quality,
      size: sizeTxt,
      time: timeTxt,
      hasVariants: false,
      hasActions: true
    });

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'list-item-wrapper';
    wrapper.dataset.id = uniqueId;
    wrapper.innerHTML = listItemHtml;

    const listItem = wrapper.querySelector('.list-item');
    listItem.dataset.timestamp = timestamp;

    // Radio button change handler
    const radio = listItem.querySelector('input[type="radio"]');
    radio.addEventListener('change', () => {
      if (radio.checked) {
        // Remove .selected class from all stream and video-file items
        container.querySelectorAll('.list-item[data-kind="stream"], .list-item[data-kind="video-file"]').forEach(c => c.classList.remove('selected'));
        // Add .selected class to this item
        listItem.classList.add('selected');
        // Update selected stream ID
        selectedStreamId = String(timestamp);
        updateCommandBar();
      }
    });

    // Click on list item to select radio
    listItem.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    });

    // Kebab menu click handler
    const kebabBtn = listItem.querySelector('.btn-kebab');
    if (kebabBtn) {
      kebabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showKebabMenu(kebabBtn, item, 'video-file');
      });
    }

    insertCardAfterSection(wrapper, 'video-files');
  }

  function appendSubtitleCard(id, item) {
    showSection('subtitles');

    const uniqueId = generateUniqueId(id, item.url);
    const timestamp = item.timestamp;

    if (checkDuplicate(uniqueId)) return;

    showCardContainer();

    // Determine badge class based on format
    const format = item.format?.toUpperCase() || '?';
    let badgeClass = 'badge-vtt';
    if (format === 'SRT') badgeClass = 'badge-srt';
    else if (format === 'ASS' || format === 'SSA') badgeClass = 'badge-ass';
    else if (format === 'VTT') badgeClass = 'badge-vtt';

    // Size and time
    const sizeTxt = formatSize(item.size);
    const timeTxt = timeAgo(item.timestamp);

    // Create list item using new compact layout
    const listItemHtml = buildListItemHtml({
      kind: 'subtitle',
      id: uniqueId,
      url: item.url,
      name: item.name,
      format: format,
      badgeClass: badgeClass,
      inputType: 'checkbox',
      inputName: null,
      inputValue: timestamp,
      inputDataAttr: 'data-sub-id',
      size: sizeTxt,
      time: timeTxt,
      hasVariants: false,
      hasActions: true
    });

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'list-item-wrapper';
    wrapper.dataset.id = uniqueId;
    wrapper.innerHTML = listItemHtml;

    const listItem = wrapper.querySelector('.list-item');
    listItem.dataset.subtitleUrl = item.url;
    listItem.dataset.timestamp = timestamp;

    // Checkbox change handler
    const checkbox = listItem.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      // Update visual selection state
      if (checkbox.checked) {
        listItem.classList.add('selected');
      } else {
        listItem.classList.remove('selected');
      }
      updateSelectAllButton();
      updateCommandBar();
    });

    // Click on list item to toggle checkbox
    listItem.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });

    // Kebab menu click handler
    const kebabBtn = listItem.querySelector('.btn-kebab');
    if (kebabBtn) {
      kebabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showKebabMenu(kebabBtn, item, 'subtitle');
      });
    }

    // Add language detection for subtitles
    const langBadge = document.createElement('span');
    langBadge.className = 'badge-language loading';
    langBadge.style.cssText = 'background: #28a745; color: #fff; font-size: 9px; font-weight: 600; padding: 2px 5px; border-radius: 4px; margin-left: 6px; text-transform: uppercase; opacity: 1; transition: opacity 0.2s; flex-shrink: 0;';
    langBadge.textContent = '';
    listItem.querySelector('.item-name').after(langBadge);

    // Detect language asynchronously
    detectSubtitleLanguage(item.url, item.headers).then(langCode => {
      if (langCode) {
        const langName = getLanguageName(langCode);
        langBadge.textContent = langName || langCode.toUpperCase();
        langBadge.title = `Detected language: ${langName || langCode}`;
        langBadge.classList.remove('loading');
        langBadge.style.opacity = '1';
        // Store the detected language code for use when building ffmpeg command
        subtitleLanguageCache.set(item.url, langCode);
      } else {
        langBadge.remove();
      }
    }).catch(() => {
      langBadge.remove();
    });

    insertCardAfterSection(wrapper, 'subtitles');
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

  // ── Keyboard Navigation ───────────────────────────────────
  let focusedItemIndex = -1;
  let focusableItems = [];
  
  function initKeyboardNavigation() {
    // Add keyboard event listener to container
    container.addEventListener('keydown', handleKeyboardNavigation);
    
    // Also listen on document for Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleEscapeKey();
      }
    });
    
    // Update focusable items when DOM changes
    const observer = new MutationObserver(() => {
      updateFocusableItems();
    });
    observer.observe(container, { childList: true, subtree: true });
  }
  
  function updateFocusableItems() {
    // Get all list items and variant rows that are visible
    focusableItems = Array.from(container.querySelectorAll('.list-item, .variant-row:not([style*="display: none"])'));
  }
  
  function handleKeyboardNavigation(e) {
    // Only handle if we're inside the list container
    if (!container.contains(e.target)) return;
    
    const isListItem = e.target.classList.contains('list-item') || 
                       e.target.classList.contains('variant-row');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        navigateToNextItem();
        break;
      case 'ArrowUp':
        e.preventDefault();
        navigateToPreviousItem();
        break;
      case 'Enter':
        if (isListItem) {
          e.preventDefault();
          activateItem(e.target);
        }
        break;
      case ' ':
        if (isListItem) {
          e.preventDefault();
          activateItem(e.target);
        }
        break;
    }
  }
  
  function navigateToNextItem() {
    updateFocusableItems();
    if (focusableItems.length === 0) return;
    
    focusedItemIndex++;
    if (focusedItemIndex >= focusableItems.length) {
      focusedItemIndex = 0; // Wrap around
    }
    
    focusItem(focusableItems[focusedItemIndex]);
  }
  
  function navigateToPreviousItem() {
    updateFocusableItems();
    if (focusableItems.length === 0) return;
    
    focusedItemIndex--;
    if (focusedItemIndex < 0) {
      focusedItemIndex = focusableItems.length - 1; // Wrap around
    }
    
    focusItem(focusableItems[focusedItemIndex]);
  }
  
  function focusItem(item) {
    // Remove keyboard-focus class from all items
    container.querySelectorAll('.keyboard-focus').forEach(el => {
      el.classList.remove('keyboard-focus');
    });
    
    // Add keyboard-focus class and focus
    item.classList.add('keyboard-focus');
    item.focus();
    
    // Scroll into view if needed
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  
  function activateItem(item) {
    const input = item.querySelector('input[type="radio"], input[type="checkbox"]');
    if (input) {
      if (input.type === 'radio') {
        input.checked = true;
        input.dispatchEvent(new Event('change'));
      } else if (input.type === 'checkbox') {
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
      }
    }
  }
  
  function handleEscapeKey() {
    // Clear stream selection
    if (selectedStreamId) {
      selectedStreamId = null;
      
      // Uncheck all radio buttons
      container.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.checked = false;
      });
      
      // Remove selected class from all items
      container.querySelectorAll('.list-item.selected, .list-item.selected-stream').forEach(item => {
        item.classList.remove('selected', 'selected-stream');
      });
      
      // Clear variant selections
      selectedVariants.clear();
      container.querySelectorAll('.variant-row.selected').forEach(row => {
        row.classList.remove('selected');
      });
      
      updateCommandBar();
      showToast('Selection cleared');
    }
    
    // Also uncheck all checkboxes
    const checkedBoxes = container.querySelectorAll('.list-item[data-kind="subtitle"] input[type="checkbox"]:checked');
    if (checkedBoxes.length > 0) {
      checkedBoxes.forEach(cb => {
        cb.checked = false;
        cb.dispatchEvent(new Event('change'));
      });
    }
  }
  
  // ── Loading State Management ───────────────────────────────
  function setButtonLoading(button, isLoading) {
    if (isLoading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }
  
  function setLanguageBadgeLoading(badge, isLoading) {
    if (isLoading) {
      badge.classList.add('loading');
      badge.textContent = '';
    } else {
      badge.classList.remove('loading');
    }
  }

  // ── Kebab Menu Dropdown ───────────────────────────────────
  let activeDropdown = null;
  
  /**
   * Creates and shows a kebab menu dropdown
   * @param {HTMLElement} button - The kebab button that was clicked
   * @param {Object} item - The item data (url, name, etc.)
   * @param {string} itemType - The type of item ('stream', 'video-file', 'subtitle')
   */
  function showKebabMenu(button, item, itemType) {
    // Close any existing dropdown
    closeKebabMenu();
    
    // Create dropdown element
    const dropdown = document.createElement('div');
    dropdown.className = 'kebab-dropdown';
    dropdown.setAttribute('role', 'menu');
    
    // Build menu items based on item type
    const menuItems = [];

    // Streams and video files get Copy cURL option
    if (itemType === 'stream' || itemType === 'video-file') {
      menuItems.push({
        action: 'curl',
        label: 'Copy cURL',
        icon: '📋'
      });
    }
    
    // All items get Copy URL
    menuItems.push({
      action: 'copy',
      label: 'Copy URL',
      icon: '🔗'
    });
    
    // Build dropdown HTML
    dropdown.innerHTML = menuItems.map(mi => `
      <button class="kebab-dropdown-item" data-action="${mi.action}" role="menuitem">
        <span class="kebab-dropdown-icon">${mi.icon}</span>
        <span class="kebab-dropdown-label">${escHtml(mi.label)}</span>
      </button>
    `).join('');
    
    // Position dropdown below the button
    const rect = button.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
    dropdown.style.zIndex = '10000';
    
    // Add click handlers for menu items
    dropdown.querySelectorAll('.kebab-dropdown-item').forEach(menuItem => {
      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = menuItem.dataset.action;
        handleKebabAction(action, item, itemType);
        closeKebabMenu();
      });
    });
    
    // Add to document
    document.body.appendChild(dropdown);
    activeDropdown = dropdown;
    
    // Mark button as active
    button.classList.add('active');
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', closeKebabMenuOnOutsideClick);
    }, 0);
  }
  
  /**
   * Closes the active kebab menu dropdown
   */
  function closeKebabMenu() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
    // Remove active class from all kebab buttons
    document.querySelectorAll('.btn-kebab.active').forEach(btn => {
      btn.classList.remove('active');
    });
    document.removeEventListener('click', closeKebabMenuOnOutsideClick);
  }
  
  /**
   * Closes kebab menu when clicking outside
   */
  function closeKebabMenuOnOutsideClick(e) {
    if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.closest('.btn-kebab')) {
      closeKebabMenu();
    }
  }
  
  /**
   * Handles kebab menu actions
   * @param {string} action - The action to perform
   * @param {Object} item - The item data
   * @param {string} itemType - The type of item
   */
  async function handleKebabAction(action, item, itemType) {
    switch (action) {
      case 'copy':
        try {
          await navigator.clipboard.writeText(item.url);
          showToast('URL copied!');
        } catch {
          showToast('Copy failed', true);
        }
        break;

      case 'curl':
        // Build and copy curl command
        const headers = item.headers || {};
        let curlCmd = `curl -L "${item.url}"`;
        if (headers['User-Agent']) {
          curlCmd += ` -H "User-Agent: ${headers['User-Agent']}"`;
        }
        if (headers['Referer']) {
          curlCmd += ` -H "Referer: ${headers['Referer']}"`;
        }
        if (headers['Origin']) {
          curlCmd += ` -H "Origin: ${headers['Origin']}"`;
        }
        Object.entries(headers).forEach(([key, value]) => {
          if (!['User-Agent', 'Referer', 'Origin'].includes(key)) {
            curlCmd += ` -H "${key}: ${value}"`;
          }
        });
        curlCmd += ` -o "${(item.name || 'download').replace(/[^a-zA-Z0-9.]/g, '_')}"`;
        try {
          await navigator.clipboard.writeText(curlCmd);
          showToast('cURL command copied!');
        } catch {
          showToast('Copy failed', true);
        }
        break;
    }
  }

})();

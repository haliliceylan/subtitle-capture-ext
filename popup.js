// ============================================================
// Subtitle Catcher — Popup Script
// ============================================================

(async () => {
  const container = document.getElementById('list-container');
  const stateEmpty = document.getElementById('state-empty');
  const stateLoading = document.getElementById('state-loading');
  const btnClear = document.getElementById('btn-clear');
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
      showEmpty();
      showToast('Cleared');
    });
  });

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
    if (container.querySelector(`[data-id="${CSS.escape(id)}"]`)) return;

    stateEmpty.style.display = 'none';
    stateLoading.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = id;
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
        ${isStream ? `
        <button class="action-btn btn-download" data-action="mpv" style="background: #FF6B35; border-color: #FF6B35;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          mpv
        </button>` : `
        <a class="action-btn btn-download" data-action="download" href="${escHtml(item.url)}" download="${escHtml(item.name)}" target="_blank">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </a>`}
        ${hasHeaders ? `
        <button class="action-btn btn-headers" data-action="headers">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          Headers
        </button>` : ''}
      </div>
      ${hasHeaders ? `
      <div class="headers-panel" id="hp-${escHtml(id)}">
${buildHeadersText(item.headers)}
      </div>` : ''}
    `;

    card.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url)
        .then(() => showToast('URL copied!'))
        .catch(() => showToast('Copy failed', true));
    });

    if (isStream) {
      card.querySelector('[data-action="mpv"]')?.addEventListener('click', () => {
        const selectedSubs = Array.from(container.querySelectorAll('.sub-card[data-kind="subtitle"] input[type="checkbox"]:checked'))
          .map(cb => {
            const subCard = cb.closest('.sub-card');
            const subId = subCard?.dataset.id;
            if (!subId) return null;
            
            // Find the subtitle item by matching timestamp in the ID
            const timestamp = subId.replace('sub-', '');
            const foundItem = Object.values(subtitleItems).find(s => String(s.timestamp) === timestamp);
            return foundItem || null;
          })
          .filter(Boolean);

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
    }

    if (hasHeaders) {
      card.querySelector('[data-action="headers"]')?.addEventListener('click', () => {
        const panel = document.getElementById(`hp-${id}`);
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
      card.querySelector('.card-main').appendChild(checkbox);
    }

    container.appendChild(card);
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

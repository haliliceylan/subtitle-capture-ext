/**
 * Download Module for Stream + Subtitle Catcher Extension
 * Handles all chrome.downloads operations
 * @module modules/downloads
 */

import { FORBIDDEN_HEADERS } from './constants.js';

/**
 * Downloads a video file using the chrome.downloads API.
 * Filters out forbidden headers that the chrome.downloads API cannot handle.
 *
 * @param {string} url - The URL of the video to download
 * @param {string} filename - The suggested filename for the download (defaults to 'video.mp4')
 * @param {Object} [headers={}] - Optional headers to include with the download request
 * @returns {Promise<number>} A promise that resolves to the download ID
 * @throws {Error} If the download fails
 */
export async function downloadVideo(url, filename, headers = {}) {
  // Build headers array for chrome.downloads API
  // Filter out forbidden headers that chrome.downloads can't handle
  const headerArray = [];
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!FORBIDDEN_HEADERS.has(lowerName)) {
      headerArray.push({ name, value });
    }
  }

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

/**
 * Downloads a subtitle file using the chrome.downloads API.
 * Filters out forbidden headers that the chrome.downloads API cannot handle.
 * Includes detailed logging for debugging purposes.
 *
 * @param {string} url - The URL of the subtitle to download
 * @param {string} filename - The suggested filename for the download (defaults to 'subtitle.vtt')
 * @param {Object} [headers={}] - Optional headers to include with the download request
 * @returns {Promise<number>} A promise that resolves to the download ID
 * @throws {Error} If the download fails
 */
export async function downloadSubtitle(url, filename, headers = {}) {
  console.log('[Downloads] downloadSubtitle called');
  console.log('[Downloads] URL:', url);
  console.log('[Downloads] Raw headers:', JSON.stringify(headers, null, 2));

  // Build headers array for chrome.downloads API
  // Filter out forbidden headers that chrome.downloads can't handle
  const headerArray = [];
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!FORBIDDEN_HEADERS.has(lowerName)) {
      headerArray.push({ name, value });
      console.log('[Downloads] Adding header to download:', name);
    } else {
      console.log('[Downloads] Skipping forbidden header:', name);
    }
  }

  const downloadOptions = {
    url: url,
    filename: filename || 'subtitle.vtt',
    saveAs: false
  };

  // Add headers if present
  if (headerArray.length > 0) {
    downloadOptions.headers = headerArray;
    console.log('[Downloads] Download options with headers:', JSON.stringify(downloadOptions, null, 2));
  } else {
    console.log('[Downloads] Download options without headers');
  }

  try {
    const downloadId = await chrome.downloads.download(downloadOptions);
    console.log('[Downloads] Download started with ID:', downloadId);
    return downloadId;
  } catch (error) {
    console.error('[Downloads] Download failed:', error.message);
    throw error;
  }
}

/**
 * Storage Manager Module for Stream + Subtitle Catcher Extension
 * @module modules/storage
 *
 * Handles all chrome.storage operations with proper queue management and deduplication.
 * Uses a save queue to prevent race conditions when multiple items are being saved concurrently.
 */

import { MAX_ITEMS_PER_TAB } from './constants.js';

/**
 * Storage key prefixes for different item types
 * @constant {string}
 */
const STREAM_KEY_PREFIX = 'streams';
const SUBTITLE_KEY_PREFIX = 'subs';

/**
 * Generates a storage key for a given tab and item type
 * @param {number} tabId - The tab ID
 * @param {string} kind - The item kind ('stream' or 'subtitle')
 * @returns {string} The storage key
 */
function getStorageKey(tabId, kind) {
  const prefix = kind === 'stream' ? STREAM_KEY_PREFIX : SUBTITLE_KEY_PREFIX;
  return `${prefix}_${tabId}`;
}

/**
 * Manages chrome.storage operations with queue-based concurrency control
 * and URL-based deduplication.
 */
class StorageManager {
  constructor() {
    /**
     * Queue to prevent race conditions when saving items.
     * Each storage key has its own promise chain.
     * @type {Object<string, Promise>}
     * @private
     */
    this._saveQueue = {};

    /**
     * Change listeners for storage updates
     * @type {Array<Function>}
     * @private
     */
    this._changeListeners = [];

    // Set up storage change listener
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        this._notifyChangeListeners(changes);
      }
    });
  }

  /**
   * Notifies all registered change listeners
   * @param {Object} changes - The storage changes
   * @private
   */
  _notifyChangeListeners(changes) {
    for (const callback of this._changeListeners) {
      try {
        callback(changes);
      } catch (e) {
        console.error('[StorageManager] Error in change listener:', e);
      }
    }
  }

  /**
   * Adds an item to storage with deduplication and queue management.
   * Items with duplicate URLs are rejected. Max items limit is enforced per tab.
   *
   * @param {number} tabId - The tab ID to associate with the item
   * @param {Object} item - The item data to store
   * @param {string} item.requestId - Unique identifier for the request
   * @param {string} item.url - The URL of the item (used for deduplication)
   * @param {string} item.kind - The item kind ('stream' or 'subtitle')
   * @returns {Promise<Object|null>} The updated items object, or null if duplicate/limit reached
   */
  async addItem(tabId, item) {
    const { requestId, url, kind } = item;
    const key = getStorageKey(tabId, kind);

    // Create queue for this key if it doesn't exist
    if (!this._saveQueue[key]) {
      this._saveQueue[key] = Promise.resolve();
    }

    // Chain this save operation
    this._saveQueue[key] = this._saveQueue[key].then(async () => {
      const stored = await chrome.storage.local.get([key]);
      const items = stored[key] || {};

      // Check for duplicates inside the queue to prevent race conditions
      if (url && Object.values(items).some((existingItem) => existingItem.url === url)) {
        return null; // Duplicate found, skip saving
      }

      // Check for max items limit
      if (Object.keys(items).length >= MAX_ITEMS_PER_TAB) {
        return null; // Max items reached, skip saving
      }

      items[requestId] = item;
      await chrome.storage.local.set({ [key]: items });
      return items;
    });

    return this._saveQueue[key];
  }

  /**
   * Checks if an item with the given URL already exists for a tab
   * This is an optimization to avoid expensive operations before calling addItem
   *
   * @param {number} tabId - The tab ID
   * @param {string} url - The URL to check
   * @param {string} kind - The item kind ('stream' or 'subtitle')
   * @returns {Promise<boolean>} True if the URL already exists
   */
  async hasItem(tabId, url, kind) {
    const key = getStorageKey(tabId, kind);
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};
    return Object.values(items).some((item) => item.url === url);
  }

  /**
   * Checks if the max items limit has been reached for a tab
   *
   * @param {number} tabId - The tab ID
   * @param {string} kind - The item kind ('stream' or 'subtitle')
   * @returns {Promise<boolean>} True if the limit has been reached
   */
  async isLimitReached(tabId, kind) {
    const key = getStorageKey(tabId, kind);
    const stored = await chrome.storage.local.get([key]);
    const items = stored[key] || {};
    return Object.keys(items).length >= MAX_ITEMS_PER_TAB;
  }

  /**
   * Gets all items for a specific tab
   *
   * @param {number} tabId - The tab ID
   * @returns {Promise<{streams: Object, subtitles: Object}>} Object containing streams and subtitles
   */
  async getTabItems(tabId) {
    const streamKey = getStorageKey(tabId, 'stream');
    const subKey = getStorageKey(tabId, 'subtitle');
    const data = await chrome.storage.local.get([streamKey, subKey]);
    return {
      streams: data[streamKey] || {},
      subtitles: data[subKey] || {}
    };
  }

  /**
   * Gets the count of items for a specific tab
   *
   * @param {number} tabId - The tab ID
   * @returns {Promise<{streams: number, subtitles: number}>} Count of streams and subtitles
   */
  async getTabItemCounts(tabId) {
    const { streams, subtitles } = await this.getTabItems(tabId);
    return {
      streams: Object.keys(streams).length,
      subtitles: Object.keys(subtitles).length
    };
  }

  /**
   * Clears all items for a specific tab
   *
   * @param {number} tabId - The tab ID
   * @returns {Promise<void>}
   */
  async clearTab(tabId) {
    const streamKey = getStorageKey(tabId, 'stream');
    const subKey = getStorageKey(tabId, 'subtitle');
    await chrome.storage.local.remove([streamKey, subKey]);

    // Clean up any pending queues for this tab
    delete this._saveQueue[streamKey];
    delete this._saveQueue[subKey];
  }

  /**
   * Subscribes to storage changes
   *
   * @param {Function} callback - Function to call when storage changes
   * @returns {Function} Unsubscribe function
   */
  onChange(callback) {
    this._changeListeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this._changeListeners.indexOf(callback);
      if (index > -1) {
        this._changeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Gets the raw storage key for a tab and kind (for advanced use cases)
   *
   * @param {number} tabId - The tab ID
   * @param {string} kind - The item kind ('stream' or 'subtitle')
   * @returns {string} The storage key
   */
  getKey(tabId, kind) {
    return getStorageKey(tabId, kind);
  }
}

/**
 * Singleton instance of the StorageManager
 * @type {StorageManager}
 */
export const storage = new StorageManager();

export default storage;

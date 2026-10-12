/**
 * AudioStorage Module
 * Persists synthesized TTS audio clips in browser IndexedDB.
 * Survives page refreshes (F5) so previously generated clips are never re-requested.
 */

const DB_NAME = 'ai_math_tts_db';
const DB_VERSION = 1;
const STORE_NAME = 'tts_clips';

export interface StoredAudioClip {
  cacheKey: string;
  audioBase64: string;
  mimeType: string;
  duration: number;
  ttsProfile: any;
  savedAt: number;
}

function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('IndexedDB open error:', request.error);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export const AudioStorage = {
  async save(clip: StoredAudioClip): Promise<void> {
    try {
      const db = await openDB();
      if (!db) return;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(clip);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('AudioStorage save error:', e);
    }
  },

  async get(cacheKey: string): Promise<StoredAudioClip | null> {
    try {
      const db = await openDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(cacheKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  async getAll(): Promise<StoredAudioClip[]> {
    try {
      const db = await openDB();
      if (!db) return [];
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  },
};

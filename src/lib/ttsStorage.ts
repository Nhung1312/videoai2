/**
 * ttsStorage.ts
 * Browser-side persistent storage for generated TTS audio using IndexedDB.
 * Survives page reloads (F5), tab close, and prevents burning Gemini API quota.
 */

import { TtsProfile } from './ttsProfile';

export interface StoredAudioClip {
  cacheKey: string;
  audioBase64: string;
  mimeType: string;
  duration: number;
  ttsProfile: Readonly<TtsProfile>;
  timestamp: number;
}

const DB_NAME = 'GeoLessonAudioCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_clips';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) {
    return Promise.resolve(null);
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        console.warn('Failed to open IndexedDB for TTS cache:', event);
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB not supported or accessible:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

export async function getStoredAudioClip(cacheKey: string): Promise<StoredAudioClip | null> {
  try {
    const db = await openDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(cacheKey);

        req.onsuccess = () => {
          resolve((req.result as StoredAudioClip) || null);
        };

        req.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  } catch (err) {
    console.warn('Error reading audio from IndexedDB:', err);
    return null;
  }
}

export async function saveStoredAudioClip(item: StoredAudioClip): Promise<void> {
  try {
    const db = await openDatabase();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(item);

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch (err) {
    console.warn('Error saving audio to IndexedDB:', err);
  }
}

export async function getAllStoredAudioClips(): Promise<StoredAudioClip[]> {
  try {
    const db = await openDatabase();
    if (!db) return [];

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          resolve((req.result as StoredAudioClip[]) || []);
        };

        req.onerror = () => {
          resolve([]);
        };
      } catch {
        resolve([]);
      }
    });
  } catch (err) {
    console.warn('Error reading all audio from IndexedDB:', err);
    return [];
  }
}

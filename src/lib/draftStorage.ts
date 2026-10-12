/**
 * Draft Storage Module
 * Manages persisting problem input drafts, imported questions,
 * and user edits in browser localStorage to prevent losing work upon refresh.
 */

import { DraftStorageState, ImportedQuestion } from '../types/lesson';

const DRAFT_STORAGE_KEY = 'ai_math_video_studio_draft_v1';

export const DraftStorage = {
  saveDraft(draft: DraftStorageState): void {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (e) {
      console.warn('Failed to save draft to localStorage:', e);
    }
  },

  loadDraft(): DraftStorageState | null {
    try {
      const data = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!data) return null;
      const parsed: DraftStorageState = JSON.parse(data);
      // Valid if not older than 7 days
      if (Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) {
        this.clearDraft();
        return null;
      }
      return parsed;
    } catch (e) {
      console.warn('Failed to parse draft from localStorage:', e);
      return null;
    }
  },

  clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear draft from localStorage:', e);
    }
  },

  hasDraft(): boolean {
    return Boolean(localStorage.getItem(DRAFT_STORAGE_KEY));
  },
};

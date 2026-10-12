/**
 * Lesson Storage Service
 * Manages persisting multiple lessons in browser localStorage.
 * Guarantees that users never lose their lessons when creating new ones via AI or refreshing.
 */

import { LessonScript, ProblemType, LessonPresentationSettings } from '../types/lesson';
import { SAMPLE_GEOMETRY_LESSON, SAMPLE_ALGEBRA_LESSON } from './sampleLessons';

export interface SavedLessonEntry {
  id: string;
  title: string;
  problemType: ProblemType;
  lesson: LessonScript;
  aspectRatio?: '16:9' | '9:16';
  presentationSettings?: LessonPresentationSettings;
  createdAt: number;
  updatedAt: number;
  source: 'ai' | 'sample' | 'custom';
  tags?: string[];
}

const LESSON_STORAGE_KEY = 'ai_math_video_studio_saved_lessons_v1';

export const LessonStorage = {
  /**
   * Retrieves all saved lessons. If storage is empty, initializes with default sample lessons.
   */
  getAll(): SavedLessonEntry[] {
    try {
      const data = localStorage.getItem(LESSON_STORAGE_KEY);
      if (!data) {
        return this.initDefaultSamples();
      }
      const parsed: SavedLessonEntry[] = JSON.parse(data);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return this.initDefaultSamples();
      }
      return parsed;
    } catch (e) {
      console.warn('Failed to parse saved lessons from localStorage:', e);
      return this.initDefaultSamples();
    }
  },

  /**
   * Seeds default sample lessons into storage so they are always accessible in the library.
   */
  initDefaultSamples(): SavedLessonEntry[] {
    const defaultEntries: SavedLessonEntry[] = [
      {
        id: 'sample-geometry-ahbk',
        title: SAMPLE_GEOMETRY_LESSON.title,
        problemType: SAMPLE_GEOMETRY_LESSON.problemType,
        lesson: JSON.parse(JSON.stringify(SAMPLE_GEOMETRY_LESSON)),
        aspectRatio: '16:9',
        presentationSettings: SAMPLE_GEOMETRY_LESSON.presentation,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
        source: 'sample',
        tags: ['Hình học', 'Tứ giác', 'Mẫu chuẩn'],
      },
      {
        id: 'sample-algebra-equation',
        title: SAMPLE_ALGEBRA_LESSON.title,
        problemType: SAMPLE_ALGEBRA_LESSON.problemType,
        lesson: JSON.parse(JSON.stringify(SAMPLE_ALGEBRA_LESSON)),
        aspectRatio: '16:9',
        presentationSettings: SAMPLE_ALGEBRA_LESSON.presentation,
        createdAt: Date.now() - 43200000,
        updatedAt: Date.now() - 43200000,
        source: 'sample',
        tags: ['Đại số', 'Phương trình', 'Mẫu chuẩn'],
      },
    ];

    try {
      localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(defaultEntries));
    } catch (e) {
      console.warn('Failed to initialize default lessons in localStorage:', e);
    }

    return defaultEntries;
  },

  /**
   * Finds a saved lesson by ID.
   */
  getById(id: string): SavedLessonEntry | null {
    const list = this.getAll();
    return list.find((item) => item.id === id) || null;
  },

  /**
   * Saves or updates a lesson entry.
   * If existing ID is provided, updates in-place.
   * If no ID or new ID, appends a new entry to the front of the list.
   */
  save(
    lesson: LessonScript,
    options?: {
      id?: string;
      title?: string;
      source?: 'ai' | 'sample' | 'custom';
      aspectRatio?: '16:9' | '9:16';
      presentationSettings?: LessonPresentationSettings;
    }
  ): SavedLessonEntry {
    const list = this.getAll();
    const now = Date.now();
    const effectiveTitle = options?.title?.trim() || lesson.title.trim() || 'Bài giảng không tên';
    const effectiveLesson: LessonScript = {
      ...JSON.parse(JSON.stringify(lesson)),
      title: effectiveTitle,
    };

    let targetId = options?.id;
    const existingIndex = targetId ? list.findIndex((item) => item.id === targetId) : -1;

    let savedEntry: SavedLessonEntry;

    if (existingIndex >= 0) {
      // Update existing record
      const existing = list[existingIndex];
      savedEntry = {
        ...existing,
        title: effectiveTitle,
        problemType: effectiveLesson.problemType,
        lesson: effectiveLesson,
        aspectRatio: options?.aspectRatio || existing.aspectRatio || '16:9',
        presentationSettings: options?.presentationSettings || existing.presentationSettings,
        updatedAt: now,
        source: options?.source || existing.source,
      };
      list[existingIndex] = savedEntry;
    } else {
      // Create new record
      targetId = targetId || `lesson-${now}-${Math.random().toString(36).substring(2, 7)}`;
      savedEntry = {
        id: targetId,
        title: effectiveTitle,
        problemType: effectiveLesson.problemType,
        lesson: effectiveLesson,
        aspectRatio: options?.aspectRatio || '16:9',
        presentationSettings: options?.presentationSettings || effectiveLesson.presentation,
        createdAt: now,
        updatedAt: now,
        source: options?.source || 'custom',
      };
      // Insert at beginning of list
      list.unshift(savedEntry);
    }

    try {
      localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('Failed to persist lessons to localStorage:', e);
    }

    return savedEntry;
  },

  /**
   * Deletes a saved lesson by ID.
   */
  delete(id: string): boolean {
    const list = this.getAll();
    const filtered = list.filter((item) => item.id !== id);
    if (filtered.length === list.length) return false;

    try {
      localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(filtered));
      return true;
    } catch (e) {
      console.warn('Failed to delete lesson from localStorage:', e);
      return false;
    }
  },

  /**
   * Creates a duplicate of an existing lesson.
   */
  duplicate(id: string): SavedLessonEntry | null {
    const original = this.getById(id);
    if (!original) return null;

    const newTitle = `${original.title} (Bản sao)`;
    const duplicatedLesson: LessonScript = {
      ...JSON.parse(JSON.stringify(original.lesson)),
      title: newTitle,
    };

    return this.save(duplicatedLesson, {
      title: newTitle,
      source: 'custom',
      aspectRatio: original.aspectRatio,
      presentationSettings: original.presentationSettings,
    });
  },

  /**
   * Renames a saved lesson.
   */
  rename(id: string, newTitle: string): boolean {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return false;

    const list = this.getAll();
    const entry = list.find((item) => item.id === id);
    if (!entry) return false;

    entry.title = cleanTitle;
    entry.lesson.title = cleanTitle;
    entry.updatedAt = Date.now();

    try {
      localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('Failed to rename lesson in localStorage:', e);
      return false;
    }
  },

  /**
   * Exports all lessons as JSON string.
   */
  exportAllToJson(): string {
    const list = this.getAll();
    return JSON.stringify(list, null, 2);
  },

  /**
   * Imports lessons from a JSON string.
   */
  importFromJson(jsonString: string): { importedCount: number; error?: string } {
    try {
      const parsed = JSON.parse(jsonString);
      const itemsToImport: SavedLessonEntry[] = Array.isArray(parsed) ? parsed : [parsed];

      const validItems: SavedLessonEntry[] = [];
      const currentList = this.getAll();
      const now = Date.now();

      for (const item of itemsToImport) {
        if (item && item.title && item.lesson && item.lesson.steps) {
          validItems.push({
            id: `imported-${now}-${Math.random().toString(36).substring(2, 7)}`,
            title: item.title,
            problemType: item.problemType || item.lesson.problemType || 'mixed',
            lesson: item.lesson,
            aspectRatio: item.aspectRatio || '16:9',
            presentationSettings: item.presentationSettings || item.lesson.presentation,
            createdAt: item.createdAt || now,
            updatedAt: now,
            source: 'custom',
          });
        }
      }

      if (validItems.length === 0) {
        return { importedCount: 0, error: 'Tệp không chứa dữ liệu bài giảng hợp lệ.' };
      }

      const merged = [...validItems, ...currentList];
      localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(merged));
      return { importedCount: validItems.length };
    } catch (e: any) {
      return { importedCount: 0, error: e.message || 'Lỗi đọc tệp JSON.' };
    }
  },

  /**
   * Alias methods for backward compatibility
   */
  getSavedLessons(): SavedLessonEntry[] {
    return this.getAll();
  },

  renameSavedLesson(id: string, newTitle: string): boolean {
    return this.rename(id, newTitle);
  },

  deleteSavedLesson(id: string): boolean {
    return this.delete(id);
  },

  saveLesson(
    lesson: LessonScript,
    options?: {
      id?: string;
      title?: string;
      source?: 'ai' | 'sample' | 'custom';
      aspectRatio?: '16:9' | '9:16';
      presentationSettings?: LessonPresentationSettings;
    }
  ): SavedLessonEntry {
    return this.save(lesson, options);
  },
};

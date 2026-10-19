import { LessonModule } from '../types/lessonModule';

const MODULE_CODE_PREFIX = 'ai_math_module_code_';

class LessonModuleRegistryClass {
  private modules = new Map<string, LessonModule>();
  private initialized = false;

  constructor() {
    this.hydrateFromStorage();
  }

  private hydrateFromStorage(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(MODULE_CODE_PREFIX)) {
          const rawCode = localStorage.getItem(key);
          if (rawCode) {
            const parsed = this.parseAndValidate(rawCode);
            if (parsed.success) {
              this.modules.set(parsed.module.id, parsed.module);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error hydrating registered lesson modules from storage:', e);
    }
  }

  public register(module: LessonModule, rawCode?: string): void {
    this.modules.set(module.id, module);
    if (rawCode && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`${MODULE_CODE_PREFIX}${module.id}`, rawCode);
      } catch (e) {
        console.warn('Failed to save module code to localStorage:', e);
      }
    }
  }

  public get(id: string): LessonModule | undefined {
    this.hydrateFromStorage();
    if (this.modules.has(id)) {
      return this.modules.get(id);
    }
    // Try rehydrating directly from localStorage key
    if (typeof window !== 'undefined') {
      const rawCode = localStorage.getItem(`${MODULE_CODE_PREFIX}${id}`);
      if (rawCode) {
        const parsed = this.parseAndValidate(rawCode);
        if (parsed.success) {
          this.modules.set(id, parsed.module);
          return parsed.module;
        }
      }
    }
    return undefined;
  }

  public getAll(): LessonModule[] {
    this.hydrateFromStorage();
    return Array.from(this.modules.values());
  }

  public remove(id: string): void {
    this.modules.delete(id);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`${MODULE_CODE_PREFIX}${id}`);
    }
  }

  /**
   * Safe parser & validator for imported Lesson Module code or JSON.
   * Prohibits unsafe global access, validates schema, and runs a test render.
   */
  public parseAndValidate(rawInput: string): { success: true; module: LessonModule } | { success: false; error: string } {
    if (!rawInput || !rawInput.trim()) {
      return { success: false, error: 'Dữ liệu module không được để trống.' };
    }

    const trimmed = rawInput.trim();

    // 1. Security check: scan for dangerous APIs
    const forbiddenPatterns = [
      { pattern: /\b(fetch|XMLHttpRequest|WebSocket)\b/i, name: 'Truy cập mạng (fetch/XHR/WebSocket)' },
      { pattern: /\b(document\.cookie|cookieStore)\b/i, name: 'Đọc ghi cookie' },
      { pattern: /\b(localStorage|sessionStorage|indexedDB)\b/i, name: 'Truy cập storage trực tiếp' },
      { pattern: /\b(location\.href|location\.assign|window\.open)\b/i, name: 'Chuyển hướng trang / mở popup' },
      { pattern: /\b(eval\s*\(|new\s+Function\s*\()/i, name: 'eval / Function lồng nhau' },
      { pattern: /\b(process\.|child_process|require\s*\()/i, name: 'Truy cập môi trường hệ thống' },
      { pattern: /<script[\s>]/i, name: 'Thẻ script HTML' },
    ];

    for (const { pattern, name } of forbiddenPatterns) {
      if (pattern.test(trimmed)) {
        return {
          success: false,
          error: `Mã chứa lệnh không an toàn bị từ chối: "${name}". Lesson Module chỉ được chứa logic vẽ Canvas và kịch bản sư phạm.`,
        };
      }
    }

    // 2. Parse code or JSON into an object
    let modObj: any;

    // Check if it's pure JSON
    if (trimmed.startsWith('{') && !trimmed.includes('render(') && !trimmed.includes('render:')) {
      try {
        modObj = JSON.parse(trimmed);
      } catch (err: any) {
        // Fall through to JS evaluation
      }
    }

    if (!modObj) {
      try {
        let codeToEval = trimmed;

        // Clean module exports
        codeToEval = codeToEval
          .replace(/^export\s+default\s+/m, 'return ')
          .replace(/^export\s+const\s+[a-zA-Z0-9_$]+\s*=\s*/m, 'return ')
          .trim();

        // If not returning, wrap in return
        if (!codeToEval.startsWith('return ') && !codeToEval.includes('return {')) {
          if (codeToEval.startsWith('{') && codeToEval.endsWith('}')) {
            codeToEval = `return (${codeToEval});`;
          } else {
            codeToEval = `return (${codeToEval});`;
          }
        }

        // Evaluate inside a sandbox where hazardous globals are shadowed to undefined/null
        const sandboxedFunc = new Function(
          'window',
          'document',
          'fetch',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'XMLHttpRequest',
          codeToEval
        );

        modObj = sandboxedFunc(
          null, // window
          null, // document
          null, // fetch
          null, // localStorage
          null, // sessionStorage
          null, // indexedDB
          null  // XMLHttpRequest
        );
      } catch (evalErr: any) {
        return {
          success: false,
          error: `Lỗi cú pháp khi đọc mã Lesson Module: ${evalErr?.message || evalErr}`,
        };
      }
    }

    // 3. Schema validation
    if (!modObj || typeof modObj !== 'object') {
      return { success: false, error: 'Lesson Module phải là một đối tượng hợp lệ.' };
    }

    if (!modObj.title || typeof modObj.title !== 'string') {
      return { success: false, error: 'Thiếu trường "title" (tên bài giảng) trong Lesson Module.' };
    }

    if (!modObj.id || typeof modObj.id !== 'string') {
      // Auto-assign ID if missing
      modObj.id = `lesson-module-${Date.now()}`;
    }

    if (!modObj.steps || !Array.isArray(modObj.steps) || modObj.steps.length === 0) {
      return { success: false, error: 'Trường "steps" phải là một mảng có ít nhất 1 bước.' };
    }

    for (let i = 0; i < modObj.steps.length; i++) {
      const step = modObj.steps[i];
      if (!step || typeof step !== 'object') {
        return { success: false, error: `Bước ${i + 1} không phải là đối tượng hợp lệ.` };
      }
      if (step.phase !== 'problem' && step.phase !== 'solution') {
        return {
          success: false,
          error: `Bước ${i + 1}: trường "phase" phải là "problem" hoặc "solution" (nhận được: "${step.phase}").`,
        };
      }
      if (typeof step.displayText !== 'string') {
        return { success: false, error: `Bước ${i + 1}: trường "displayText" phải là chuỗi văn bản.` };
      }
      if (typeof step.narration !== 'string') {
        return { success: false, error: `Bước ${i + 1}: trường "narration" phải là chuỗi lời đọc.` };
      }
    }

    if (typeof modObj.render !== 'function') {
      return {
        success: false,
        error: 'Lesson Module bắt buộc phải có hàm "render(ctx, stepIndex, progress, viewport)" để vẽ hình.',
      };
    }

    // 4. Test dry-run of render function to ensure it doesn't throw immediate errors
    try {
      if (typeof document !== 'undefined') {
        const dummyCanvas = document.createElement('canvas');
        dummyCanvas.width = 500;
        dummyCanvas.height = 380;
        const dummyCtx = dummyCanvas.getContext('2d');
        if (dummyCtx) {
          modObj.render(dummyCtx, 0, 0, {
            x: 0,
            y: 0,
            width: 500,
            height: 380,
            isPortrait: false,
          });
        }
      }
    } catch (renderTestErr: any) {
      return {
        success: false,
        error: `Kiểm tra hàm render() thất bại ở bước khởi đầu: ${renderTestErr?.message || renderTestErr}`,
      };
    }

    return {
      success: true,
      module: modObj as LessonModule,
    };
  }
}

export const LessonModuleRegistry = new LessonModuleRegistryClass();

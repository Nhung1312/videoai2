export class RenderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function assertRender(value, code, message, details) {
  if (!value) throw new RenderError(code, message, details);
}

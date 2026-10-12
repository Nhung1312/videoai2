/** Shared, immutable TTS policy. Standard Gemini TTS model for high throughput & stability. */
export const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const TTS_PROFILE_VERSION = 'kore-v1';
export const TTS_STYLE_VERSION = 'vn-teacher-v1';
export const TTS_STYLE = 'Giọng NỮ giáo viên Việt Nam, tự nhiên, ấm áp, rõ chữ, tốc độ vừa phải. Đọc ký hiệu Toán theo tên chữ cái đã viết trong transcript; tuyệt đối không đánh vần theo âm hờ, bờ, cờ. Ngắt nghỉ nhẹ ở dấu phẩy và giữa các bước suy luận. Không đọc kiểu quảng cáo, không lên giọng máy móc.';

export interface TtsProfile {
  model: typeof TTS_MODEL;
  voiceName: string;
  styleVersion: typeof TTS_STYLE_VERSION;
  profileVersion: typeof TTS_PROFILE_VERSION;
}

// Preserve the existing explicit voice selector; the default remains Kore.
// Model/style/version are fixed for ALL requests, including on-demand export.
export function getTtsProfile(voiceName = 'Kore'): Readonly<TtsProfile> {
  return Object.freeze({
    model: TTS_MODEL,
    voiceName,
    styleVersion: TTS_STYLE_VERSION,
    profileVersion: TTS_PROFILE_VERSION,
  });
}

export function matchesTtsProfile(actual: unknown, expected: Readonly<TtsProfile>): boolean {
  if (!actual || typeof actual !== 'object') return false;
  const value = actual as Record<string, unknown>;
  const modelMatches =
    value.model === expected.model ||
    (typeof value.model === 'string' &&
      typeof expected.model === 'string' &&
      value.model.includes('tts') &&
      expected.model.includes('tts'));
  return Boolean(
    modelMatches &&
    value.voiceName === expected.voiceName &&
    value.styleVersion === expected.styleVersion &&
    value.profileVersion === expected.profileVersion
  );
}

export function getClientTtsCacheKey(
  profile: Readonly<TtsProfile>, stepId: string, narration: string, voiceSpeed: string,
): string {
  return JSON.stringify([
    profile.profileVersion, profile.model, profile.voiceName, profile.styleVersion,
    voiceSpeed, stepId, narration,
  ]);
}

export function getServerTtsCacheKey(profile: Readonly<TtsProfile>, normalizedText: string): string {
  return JSON.stringify([
    profile.profileVersion, profile.model, profile.voiceName, profile.styleVersion,
    normalizedText.trim(),
  ]);
}

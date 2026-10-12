import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { normalizeMathToVietnameseSpeech } from './src/lib/mathSpeechNormalizer.ts';
import { getTtsProfile, matchesTtsProfile, getServerTtsCacheKey, TTS_STYLE, type TtsProfile } from './src/lib/ttsProfile.ts';
import {
  validateGeometryTopology,
  generateAccurateGeometryScene,
  normalizeGeometryScene,
  orchestrateGeometrySteps,
} from './src/lib/geometryValidator.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));

// Initialize GoogleGenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const SYSTEM_INSTRUCTION = `
Bạn là chuyên gia sư phạm Toán THCS và đạo diễn hoạt hình bài giảng toán học (AI Math Video Studio).
Nhiệm vụ của bạn: Nhận nội dung đầu vào từ người dùng (có thể là văn bản dán tự do, hoặc hình ảnh đề bài, hoặc cả hai).
Tự động phân loại, trích xuất cấu trúc câu hỏi Toán học và tạo bản nháp bài giảng sư phạm hoàn chỉnh trong MỘT LẦN TRẢ VỀ DUY NHẤT.

QUY TẮC PHÂN TÍCH QUAN TRỌNG:
1. HỖ TRỢ ĐA CÂU HỎI:
   - Nếu văn bản/ảnh chứa nhiều câu (Câu 1, Câu 2, Bài 1, Bài 2...), phát hiện danh sách tất cả các câu trong mảng "questions". Nếu chỉ có 1 câu, trả về mảng 1 phần tử.
2. NHẬN DIỆN 3 TRƯỜNG HỢP:
   - TRƯỜNG HỢP A (Chỉ có đề):
     * hasProvidedAnswer: false
     * hasProvidedSolution: false
     * solutionSource: "ai"
     * AI tự xây dựng lời giải và kịch bản sư phạm.
   - TRƯỜNG HỢP B (Đề + Đáp án, ví dụ trắc nghiệm A, B, C, D hoặc đáp án ngắn "12"):
     * hasProvidedAnswer: true
     * providedAnswer: chuỗi đáp án (ví dụ: "C" hoặc "12")
     * ƯU TIÊN đáp án người dùng cung cấp! Không tự ý đổi đáp án.
     * Nếu phân tích toán học thấy đáp án người dùng có thể sai/không khớp, thêm vào mảng warnings: "Đáp án cung cấp có thể chưa khớp với kết quả phân tích."
   - TRƯỜNG HỢP C (Đề + Lời giải chi tiết):
     * hasProvidedSolution: true
     * providedSolution: nội dung lời giải do người dùng cung cấp
     * solutionSource: "user"
     * ƯU TIÊN BẢO TOÀN PHƯƠNG PHÁP, THỨ TỰ SUY LUẬN, KÝ HIỆU, ĐẶT ẨN, TÊN ĐIỂM, KẾT LUẬN CỦA NGƯỜI DÙNG.
     * AI chỉ chuẩn hóa thành các bước video trực quan, viết lại công thức KaTeX, tạo narration tự nhiên.
     * Nếu phát hiện lỗi toán học trong lời giải người dùng, KHÔNG âm thầm sửa mà thêm vào mảng warnings: "Có điểm cần kiểm tra: [mô tả vị trí và lỗi nghi ngờ]".
3. HÌNH VẼ & ẢNH ĐỀ (FIGURE CONTENT) - QUY TẮC DỰNG HÌNH CHUẨN XÁC:
   - Phân biệt rõ TEXT CONTENT và FIGURE CONTENT.
   - Trích xuất:
     * hasFigure: boolean (true nếu là bài hình học hoặc có hình vẽ)
     * figureType: "geometry" | "graph" | "coordinate" | "chart" | "spatial" | "unknown"
     * figureDescription: mô tả hình vẽ
     * visibleLabels: danh sách tất cả các điểm/nhãn (ví dụ: ["A", "B", "C", "D", "H", "K"])
     * geometryRelations: các quan hệ hình học chuẩn (ví dụ: ["Hình thang cân ABCD (AB ∥ CD, AB < CD)", "AH vuông góc CD", "BK vuông góc CD", "H, K thuộc CD"])
   - NGUYÊN TẮC DỰNG HÌNH THEO ĐÚNG LOẠI HÌNH VẼ ĐỀ BÀI:
     * NẾU ĐỀ BÀI NÊU TỨ GIÁC (Hình thang cân, Hình thang vuông, Hình thang, Hình bình hành, Hình chữ nhật, Hình thoi, Hình vuông, Tứ giác) ABCD:
       BẮT BUỘC TẠO ĐỦ 4 ĐỈNH A, B, C, D VÀ CÁC CẠNH BAO NỐI KHÉP KÍN (AB, BC, CD, DA).
       TUYỆT ĐỐI KHÔNG ĐƯỢC CHỈ TẠO 3 ĐỈNH HOẶC TỰ Ý BIẾN TỨ GIÁC THÀNH TAM GIÁC ABC!
       Với "Hình thang cân ABCD (AB ∥ CD, AB < CD)":
       - Đáy trên AB song song với đáy dưới CD (cùng toạ độ y nằm ngang, y_AB < y_CD).
       - Độ dài đáy trên nhỏ hơn đáy dưới: length(AB) < length(CD).
       - Hai cạnh bên bằng nhau: AD = BC.
       - Kẻ AH ⟂ CD, BK ⟂ CD (H, K ∈ CD):
         H và K phải có cùng toạ độ y với CD (H, K nằm trên đoạn thẳng CD).
         Toạ độ x của H bằng toạ độ x của A, toạ độ x của K bằng toạ độ x của B.
         Thứ tự các điểm trên đáy dưới phải là: D -> H -> K -> C.
         Có đoạn thẳng AH, BK và các dấu góc vuông tại H và K.
     * NẾU ĐỀ BÀI NÊU TAM GIÁC (Tam giác đều, Tam giác cân, Tam giác vuông, Tam giác thường) ABC:
       Tạo đủ 3 đỉnh A, B, C và 3 cạnh bao AB, BC, CA.
       Nếu tam giác ABC cân tại A: AB = AC, đỉnh A nằm giữa theo phương ngang so với B và C.
     * CÁC ĐIỂM PHỤ (chân đường cao, trung điểm, điểm thuộc đoạn):
       - Phải có toạ độ chính xác trên hình (ví dụ H thuộc CD thì khoảng cách từ H đến CD xấp xỉ 0).
       - Không được làm mất các cạnh chính của hình gốc.
     * ĐẢM BẢO TỌA ĐỘ PHÙ HỢP viewBox { width: 500, height: 380 }.
4. KỊCH BẢN BÀI GIẢNG PROPOSED LESSON SCRIPT:
   - Trong mỗi câu hỏi, sinh luôn proposedLessonScript đầy đủ (title, problemType, originalProblem, presentation, geometryScene, steps).
   - "narration": Thuyết minh giáo viên tiếng Việt tự nhiên, KHÔNG chứa raw LaTeX commands (không viết \\frac, \\sqrt, \\perp... trong narration).
   - "displayText": Tóm tắt ngắn gọn hiển thị trên màn hình.
   - "latex" / "latexLines": Công thức chuẩn KaTeX.
   - "cuePoints": Điểm đồng bộ sự kiện âm thanh và hình ảnh.

CẤU TRÚC JSON BẮT BUỘC TRẢ VỀ:
{
  "questions": [
    {
      "id": "q-1",
      "problemText": "Nội dung đề bài",
      "mathExpressions": ["\\\\frac{a}{b}", "x^2"],
      "questionType": "multiple-choice" | "short-answer" | "algebra" | "equation" | "geometry" | "graph" | "word_problem" | "other",
      "choices": [
        { "label": "A", "content": "..." },
        { "label": "B", "content": "..." }
      ],
      "providedAnswer": "C",
      "providedSolution": "Lời giải...",
      "hasProvidedAnswer": true,
      "hasProvidedSolution": false,
      "solutionSource": "user" | "ai" | "hybrid",
      "hasFigure": true,
      "figureType": "geometry",
      "figureDescription": "...",
      "visibleLabels": ["A", "B", "C", "H", "I", "K"],
      "geometryRelations": ["AH vuông góc BC", "I là trung điểm AB"],
      "confidence": 0.95,
      "warnings": [],
      "proposedLessonScript": {
        "title": "Tên bài giảng",
        "problemType": "geometry" | "equation" | "algebra",
        "originalProblem": "Đề bài nguyên văn",
        "presentation": { "revealMode": "typewriter", "typingSpeed": 32, "mathRevealMode": "semantic", "showTypingCursor": true },
        "geometryScene": { "viewBox": { "width": 500, "height": 380 }, "points": [], "segments": [], "polygons": [], "angleMarkers": [], "equalLengthMarkers": [] },
        "steps": []
      }
    }
  ]
}
Chỉ trả về DUY NHẤT một chuỗi JSON hợp lệ.
`;

// Parse Problem endpoint (Multimodal: Text + Image)
app.post('/api/parse-problem', async (req, res) => {
  try {
    const { problemText, imageBase64, imageMimeType } = req.body;
    const hasText = typeof problemText === 'string' && problemText.trim().length > 0;
    const hasImage = typeof imageBase64 === 'string' && imageBase64.length > 0;

    if (!hasText && !hasImage) {
      res.status(400).json({ error: 'Vui lòng cung cấp văn bản đề bài hoặc ảnh đề bài.' });
      return;
    }

    const contentsParts: any[] = [];

    // Attach image if provided
    if (hasImage) {
      const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      contentsParts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: imageMimeType || 'image/png',
        },
      });
    }

    const textPrompt = hasText
      ? `Dữ liệu bài toán cần phân tích (văn bản):\n"""\n${problemText.trim()}\n"""\n\nHãy phân tích và trả về JSON ProblemImportResult chuẩn xác theo hướng dẫn.`
      : `Phân tích đề bài toán và hình vẽ từ hình ảnh trên. Trả về JSON ProblemImportResult chuẩn xác theo hướng dẫn.`;

    contentsParts.push({ text: textPrompt });

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
    let response: any;
    let lastError: any;

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: contentsParts,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
            },
          });
          if (response?.text) break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Model ${model} attempt ${attempt} failed:`, err?.message || err);
          await new Promise((r) => setTimeout(r, 1200 * attempt));
        }
      }
      if (response?.text) break;
    }

    if (!response || !response.text) {
      throw lastError || new Error('Không nhận được phản hồi từ AI.');
    }

    const responseText = response.text || '';
    let parsedJson: any;

    try {
      parsedJson = JSON.parse(responseText);
    } catch {
      const cleaned = responseText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsedJson = JSON.parse(cleaned);
    }

    // Ensure questions array exists (backward-compatibility fallback)
    if (!parsedJson.questions && parsedJson.steps) {
      parsedJson = {
        questions: [
          {
            id: 'q-1',
            problemText: parsedJson.originalProblem || problemText || 'Đề bài',
            questionType: parsedJson.problemType || 'geometry',
            hasProvidedAnswer: false,
            hasProvidedSolution: false,
            solutionSource: 'ai',
            hasFigure: Boolean(parsedJson.geometryScene),
            confidence: 0.9,
            warnings: [],
            proposedLessonScript: parsedJson,
          },
        ],
      };
    }

    // Geometry Semantic Validation & Fail-Safe Auto-Repair
    if (parsedJson.questions && Array.isArray(parsedJson.questions)) {
      for (const q of parsedJson.questions) {
        if (!q.warnings) q.warnings = [];
        const isGeo =
          q.questionType === 'geometry' ||
          q.hasFigure ||
          Boolean(q.proposedLessonScript?.geometryScene) ||
          /(hình\s+thang|tam\s+giác|tứ\s+giác|hình\s+chữ\s+nhật|hình\s+bình\s+hành|hình\s+thoi|hình\s+vuông)/i.test(
            q.problemText || ''
          );

        if (isGeo) {
          q.questionType = 'geometry';
          q.hasFigure = true;
          if (!q.proposedLessonScript) {
            q.proposedLessonScript = {
              title: q.problemText.slice(0, 48).trim() + '...',
              problemType: 'geometry',
              originalProblem: q.problemText,
              steps: [],
            };
          }

          const existingScene = q.proposedLessonScript.geometryScene;
          const normalizedScene = normalizeGeometryScene(existingScene, q.problemText, q.visibleLabels);
          q.proposedLessonScript.geometryScene = normalizedScene;
          q.visibleLabels = normalizedScene.points.map((p: any) => p.name);
          q.geometryRelations = normalizedScene.relations?.map((r: any) => r.description) || q.geometryRelations;

          // Pedagogical step-by-step geometry orchestration
          if (q.proposedLessonScript.steps && q.proposedLessonScript.steps.length > 0) {
            q.proposedLessonScript.steps = orchestrateGeometrySteps(
              normalizedScene,
              q.proposedLessonScript.steps,
              q.problemText
            );
          }
        }
      }
    }

    res.json(parsedJson);
  } catch (error: any) {
    console.error('Error generating lesson script with Gemini:', error);
    res.status(500).json({
      error: 'Không thể phân tích đề bài với AI. Vui lòng thử lại.',
      details: error?.message || String(error),
    });
  }
});

// Server-side persistent disk cache directory to survive server restarts and save quota
const TTS_DISK_CACHE_DIR = path.resolve(process.cwd(), '.tts_cache');
try {
  if (!fs.existsSync(TTS_DISK_CACHE_DIR)) {
    fs.mkdirSync(TTS_DISK_CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('Failed to initialize TTS disk cache directory:', err);
}

// Server-side in-memory cache for generated TTS audio to prevent burning quota
const ttsCache = new Map<string, { audioBase64: string; mimeType: string; normalizedText: string; ttsProfile: Readonly<TtsProfile> }>();

// One model/style profile for the whole app. Quota errors NEVER trigger a Lite voice.
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceName, ttsProfile: requestedProfile } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text là bắt buộc.' });
      return;
    }

    // Normalize any math or LaTeX into fluent spoken Vietnamese
    const normalizedText = normalizeMathToVietnameseSpeech(text);
    if (!normalizedText.trim()) {
      res.status(400).json({ error: 'Nội dung đọc không hợp lệ.' });
      return;
    }

    // Keep a single predictable teaching voice by default (Kore)
    const selectedVoice = voiceName || 'Kore';
    const ttsProfile = getTtsProfile(selectedVoice);
    if (requestedProfile && !matchesTtsProfile(requestedProfile, ttsProfile)) {
      res.status(409).json({ error: 'Profile TTS đã thay đổi. Vui lòng tải lại ứng dụng.' });
      return;
    }
    const cacheKey = getServerTtsCacheKey(ttsProfile, normalizedText);

    // 1. Check in-memory cache
    if (ttsCache.has(cacheKey)) {
      res.json(ttsCache.get(cacheKey));
      return;
    }

    // 2. Check disk cache
    const diskHash = crypto.createHash('sha256').update(cacheKey).digest('hex');
    const diskPath = path.join(TTS_DISK_CACHE_DIR, `${diskHash}.json`);
    try {
      if (fs.existsSync(diskPath)) {
        const fileContent = fs.readFileSync(diskPath, 'utf-8');
        const parsedCached = JSON.parse(fileContent);
        if (parsedCached?.audioBase64) {
          ttsCache.set(cacheKey, parsedCached);
          res.json(parsedCached);
          return;
        }
      }
    } catch (diskErr) {
      console.warn('Error reading TTS disk cache:', diskErr);
    }

    // 3. Synthesize with Gemini API (trying primary model, then fallback if rate-limited)
    const modelsToTry = Array.from(
      new Set([
        ttsProfile.model,
        'gemini-3.8-flash-lite-tts',
        'gemini-3.8-flash-tts',
      ])
    );
    let lastError: any = null;
    let base64Audio: string | undefined;

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: normalizedText,
                    speechMetadata: {
                      style: TTS_STYLE,
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: selectedVoice },
                },
              },
            },
          });

          base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) break;
        } catch (err: any) {
          lastError = err;
          console.warn(`TTS ${model} attempt ${attempt} error:`, err?.message || err);
          const errStr = String(err?.message || '') + ' ' + String(err || '');
          const isQuota =
            err?.status === 429 ||
            err?.code === 429 ||
            errStr.includes('429') ||
            errStr.includes('RESOURCE_EXHAUSTED') ||
            errStr.includes('quota') ||
            errStr.includes('Quota');

          if (isQuota) {
            // Rate limit reached on this model; fail over to the next candidate model immediately
            break;
          }

          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      if (base64Audio) break;
    }

    if (!base64Audio) {
      const errStr = String(lastError?.message || '') + ' ' + String(lastError || '');
      const isQuota =
        lastError?.status === 429 ||
        lastError?.code === 429 ||
        errStr.includes('429') ||
        errStr.includes('RESOURCE_EXHAUSTED') ||
        errStr.includes('quota') ||
        errStr.includes('Quota');

      if (isQuota) {
        res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message: 'Hạn ngạch Gemini TTS đã đạt giới hạn (429 Quota Exceeded). Vui lòng thử lại sau.',
          details: lastError?.message || 'Resource exhausted',
        });
        return;
      }

      console.warn('TTS generation failed:', lastError?.message || lastError);
      res.status(500).json({
        error: 'Lỗi tạo giọng đọc TTS.',
        message: lastError?.message || 'Không nhận được dữ liệu âm thanh từ Gemini TTS',
        details: lastError?.message || String(lastError),
      });
      return;
    }

    const result = {
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      normalizedText,
      ttsProfile,
    };

    // Store in memory and persistent disk cache
    ttsCache.set(cacheKey, result);
    try {
      fs.writeFileSync(diskPath, JSON.stringify(result), 'utf-8');
    } catch (saveDiskErr) {
      console.warn('Failed to write TTS disk cache:', saveDiskErr);
    }

    res.json(result);
  } catch (error: any) {
    console.warn('TTS request error:', error?.message || error);
    res.status(500).json({
      error: 'Lỗi xử lý giọng đọc.',
      message: error?.message || 'Lỗi xử lý giọng đọc',
      details: error?.message || String(error),
    });
  }
});

// Setup Vite or static serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Math Video Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

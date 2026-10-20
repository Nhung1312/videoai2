import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode,
  Play,
  RefreshCw,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { AudioEngine } from '../lib/audioEngine';
import { inspectHtmlLessonSource, withHtmlCueManifest } from '../lib/htmlLessonSource';
import { buildOfflineKoreHtml } from '../lib/htmlOfflineKoreExporter';
import { needsStandaloneHtmlExport, openStandaloneHtmlExport } from '../lib/htmlExportWindowLauncher';
import type { StandaloneHtmlExportCuePayload } from '../lib/htmlStandaloneExporter';
import {
  HtmlNarrationCue,
  injectHtmlNarrationBridge,
  injectHtmlRecordingLayout,
  normalizeHtmlNarration,
  stableHtmlLessonId,
  validateHtmlLesson,
} from '../lib/htmlLessonBridge';

interface HtmlLessonPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const makeSessionId = () =>
  `html-session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const HtmlLessonPlayerModal: React.FC<HtmlLessonPlayerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeSessionRef = useRef('');
  const narrationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const calledCuesRef = useRef<Map<string, HtmlNarrationCue>>(new Map());
  const completedCuesRef = useRef<HtmlNarrationCue[] | null>(null);
  const runFailedRef = useRef(false);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawHtml, setRawHtml] = useState('');
  const [cues, setCues] = useState<HtmlNarrationCue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [runningHtml, setRunningHtml] = useState('');
  const [sessionId, setSessionId] = useState(makeSessionId());
  const [runKey, setRunKey] = useState(0);
  const [recordingStatus, setRecordingStatus] = useState('');
  const [isOpeningExport, setIsOpeningExport] = useState(false);

  const lessonId = useMemo(() => (rawHtml ? stableHtmlLessonId(rawHtml) : ''), [rawHtml]);
  const declaredCues = useMemo(() => {
    try { return inspectHtmlLessonSource(rawHtml).declared; } catch { return []; }
  }, [rawHtml]);

  const stopActiveAudio = () => {
    try {
      activeSourceRef.current?.stop();
    } catch {
      // Already stopped.
    }
    activeSourceRef.current = null;
  };

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const playCachedCue = async (stepId: string, narration: string, expectedSession: string) => {
    let cached = AudioEngine.getCachedAudio(stepId, narration, 'Kore');
    if (!cached) {
      cached = await AudioEngine.loadStepAudio(stepId, narration, 'Kore');
    }
    if (!cached) {
      throw new Error(AudioEngine.getStepError(stepId) || 'Không lấy được giọng Kore cho đoạn này.');
    }

    if (expectedSession !== activeSessionRef.current) return;
    const ctx = await ensureAudioContext();
    const audioBuffer = await ctx.decodeAudioData(cached.arrayBuffer.slice(0));
    if (expectedSession !== activeSessionRef.current) return;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = AudioEngine.getPlaybackRateMultiplier();
    source.connect(ctx.destination);
    activeSourceRef.current = source;

    await new Promise<void>((resolve, reject) => {
      source.onended = () => {
        if (activeSourceRef.current === source) activeSourceRef.current = null;
        resolve();
      };
      try {
        source.start();
      } catch (err) {
        reject(err);
      }
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data || {};
      if (
        data.source !== 'videoai2-html-lesson' ||
        data.sessionId !== activeSessionRef.current
      ) {
        return;
      }

      if (data.type === 'lesson-complete') {
        if (runFailedRef.current) return;
        if (!calledCuesRef.current.size) {
          runFailedRef.current = true;
          setError('Animation đã kết thúc nhưng chưa gọi lời đọc Kore nào. Kiểm tra cue()/withCue() trong HTML.');
          return;
        }
        completedCuesRef.current = [...calledCuesRef.current.values()];
        setStatus('Bài giảng HTML + Kore đã chạy xong. Đã cache ' + completedCuesRef.current.length + ' cue thực sự được gọi.');
        setRecordingStatus('Kore đã chuẩn bị xong. Bấm “Xuất video 9:16” hoặc “Tải HTML + Kore để quay thủ công”.');
        return;
      }

      if (data.type === 'lesson-error') {
        runFailedRef.current = true;
        completedCuesRef.current = null;
        stopActiveAudio();
        setError('HTML bài giảng gặp lỗi: ' + String(data.error || 'Không chạy được animation.'));
        setRecordingStatus('Bài chưa chạy hoàn tất nên chưa thể xuất đủ hình và tiếng.');
        return;
      }

      if (data.type !== 'narration-cue') return;

      const messageSession = String(data.sessionId || '');
      const cueId = String(data.cueId || '');
      const requestId = String(data.requestId || '');
      const matchingCue = declaredCues.find((cue) => cue.id === cueId);
      const narration = normalizeHtmlNarration(
        matchingCue?.narration || String(data.narration || '')
      );
      const stepId = `${lessonId}:${cueId}`;

      const runCue = async () => {
        if (messageSession !== activeSessionRef.current) return;

        try {
          if (!matchingCue) throw new Error('Cue chưa được khai báo trong narrationScript: ' + cueId);
          calledCuesRef.current.set(cueId, matchingCue);
          setStatus(`Kore đang chuẩn bị/đọc: ${narration}`);
          await playCachedCue(stepId, narration, messageSession);

          if (messageSession !== activeSessionRef.current) return;
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: 'videoai2-html-host',
              sessionId: messageSession,
              requestId,
              ok: true,
            },
            '*'
          );
          setStatus('Đang chạy bài giảng có tiếng Kore...');
        } catch (err: any) {
          if (messageSession !== activeSessionRef.current) return;
          runFailedRef.current = true;
          const message = err?.message || 'Không phát được lời đọc Kore.';
          setError(message);
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: 'videoai2-html-host',
              sessionId: messageSession,
              requestId,
              ok: false,
              error: message,
            },
            '*'
          );
        }
      };

      narrationQueueRef.current = narrationQueueRef.current.then(runCue, runCue);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, declaredCues, lessonId]);

  useEffect(() => {
    return () => {
      stopActiveAudio();
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, []);



  if (!isOpen) return null;

  const resetRun = () => {
    activeSessionRef.current = '';
    narrationQueueRef.current = Promise.resolve();
    stopActiveAudio();
    setRunningHtml('');
    setStatus('');
    setError(null);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    resetRun();
    calledCuesRef.current.clear();
    completedCuesRef.current = null;
    runFailedRef.current = false;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const html = String(reader.result || '');
      const result = validateHtmlLesson(html);
      setRawHtml(html);
      setCues(result.cues);
      setError(result.success ? null : result.error || 'HTML chưa đúng chuẩn narrationScript + cue.');
      if (result.success) {
        setStatus(`Đã nhận HTML hợp lệ: ${result.cues.length} đoạn lời đọc.`);
      }
    };
    reader.onerror = () => setError('Không đọc được tệp HTML này.');
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  };

  const prepareAndRun = async () => {
    if (!rawHtml || cues.length === 0 || !lessonId || isPreparing) return;

    setIsPreparing(true);
    setError(null);
    activeSessionRef.current = '';
    stopActiveAudio();

    try {
      // Resume while this action still originates from a user click.
      await ensureAudioContext();

      // Do not synthesize a declaration merely because it exists. Imported JS
      // may skip branches, loop over IDs or never call a declared cue at all.
      // playCachedCue loads/generates only when the runtime asks for that cue.
      calledCuesRef.current.clear();
      completedCuesRef.current = null;
      runFailedRef.current = false;

      const nextSession = makeSessionId();
      activeSessionRef.current = nextSession;
      narrationQueueRef.current = Promise.resolve();

      setSessionId(nextSession);
      setRunningHtml(injectHtmlNarrationBridge(rawHtml, nextSession, lessonId));
      setRunKey((value) => value + 1);
      setStatus('Đang chạy bài. Kore được tạo/cache khi cue thực sự được gọi.');
    } catch (err: any) {
      setError(err?.message || 'Không chuẩn bị được giọng Kore cho HTML này.');
      setStatus('');
    } finally {
      setIsPreparing(false);
    }
  };

  const replay = async () => {
    if (!rawHtml || cues.length === 0 || !lessonId) return;

    activeSessionRef.current = '';
    stopActiveAudio();
    await ensureAudioContext();
    calledCuesRef.current.clear();
    completedCuesRef.current = null;
    runFailedRef.current = false;

    const nextSession = makeSessionId();
    activeSessionRef.current = nextSession;
    narrationQueueRef.current = Promise.resolve();

    setSessionId(nextSession);
    setRunningHtml(injectHtmlNarrationBridge(rawHtml, nextSession, lessonId));
    setRunKey((value) => value + 1);
    setError(null);
    setStatus('Đang chạy lại bài với giọng Kore đã cache...');
  };

  // A declaration (including a skipped branch/dynamic ID) is not evidence that
  // a cue ran. Both export paths must use the same completed runtime trace.
  // Keep preparation in this tab: opening a popup first backgrounds the lesson
  // and throttles its animation timers in Chromium.
  const readyExportCues = async () => {
    if (completedCuesRef.current?.length && !runFailedRef.current) return completedCuesRef.current;
    if (runningHtml && !runFailedRef.current) {
      setRecordingStatus('Bài đang chuẩn bị/chạy Kore. Chờ bài chạy xong rồi bấm nút xuất lại; không cần chạy lại từ đầu.');
    } else {
      setRecordingStatus('Đang chuẩn bị Kore cho các cue thực sự chạy. Chờ bài chạy xong rồi bấm nút xuất lại.');
      await prepareAndRun();
    }
    return null;
  };

  const openVideoExport = async () => {
    if (!rawHtml || cues.length === 0 || isPreparing || isOpeningExport) return;

    const selectedCues = await readyExportCues();
    if (!selectedCues) return;
    const exportId = makeSessionId();
    const storageKey = `videoai2-html-export:${exportId}`;

    setIsOpeningExport(true);
    try {
      if (needsStandaloneHtmlExport()) {
        await openStandaloneHtmlExport(exportId, async () => {
          const cachedCues: StandaloneHtmlExportCuePayload[] = [];
          for (let i = 0; i < selectedCues.length; i++) {
            const cue = selectedCues[i];
            const narration = normalizeHtmlNarration(cue.narration);
            const stepId = `${lessonId}:${cue.id}`;
            setRecordingStatus(`Đang nạp Kore đã cache ${i + 1}/${selectedCues.length}...`);
            const cached = AudioEngine.getCachedAudio(stepId, narration, 'Kore') ||
              await AudioEngine.loadStepAudio(stepId, narration, 'Kore', { allowApi: false });
            if (!cached) throw new Error(AudioEngine.getStepError(stepId) || 'Thiếu Kore đã cache. Hãy bấm “Chuẩn bị Kore & Chạy” trước khi xuất.');
            cachedCues.push({ id: cue.id, narration, audio: cached.arrayBuffer.slice(0) });
          }
          const exportSession = makeSessionId();
          return {
            sessionId: exportSession,
            runningHtml: injectHtmlNarrationBridge(injectHtmlRecordingLayout(rawHtml), exportSession, lessonId),
            fileName: fileName || 'bai-giang.html',
            playbackRate: AudioEngine.getPlaybackRateMultiplier(),
            cues: cachedCues,
          };
        });
      } else {
        localStorage.setItem(storageKey, JSON.stringify({
          rawHtml: withHtmlCueManifest(rawHtml, selectedCues.map(cue => cue.id)),
          fileName,
          createdAt: Date.now(),
        }));
        const exportUrl = new URL(window.location.href);
        exportUrl.searchParams.set('html-kore-export', exportId);
        const exportWindow = window.open(exportUrl.href, '_blank');
        if (!exportWindow) {
          localStorage.removeItem(storageKey);
          throw new Error('Trình duyệt đã chặn tab xuất video. Hãy cho phép mở cửa sổ bật lên rồi bấm lại.');
        }
      }

      activeSessionRef.current = '';
      narrationQueueRef.current = Promise.resolve();
      stopActiveAudio();
      setRunningHtml('');
      setError(null);
      setRecordingStatus('Đã mở cửa sổ xuất video. Chọn “Bắt đầu xuất video 9:16” trong tab mới.');
    } catch (err: any) {
      setRecordingStatus(err?.message || 'Không mở được cửa sổ xuất video.');
    } finally {
      setIsOpeningExport(false);
    }
  };

  const startHtmlRecording = async () => {
    if (!rawHtml || cues.length === 0 || !lessonId || isPreparing) return;

    const selectedCues = await readyExportCues();
    if (!selectedCues) return;
    // A sandboxed preview may allow escaped popups but forbid downloads. The
    // final download must originate from that top-level document, like video.
    let downloadWindow: Window | null = null;
    setError(null);
    setRecordingStatus('Đang đóng gói HTML + Kore...');

    const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;

      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
      }

      return btoa(binary);
    };

    try {
      if (needsStandaloneHtmlExport()) {
        downloadWindow = window.open('about:blank', '_blank');
        if (!downloadWindow) throw new Error('Trình duyệt đã chặn cửa sổ tải HTML. Hãy cho phép cửa sổ bật lên rồi bấm tải lại.');
        downloadWindow.document.title = 'Tải HTML + Kore';
        downloadWindow.document.body.textContent = 'Đang đóng gói HTML + Kore. Vui lòng giữ cửa sổ này mở.';
      }
      const embeddedCues: Array<{
        id: string;
        mimeType: string;
        audioBase64: string;
      }> = [];

      for (let i = 0; i < selectedCues.length; i++) {
        const cue = selectedCues[i];
        const narration = normalizeHtmlNarration(cue.narration);
        const stepId = `${lessonId}:${cue.id}`;

        setRecordingStatus(`Đang đóng gói Kore ${i + 1}/${selectedCues.length}...`);

        let cached = AudioEngine.getCachedAudio(stepId, narration, 'Kore');
        if (!cached) {
          cached = await AudioEngine.loadStepAudio(stepId, narration, 'Kore', {
            allowApi: false,
          });
        }

        if (!cached) {
          throw new Error(
            AudioEngine.getStepError(stepId) ||
              'Thiếu Kore đã cache. Hãy bấm “Chuẩn bị Kore & Chạy” rồi tải HTML lại.'
          );
        }

        embeddedCues.push({
          id: cue.id,
          mimeType: cached.blob?.type || 'audio/wav',
          audioBase64: arrayBufferToBase64(cached.arrayBuffer.slice(0)),
        });
      }

      const htmlWithKore = buildOfflineKoreHtml(
        injectHtmlRecordingLayout(rawHtml),
        embeddedCues,
        AudioEngine.getPlaybackRateMultiplier()
      );

      const blob = new Blob([htmlWithKore], {
        type: 'text/html;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const downloadDocument = downloadWindow?.document || document;
      const link = downloadDocument.createElement('a');

      const baseName =
        (fileName || 'bai-giang')
          .replace(/\.html?$/i, '')
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'bai-giang';

      link.href = url;
      link.download = `${baseName}-Kore-QUAY-THU-CONG.html`;
      if (downloadWindow) {
        downloadDocument.body.textContent = 'HTML + Kore đã sẵn sàng. Nếu chưa thấy file tải xuống, bấm liên kết bên dưới. ';
        link.textContent = 'Tải HTML + Kore để quay thủ công';
      }
      downloadDocument.body.appendChild(link);
      link.click();
      if (downloadWindow) {
        downloadWindow.addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true });
      } else {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }

      setRecordingStatus(
        downloadWindow
          ? 'HTML + Kore đã sẵn sàng trong cửa sổ tải. Nếu chưa thấy file, bấm liên kết tải trong cửa sổ đó.'
          : 'Đã tải HTML có sẵn tiếng Kore. Mở file đó → bật quay màn hình của bạn → bấm “Bắt đầu bài giảng có tiếng”.'
      );
    } catch (err: any) {
      downloadWindow?.close();
      setRecordingStatus('');
      setError(err?.message || 'Không đóng gói được HTML + Kore.');
    }
  };

  const close = () => {
    activeSessionRef.current = '';
    narrationQueueRef.current = Promise.resolve();
    stopActiveAudio();
    setRunningHtml('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-3 md:p-5 flex items-center justify-center">
      <div className="w-full h-full max-w-[1500px] max-h-[96vh] rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 md:px-5 py-3 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-300">
              <FileCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-white">HTML bài giảng + Kore</h2>
              <p className="text-[11px] text-slate-400 truncate">
                Chọn HTML có narrationScript + cue → app tạo Kore → animation chạy đồng bộ.
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr]">
          <aside className="border-b lg:border-b-0 lg:border-r border-slate-800 p-4 overflow-y-auto bg-slate-950/35 space-y-4">
            <div>
              <div className="text-xs font-bold text-slate-300 mb-2">1. Chọn HTML từ Gemini</div>
              <label className="border-2 border-dashed border-slate-700 hover:border-violet-500 rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer bg-slate-950/50 transition">
                <Upload className="w-6 h-6 text-violet-300" />
                <span className="text-xs text-center font-semibold text-slate-200">
                  {fileName || 'Bấm để chọn tệp .html'}
                </span>
                <input
                  type="file"
                  accept=".html,.htm,text/html"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {rawHtml && !error && (
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/30 text-xs">
                <div className="flex items-center gap-2 font-bold text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" /> HTML đúng chuẩn
                </div>
                <div className="mt-2 text-slate-300">Đã nhận {cues.length} cue lời đọc.</div>
                <div className="text-slate-500 mt-1">Giọng cố định: Kore</div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/30 text-xs text-rose-200 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {status && (
              <div className="p-3 rounded-xl border border-sky-500/20 bg-sky-950/20 text-xs text-sky-200">
                {status}
              </div>
            )}

            <button
              onClick={prepareAndRun}
              disabled={!rawHtml || cues.length === 0 || isPreparing || isOpeningExport}
              className="w-full px-4 py-2.5 rounded-xl font-bold text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2 cursor-pointer"
            >
              {isPreparing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
              {isPreparing ? 'Đang chuẩn bị Kore...' : 'Chuẩn bị Kore & Chạy'}
            </button>

            <button
              onClick={replay}
              disabled={!rawHtml || cues.length === 0 || isPreparing}
              className="w-full px-4 py-2 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Chạy lại (dùng cache)
            </button>

            <button
              onClick={openVideoExport}
              disabled={!rawHtml || cues.length === 0 || isPreparing || isOpeningExport}
              className="w-full px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Xuất video 9:16
            </button>

            <div className="text-[11px] leading-relaxed text-slate-400">
              Nếu chưa chuẩn bị, bấm nút xuất sẽ bắt đầu chạy Kore ngay tại đây. Chờ bài chạy xong rồi bấm xuất lại. Nếu bài đã chạy xong thì xuất ngay bằng cache; cue không được gọi sẽ không tạo TTS.
            </div>

            <button
              onClick={startHtmlRecording}
              disabled={!rawHtml || cues.length === 0 || isPreparing}
              className="w-full px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Tải HTML + Kore để quay thủ công
            </button>

            {recordingStatus && (
              <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-950/20 text-[11px] leading-relaxed text-amber-200">
                {recordingStatus}
              </div>
            )}

            <div className="text-[11px] leading-relaxed text-slate-500">
              HTML tải về đã nhúng sẵn toàn bộ tiếng Kore và chạy đồng bộ theo cue. Bạn mở file, tự bật quay màn hình rồi bấm bắt đầu bài giảng.
            </div>

            <div className="text-[11px] leading-relaxed text-slate-500 border-t border-slate-800 pt-3">
              Phần này không sửa Lesson Module, geometry engine hay nút Xuất video hiện tại.
            </div>
          </aside>

          <section className="min-h-0 bg-[#070b13] flex items-center justify-center p-2 md:p-4 overflow-hidden">
            {runningHtml ? (
              <iframe
                key={`${runKey}-${sessionId}`}
                ref={iframeRef}
                title="HTML lesson preview with Kore narration"
                srcDoc={runningHtml}
                sandbox="allow-scripts"
                className="w-full h-full min-h-[560px] bg-black rounded-xl border border-slate-800"
              />
            ) : (
              <div className="text-center max-w-sm text-slate-500">
                <FileCode className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <div className="text-sm font-semibold text-slate-400">Chưa chạy HTML</div>
                <div className="text-xs mt-2">
                  Chọn file, app kiểm tra narrationScript/cue rồi bấm “Chuẩn bị Kore & Chạy”.
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

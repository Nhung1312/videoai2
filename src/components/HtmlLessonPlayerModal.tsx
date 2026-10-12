import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode,
  Play,
  RefreshCw,
  Square,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { AudioEngine } from '../lib/audioEngine';
import {
  HtmlNarrationCue,
  injectHtmlNarrationBridge,
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawHtml, setRawHtml] = useState('');
  const [cues, setCues] = useState<HtmlNarrationCue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [runningHtml, setRunningHtml] = useState('');
  const [sessionId, setSessionId] = useState(makeSessionId());
  const [runKey, setRunKey] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('');

  const lessonId = useMemo(() => (rawHtml ? stableHtmlLessonId(rawHtml) : ''), [rawHtml]);

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

  const playCachedCue = async (stepId: string, narration: string) => {
    let cached = AudioEngine.getCachedAudio(stepId, narration, 'Kore');
    if (!cached) {
      cached = await AudioEngine.loadStepAudio(stepId, narration, 'Kore');
    }
    if (!cached) {
      throw new Error(AudioEngine.getStepError(stepId) || 'Không lấy được giọng Kore cho đoạn này.');
    }

    const ctx = await ensureAudioContext();
    const audioBuffer = await ctx.decodeAudioData(cached.arrayBuffer.slice(0));
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

  const stopHtmlRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }

    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureStreamRef.current = null;
    recorderRef.current = null;
    setIsRecording(false);
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
        setStatus('Bài giảng HTML + Kore đã chạy xong.');
        const recorder = recorderRef.current;
        if (recorder && recorder.state === 'recording') {
          window.setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop();
          }, 900);
        }
        return;
      }

      if (data.type !== 'narration-cue') return;

      const messageSession = String(data.sessionId || '');
      const cueId = String(data.cueId || '');
      const requestId = String(data.requestId || '');
      const matchingCue = cues.find((cue) => cue.id === cueId);
      const narration = normalizeHtmlNarration(
        matchingCue?.narration || String(data.narration || '')
      );
      const stepId = `${lessonId}:${cueId}`;

      const runCue = async () => {
        if (messageSession !== activeSessionRef.current) return;

        try {
          setStatus(`Kore đang đọc: ${narration}`);
          await playCachedCue(stepId, narration);

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
  }, [isOpen, cues, lessonId]);

  useEffect(() => {
    return () => {
      stopActiveAudio();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
      captureStreamRef.current = null;
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === 'recording') recorder.stop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording]);

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
    stopActiveAudio();

    try {
      // Resume while this action still originates from a user click.
      await ensureAudioContext();

      const steps = cues.map((cue) => ({
        id: `${lessonId}:${cue.id}`,
        narration: normalizeHtmlNarration(cue.narration),
        title: cue.id,
      }));

      setStatus(`Đang chuẩn bị Kore 0/${steps.length} đoạn...`);
      const result = await AudioEngine.preloadLesson(
        steps,
        'Kore',
        (ready, total) => setStatus(`Đang chuẩn bị Kore ${ready}/${total} đoạn...`)
      );

      if (result.ready !== steps.length) {
        throw new Error(
          result.failedReason ||
            `Chỉ chuẩn bị được ${result.ready}/${steps.length} đoạn giọng Kore.`
        );
      }

      const nextSession = makeSessionId();
      activeSessionRef.current = nextSession;
      narrationQueueRef.current = Promise.resolve();

      setSessionId(nextSession);
      setRunningHtml(injectHtmlNarrationBridge(rawHtml, nextSession, lessonId));
      setRunKey((value) => value + 1);
      setStatus(`Kore đã sẵn sàng ${result.ready}/${steps.length}. Đang chạy bài...`);
    } catch (err: any) {
      setError(err?.message || 'Không chuẩn bị được giọng Kore cho HTML này.');
      setStatus('');
    } finally {
      setIsPreparing(false);
    }
  };

  const replay = async () => {
    if (!rawHtml || cues.length === 0 || !lessonId) return;

    stopActiveAudio();
    await ensureAudioContext();

    const nextSession = makeSessionId();
    activeSessionRef.current = nextSession;
    narrationQueueRef.current = Promise.resolve();

    setSessionId(nextSession);
    setRunningHtml(injectHtmlNarrationBridge(rawHtml, nextSession, lessonId));
    setRunKey((value) => value + 1);
    setError(null);
    setStatus('Đang chạy lại bài với giọng Kore đã cache...');
  };

  const startHtmlRecording = async () => {
    if (!runningHtml || !rawHtml || cues.length === 0 || !lessonId || isRecording) return;

    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setError('Trình duyệt này chưa hỗ trợ ghi video trực tiếp. Hãy dùng Chrome/Cốc Cốc bản mới.');
      return;
    }

    setError(null);
    setRecordingStatus('Đang mở hộp chọn tab. Hãy chọn chính tab này và bật chia sẻ âm thanh.');

    try {
      await ensureAudioContext();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });

      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          'Chưa có âm thanh trong bản ghi. Khi chọn tab, hãy bật “Chia sẻ âm thanh của tab”.'
        );
      }

      captureStreamRef.current = stream;
      recordingChunksRef.current = [];

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const mimeType =
        mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';

      const recorder = new MediaRecorder(
        stream,
        mimeType
          ? {
              mimeType,
              videoBitsPerSecond: 8_000_000,
              audioBitsPerSecond: 192_000,
            }
          : {
              videoBitsPerSecond: 8_000_000,
              audioBitsPerSecond: 192_000,
            }
      );

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setError('Có lỗi khi ghi video HTML + Kore.');
      };

      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];

        captureStreamRef.current?.getTracks().forEach((track) => track.stop());
        captureStreamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);

        if (chunks.length === 0) {
          setError('Không nhận được dữ liệu video để lưu.');
          setRecordingStatus('');
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const baseName = (fileName || 'html-kore')
          .replace(/\.html?$/i, '')
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'html-kore';

        link.href = url;
        link.download = `${baseName}-Kore.webm`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 3000);

        setRecordingStatus('Đã xuất video WebM có tiếng Kore.');
        setStatus('Xuất video HTML + Kore hoàn tất.');
      };

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener('ended', () => {
        if (recorder.state === 'recording') recorder.stop();
      });

      setIsRecording(true);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      recorder.start(1000);
      setRecordingStatus('Đang ghi video. Bài sẽ tự chạy lại từ đầu và tự lưu khi kết thúc.');

      await new Promise((resolve) => window.setTimeout(resolve, 500));

      stopActiveAudio();
      const nextSession = makeSessionId();
      activeSessionRef.current = nextSession;
      narrationQueueRef.current = Promise.resolve();

      setSessionId(nextSession);
      setRunningHtml(injectHtmlNarrationBridge(rawHtml, nextSession, lessonId));
      setRunKey((value) => value + 1);
      setStatus('Đang ghi video HTML + Kore...');
    } catch (err: any) {
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
      captureStreamRef.current = null;
      recorderRef.current = null;
      setIsRecording(false);
      setRecordingStatus('');
      setError(err?.message || 'Không bắt đầu được ghi video HTML + Kore.');
    }
  };

  const close = () => {
    activeSessionRef.current = '';
    narrationQueueRef.current = Promise.resolve();
    stopActiveAudio();
    stopHtmlRecording();
    setRunningHtml('');
    onClose();
  };

  if (isRecording) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black">
        <iframe
          key={`recording-${runKey}-${sessionId}`}
          ref={iframeRef}
          title="HTML lesson recording"
          srcDoc={runningHtml}
          sandbox="allow-scripts"
          className="w-screen h-screen border-0 bg-black"
        />
      </div>
    );
  }

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
              disabled={!rawHtml || cues.length === 0 || Boolean(error) || isPreparing}
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
              disabled={!runningHtml || isPreparing}
              className="w-full px-4 py-2 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Chạy lại (dùng cache)
            </button>

            <button
              onClick={startHtmlRecording}
              disabled={!runningHtml || isPreparing || isRecording}
              className="w-full px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Xuất video HTML + Kore
            </button>

            {recordingStatus && (
              <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-950/20 text-[11px] leading-relaxed text-amber-200">
                {recordingStatus}
              </div>
            )}

            <div className="text-[11px] leading-relaxed text-slate-500">
              Khi xuất video: chọn <strong className="text-slate-400">tab hiện tại</strong> và bật
              <strong className="text-slate-400"> Chia sẻ âm thanh</strong>. Video WebM sẽ tự tải khi bài kết thúc.
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

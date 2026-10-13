import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Play, XCircle } from 'lucide-react';
import { AudioEngine } from '../lib/audioEngine';
import {
  HtmlNarrationCue,
  injectHtmlNarrationBridge,
  injectHtmlRecordingLayout,
  normalizeHtmlNarration,
  stableHtmlLessonId,
  validateHtmlLesson,
} from '../lib/htmlLessonBridge';

interface HtmlLessonExportWindowProps {
  exportId: string;
}

interface HtmlExportPayload {
  rawHtml: string;
  fileName?: string | null;
  createdAt?: number;
}

const EXPORT_PREFIX = 'videoai2-html-export:';

const makeSessionId = () =>
  `html-export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const HtmlLessonExportWindow: React.FC<HtmlLessonExportWindowProps> = ({
  exportId,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const outputStreamRef = useRef<MediaStream | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureRafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeSessionRef = useRef('');
  const narrationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lessonCompletedRef = useRef(false);

  const [payload, setPayload] = useState<HtmlExportPayload | null>(null);
  const [cues, setCues] = useState<HtmlNarrationCue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Đang đọc dữ liệu bài giảng...');
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [runningHtml, setRunningHtml] = useState('');
  const [sessionId, setSessionId] = useState(makeSessionId());
  const [runKey, setRunKey] = useState(0);

  const lessonId = useMemo(
    () => (payload?.rawHtml ? stableHtmlLessonId(payload.rawHtml) : ''),
    [payload]
  );

  const cleanupCapture = () => {
    if (captureRafRef.current != null) {
      cancelAnimationFrame(captureRafRef.current);
      captureRafRef.current = null;
    }

    if (captureVideoRef.current) {
      captureVideoRef.current.pause();
      captureVideoRef.current.srcObject = null;
      captureVideoRef.current = null;
    }

    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;

    outputStreamRef.current?.getTracks().forEach((track) => track.stop());
    outputStreamRef.current = null;

    audioDestinationRef.current = null;
  };

  const stopActiveAudio = () => {
    try {
      activeSourceRef.current?.stop();
    } catch {
      // Audio may already be stopped.
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
      cached = await AudioEngine.loadStepAudio(stepId, narration, 'Kore', { allowApi: false });
    }
    if (!cached) {
      throw new Error(
        AudioEngine.getStepError(stepId) ||
          'Không lấy được giọng Kore đã chuẩn bị cho đoạn này.'
      );
    }

    const ctx = await ensureAudioContext();
    const destination = audioDestinationRef.current;
    if (!destination) {
      throw new Error('Bộ ghép âm thanh chưa sẵn sàng.');
    }

    const audioBuffer = await ctx.decodeAudioData(cached.arrayBuffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = AudioEngine.getPlaybackRateMultiplier();
    source.connect(ctx.destination);
    source.connect(destination);
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

  const stopRecorder = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  useEffect(() => {
    const storageKey = `${EXPORT_PREFIX}${exportId}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      setError('Không tìm thấy dữ liệu bài giảng để xuất. Hãy quay lại app và bấm Xuất video lại.');
      setStatus('');
      return;
    }

    try {
      const parsed = JSON.parse(raw) as HtmlExportPayload;
      if (!parsed?.rawHtml) throw new Error('Thiếu HTML bài giảng.');

      const validation = validateHtmlLesson(parsed.rawHtml);
      if (!validation.success) {
        throw new Error(validation.error || 'HTML chưa đúng chuẩn narrationScript + cue.');
      }

      setPayload(parsed);
      setCues(validation.cues);
      setStatus(`Đã nhận ${validation.cues.length} đoạn Kore. Đang kiểm tra cache...`);
    } catch (err: any) {
      setError(err?.message || 'Không đọc được dữ liệu bài giảng.');
      setStatus('');
    }
  }, [exportId]);

  useEffect(() => {
    if (!payload || cues.length === 0 || !lessonId) return;

    let cancelled = false;
    const prepare = async () => {
      setIsPreparing(true);
      setError(null);

      try {
        for (let i = 0; i < cues.length; i++) {
          if (cancelled) return;
          const cue = cues[i];
          const narration = normalizeHtmlNarration(cue.narration);
          const stepId = `${lessonId}:${cue.id}`;

          setStatus(`Đang nạp Kore từ cache ${i + 1}/${cues.length}...`);
          const cached = await AudioEngine.loadStepAudio(stepId, narration, 'Kore', { allowApi: false });
          if (!cached) {
            throw new Error(
              AudioEngine.getStepError(stepId) ||
                `Không nạp được Kore cho ${cue.id}.`
            );
          }
        }

        if (!cancelled) {
          setStatus('Kore đã sẵn sàng. Bấm “Bắt đầu xuất video”.');
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Không chuẩn bị được Kore để xuất video.');
          setStatus('');
        }
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    };

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [payload, cues, lessonId]);

  useEffect(() => {
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
        lessonCompletedRef.current = true;
        setStatus('Bài giảng đã chạy xong. Đang đóng gói video...');
        window.setTimeout(() => stopRecorder(), 900);
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
          setStatus(`Đang ghi • Kore: ${narration}`);
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
        } catch (err: any) {
          const message = err?.message || 'Không phát được Kore.';
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
          stopRecorder();
        }
      };

      narrationQueueRef.current = narrationQueueRef.current.then(runCue, runCue);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [cues, lessonId]);

  useEffect(() => {
    return () => {
      stopActiveAudio();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      cleanupCapture();
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, []);

  const startFrameCropLoop = (
    sourceVideo: HTMLVideoElement,
    outputCanvas: HTMLCanvasElement
  ) => {
    const ctx = outputCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Không khởi tạo được Canvas dựng video.');

    const draw = () => {
      const frame = frameRef.current;
      if (!frame || sourceVideo.readyState < 2) {
        captureRafRef.current = requestAnimationFrame(draw);
        return;
      }

      const rect = frame.getBoundingClientRect();
      const scaleX = sourceVideo.videoWidth / Math.max(1, window.innerWidth);
      const scaleY = sourceVideo.videoHeight / Math.max(1, window.innerHeight);

      const sx = Math.max(0, rect.left * scaleX);
      const sy = Math.max(0, rect.top * scaleY);
      const sw = Math.max(1, Math.min(sourceVideo.videoWidth - sx, rect.width * scaleX));
      const sh = Math.max(1, Math.min(sourceVideo.videoHeight - sy, rect.height * scaleY));

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      ctx.drawImage(
        sourceVideo,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        outputCanvas.width,
        outputCanvas.height
      );

      captureRafRef.current = requestAnimationFrame(draw);
    };

    draw();
  };

  const startExport = async () => {
    if (!payload || !lessonId || cues.length === 0 || isPreparing || isRecording) return;

    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setError('Trình duyệt này chưa hỗ trợ ghi tab. Hãy dùng Chrome/Cốc Cốc bản mới.');
      return;
    }

    setError(null);
    setStatus('Hãy chọn đúng TAB xuất video này. Không cần bật chia sẻ âm thanh.');

    try {
      const audioCtx = await ensureAudioContext();
      const audioDestination = audioCtx.createMediaStreamDestination();
      audioDestinationRef.current = audioDestination;

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as any);
      displayStreamRef.current = displayStream;

      const displayTrack = displayStream.getVideoTracks()[0];
      const displaySurface = displayTrack?.getSettings?.().displaySurface;
      if (displaySurface && displaySurface !== 'browser') {
        displayStream.getTracks().forEach((track) => track.stop());
        displayStreamRef.current = null;
        audioDestinationRef.current = null;
        throw new Error(
          'Bạn vừa chọn cửa sổ/màn hình. Hãy bấm lại và chọn đúng TAB xuất video này.'
        );
      }

      const sourceVideo = document.createElement('video');
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideo.srcObject = displayStream;
      captureVideoRef.current = sourceVideo;

      await new Promise<void>((resolve, reject) => {
        sourceVideo.onloadedmetadata = () => resolve();
        sourceVideo.onerror = () => reject(new Error('Không đọc được luồng hình từ tab.'));
      });
      await sourceVideo.play();

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = 720;
      outputCanvas.height = 1280;
      const canvasStream = outputCanvas.captureStream(30);

      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);
      outputStreamRef.current = combinedStream;

      const mimeCandidates = [
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const mimeType =
        mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type)) || 'video/webm';

      chunksRef.current = [];
      lessonCompletedRef.current = false;

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 6_000_000,
        audioBitsPerSecond: 192_000,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setError('Có lỗi khi mã hóa video.');
      };

      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        recorderRef.current = null;

        cleanupCapture();
        stopActiveAudio();
        activeSessionRef.current = '';
        setRunningHtml('');
        setIsRecording(false);

        if (chunks.length === 0) {
          setError('Không nhận được dữ liệu video để lưu.');
          setStatus('');
          return;
        }

        const type = recorder.mimeType || mimeType || 'video/webm';
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const baseName =
          (payload.fileName || 'html-kore')
            .replace(/\.html?$/i, '')
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'html-kore';

        link.href = url;
        link.download = `${baseName}-Kore-9x16.${ext}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);

        setIsCompleted(true);
        setStatus(
          lessonCompletedRef.current
            ? `Đã xuất video ${ext.toUpperCase()} 720×1280 có tiếng Kore.`
            : `Đã lưu video ${ext.toUpperCase()} nhưng quá trình ghi đã dừng sớm.`
        );
      };

      displayTrack?.addEventListener('ended', () => {
        if (recorder.state === 'recording') recorder.stop();
      });

      recorder.start(500);
      setIsRecording(true);

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      startFrameCropLoop(sourceVideo, outputCanvas);

      stopActiveAudio();
      const nextSession = makeSessionId();
      activeSessionRef.current = nextSession;
      narrationQueueRef.current = Promise.resolve();
      setSessionId(nextSession);
      setRunningHtml(
        injectHtmlNarrationBridge(
          injectHtmlRecordingLayout(payload.rawHtml),
          nextSession,
          lessonId
        )
      );
      setRunKey((value) => value + 1);
      setStatus('Đang ghi video 9:16 + Kore...');
    } catch (err: any) {
      cleanupCapture();
      recorderRef.current = null;
      setIsRecording(false);
      setRunningHtml('');
      setError(err?.message || 'Không bắt đầu được quá trình xuất video.');
      setStatus('');
    }
  };

  if (isRecording) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden">
        <div
          ref={frameRef}
          className="bg-black overflow-hidden"
          style={{
            width: 'min(100vw, 56.25vh)',
            height: 'min(100vh, 177.7778vw)',
            aspectRatio: '9 / 16',
          }}
        >
          <iframe
            key={`${runKey}-${sessionId}`}
            ref={iframeRef}
            title="HTML lesson export"
            srcDoc={runningHtml}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-black"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-5">
      <div className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-300">
            <Download className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black">Xuất video HTML + Kore</h1>
            <p className="text-xs text-slate-400 mt-1">
              Ghi animation HTML thật → cắt đúng 720×1280 → ghép Kore riêng.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/30 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {status && (
          <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-950/20 p-3 text-sm text-sky-200">
            {status}
          </div>
        )}

        <div className="rounded-xl bg-slate-950/60 p-4 text-sm text-slate-300 leading-relaxed mb-5">
          Khi trình duyệt hỏi chia sẻ màn hình, hãy chọn <strong>đúng tab này</strong>.
          Không cần bật “Chia sẻ âm thanh”, vì giọng Kore được app ghép trực tiếp vào video.
        </div>

        {!isCompleted ? (
          <button
            onClick={startExport}
            disabled={!payload || cues.length === 0 || isPreparing}
            className="w-full rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 font-black flex items-center justify-center gap-2"
          >
            {isPreparing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Play className="w-5 h-5" />
            )}
            {isPreparing ? 'Đang nạp Kore...' : 'Bắt đầu xuất video 9:16'}
          </button>
        ) : (
          <button
            onClick={() => window.close()}
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3 font-black flex items-center justify-center gap-2"
          >
            <XCircle className="w-5 h-5" />
            Đóng cửa sổ xuất
          </button>
        )}
      </div>
    </div>
  );
};

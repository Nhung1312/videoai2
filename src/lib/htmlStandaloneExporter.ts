export interface StandaloneHtmlExportCuePayload {
  id: string;
  narration: string;
  audio: ArrayBuffer;
}

export interface StandaloneHtmlExportPayload {
  sessionId: string;
  runningHtml: string;
  fileName: string;
  playbackRate: number;
  cues: StandaloneHtmlExportCuePayload[];
}

/**
 * Writes a self-contained exporter into an about:blank tab.
 *
 * The important part is that this tab is NOT an AI Studio app URL, so it does
 * not go through AI Studio's applet-auth-bridge (which returns 403 when opened
 * as a normal top-level page). The tab receives the already-cached Kore clips
 * from the opener and never calls the TTS API.
 */
export const writeStandaloneHtmlExportShell = (
  targetWindow: Window,
  exportId: string
): void => {
  const safeExportId = JSON.stringify(exportId).replace(/<\//g, '<\\/');

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Xuất video HTML + Kore</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: #020617; color: #f8fafc; }
    body { min-height: 100vh; overflow: hidden; }
    #setup {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at 20% 20%, rgba(124,58,237,.18), transparent 34%),
        radial-gradient(circle at 80% 80%, rgba(245,158,11,.12), transparent 30%),
        #020617;
    }
    .card {
      width: min(620px, 100%);
      border: 1px solid #334155;
      border-radius: 24px;
      background: rgba(15,23,42,.96);
      padding: 24px;
      box-shadow: 0 24px 80px rgba(0,0,0,.45);
    }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { margin: 0; color: #94a3b8; line-height: 1.6; font-size: 14px; }
    #status, #error {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    #status { border: 1px solid rgba(56,189,248,.28); background: rgba(8,47,73,.42); color: #bae6fd; }
    #error { display: none; border: 1px solid rgba(244,63,94,.35); background: rgba(76,5,25,.45); color: #fecdd3; }
    .tip {
      margin-top: 16px;
      padding: 14px;
      border-radius: 14px;
      background: rgba(2,6,23,.72);
      border: 1px solid #1e293b;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.6;
    }
    button {
      margin-top: 18px;
      width: 100%;
      border: 0;
      border-radius: 14px;
      padding: 13px 16px;
      font: inherit;
      font-weight: 800;
      color: white;
      background: linear-gradient(135deg,#d97706,#f97316);
      cursor: pointer;
    }
    button:disabled { opacity: .45; cursor: not-allowed; }
    #recording {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: #000;
      overflow: hidden;
    }
    #recording.active { display: flex; }
    #frame {
      width: min(100vw, 56.25vh);
      height: min(100vh, 177.7778vw);
      aspect-ratio: 9 / 16;
      background: #000;
      overflow: hidden;
    }
    #lesson {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: #000;
    }
    #recordingBadge {
      position: fixed;
      left: 12px;
      top: 12px;
      z-index: 20;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(127,29,29,.88);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <main id="setup">
    <section class="card">
      <h1>Xuất video HTML + Kore</h1>
      <p>Tab này chỉ dùng để ghi animation HTML thật và ghép giọng Kore đã chuẩn bị sẵn.</p>
      <div id="status">Đang nhận dữ liệu bài giảng từ app...</div>
      <div id="error"></div>
      <div class="tip">
        Khi trình duyệt hỏi chia sẻ, hãy chọn <b>chính tab “Xuất video HTML + Kore” này</b>.
        Không cần bật chia sẻ âm thanh; Kore được ghép trực tiếp vào file video.
        Trong lúc xuất, hãy giữ tab này đang mở để animation chạy mượt.
      </div>
      <button id="start" disabled>Bắt đầu xuất video 9:16</button>
    </section>
  </main>

  <section id="recording">
    <div id="recordingBadge">● ĐANG GHI 9:16</div>
    <div id="frame">
      <iframe id="lesson" title="HTML lesson export" sandbox="allow-scripts"></iframe>
    </div>
  </section>

  <script>
  (() => {
    const EXPORT_ID = ${safeExportId};
    const setup = document.getElementById('setup');
    const statusEl = document.getElementById('status');
    const errorEl = document.getElementById('error');
    const startButton = document.getElementById('start');
    const recordingView = document.getElementById('recording');
    const frame = document.getElementById('frame');
    const lesson = document.getElementById('lesson');
    const TARGET_FPS = 24;
    const TARGET_VIDEO_BITRATE = 4500000;
    const TARGET_AUDIO_BITRATE = 192000;

    let payload = null;
    let decoded = new Map();
    let audioContext = null;
    let audioDestination = null;
    let recorder = null;
    let displayStream = null;
    let outputStream = null;
    let sourceVideo = null;
    let outputCanvas = null;
    let videoFrameCallbackId = null;
    let frameHeartbeatTimer = null;
    let manualCanvasTrack = null;
    let frameTick = 0;
    let regionCaptureActive = false;
    let playedCueCount = 0;
    let audibleCueCount = 0;
    let chunks = [];
    let narrationQueue = Promise.resolve();
    let lessonCompleted = false;

    const setStatus = (message) => {
      statusEl.textContent = message || '';
      statusEl.style.display = message ? 'block' : 'none';
    };

    const showError = (message) => {
      errorEl.textContent = message || 'Có lỗi xảy ra.';
      errorEl.style.display = 'block';
      setStatus('');
      if (setup) setup.style.display = 'flex';
      recordingView.classList.remove('active');
      startButton.disabled = false;
    };

    const cleanupCapture = () => {
      if (videoFrameCallbackId != null && sourceVideo?.cancelVideoFrameCallback) {
        try { sourceVideo.cancelVideoFrameCallback(videoFrameCallbackId); } catch {}
        videoFrameCallbackId = null;
      }
      if (frameHeartbeatTimer != null) {
        clearInterval(frameHeartbeatTimer);
        frameHeartbeatTimer = null;
      }
      manualCanvasTrack = null;
      regionCaptureActive = false;
      if (sourceVideo) {
        try { sourceVideo.pause(); } catch {}
        sourceVideo.srcObject = null;
        sourceVideo = null;
      }
      if (displayStream) {
        displayStream.getTracks().forEach((track) => track.stop());
        displayStream = null;
      }
      if (outputStream) {
        outputStream.getTracks().forEach((track) => track.stop());
        outputStream = null;
      }
      audioDestination = null;
    };

    const stopRecorder = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };

    const safeBaseName = (name) => {
      const raw = String(name || 'html-kore').replace(/\.html?$/i, '');
      const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      return cleaned || 'html-kore';
    };

    const playCue = async (cueId) => {
      const buffer = decoded.get(cueId);
      if (!buffer) throw new Error('Thiếu Kore đã cache cho cue: ' + cueId);
      if (!audioContext || !audioDestination) {
        throw new Error('Bộ ghép âm thanh chưa sẵn sàng.');
      }

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = Number(payload?.playbackRate || 1);
      source.connect(audioContext.destination);
      source.connect(audioDestination);

      // Cheap signal check: make sure the cached Kore clip actually contains
      // non-silent PCM before we declare the final file successful.
      const channel = buffer.getChannelData(0);
      const stride = Math.max(1, Math.floor(channel.length / 1200));
      let peak = 0;
      for (let i = 0; i < channel.length; i += stride) {
        peak = Math.max(peak, Math.abs(channel[i]));
        if (peak > 0.002) break;
      }

      await new Promise((resolve, reject) => {
        source.onended = resolve;
        try {
          source.start();
          playedCueCount++;
          if (peak > 0.002) audibleCueCount++;
        } catch (err) {
          reject(err);
        }
      });
    };

    window.addEventListener('message', (event) => {
      const data = event.data || {};

      if (data.source === 'videoai2-standalone-export-init') {
        if (data.exportId !== EXPORT_ID) return;
        payload = data.payload || null;
        if (!payload?.runningHtml || !Array.isArray(payload?.cues)) {
          showError('Dữ liệu xuất video không hợp lệ.');
          return;
        }
        setStatus('Đã nhận ' + payload.cues.length + ' đoạn Kore. Sẵn sàng xuất video.');
        startButton.disabled = false;
        return;
      }

      if (!payload || event.source !== lesson.contentWindow) return;
      if (data.source !== 'videoai2-html-lesson' || data.sessionId !== payload.sessionId) return;

      if (data.type === 'lesson-complete') {
        lessonCompleted = true;
        setTimeout(stopRecorder, 900);
        return;
      }

      if (data.type !== 'narration-cue') return;

      const cueId = String(data.cueId || '');
      const requestId = String(data.requestId || '');
      const messageSession = String(data.sessionId || '');

      const runCue = async () => {
        try {
          await playCue(cueId);
          lesson.contentWindow?.postMessage({
            source: 'videoai2-html-host',
            sessionId: messageSession,
            requestId,
            ok: true
          }, '*');
        } catch (err) {
          const message = err?.message || 'Không phát được Kore.';
          lesson.contentWindow?.postMessage({
            source: 'videoai2-html-host',
            sessionId: messageSession,
            requestId,
            ok: false,
            error: message
          }, '*');
          showError(message);
          stopRecorder();
        }
      };

      narrationQueue = narrationQueue.then(runCue, runCue);
    });

    const decodeAllAudio = async () => {
      decoded = new Map();
      setStatus('Đang nạp Kore đã cache...');
      for (let i = 0; i < payload.cues.length; i++) {
        const cue = payload.cues[i];
        const copy = cue.audio.slice(0);
        const audioBuffer = await audioContext.decodeAudioData(copy);
        decoded.set(cue.id, audioBuffer);
        setStatus('Đang nạp Kore ' + (i + 1) + '/' + payload.cues.length + '...');
      }
    };

    const startCropLoop = () => {
      const ctx = outputCanvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Không khởi tạo được Canvas dựng video.');

      const drawFrame = () => {
        if (!sourceVideo || !displayStream || !outputCanvas) return;

        if (sourceVideo.readyState >= 2 && sourceVideo.videoWidth > 0 && sourceVideo.videoHeight > 0) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

          if (regionCaptureActive) {
            // Region Capture has already reduced the source to the 9:16 lesson
            // frame. Canvas now only performs the cheap final scale to exactly
            // 720×1280; it no longer has to crop the whole browser tab.
            ctx.drawImage(
              sourceVideo,
              0, 0, sourceVideo.videoWidth, sourceVideo.videoHeight,
              0, 0, outputCanvas.width, outputCanvas.height
            );
          } else {
            // Compatibility fallback for browsers without Region Capture.
            const rect = frame.getBoundingClientRect();
            const scaleX = sourceVideo.videoWidth / Math.max(1, window.innerWidth);
            const scaleY = sourceVideo.videoHeight / Math.max(1, window.innerHeight);

            const sx = Math.max(0, rect.left * scaleX);
            const sy = Math.max(0, rect.top * scaleY);
            const sw = Math.max(1, Math.min(sourceVideo.videoWidth - sx, rect.width * scaleX));
            const sh = Math.max(1, Math.min(sourceVideo.videoHeight - sy, rect.height * scaleY));

            ctx.drawImage(
              sourceVideo,
              sx, sy, sw, sh,
              0, 0, outputCanvas.width, outputCanvas.height
            );
          }

          // Force a real canvas change even when the lesson is visually static.
          // Without this, Chromium may stop emitting video frames while Kore keeps
          // playing, producing a shorter video track than the audio track.
          ctx.fillStyle = frameTick++ % 2 === 0 ? '#000000' : '#010101';
          ctx.fillRect(outputCanvas.width - 1, outputCanvas.height - 1, 1, 1);

          if (manualCanvasTrack?.requestFrame) {
            try { manualCanvasTrack.requestFrame(); } catch {}
          }
        }
      };

      const scheduleVideoFrame = () => {
        if (!sourceVideo || !displayStream) return;
        drawFrame();
        if (sourceVideo.requestVideoFrameCallback) {
          videoFrameCallbackId = sourceVideo.requestVideoFrameCallback(scheduleVideoFrame);
        }
      };

      if (sourceVideo.requestVideoFrameCallback) {
        videoFrameCallbackId = sourceVideo.requestVideoFrameCallback(scheduleVideoFrame);
      } else {
        frameHeartbeatTimer = setInterval(drawFrame, 1000 / TARGET_FPS);
      }

      // Heartbeat guarantees timestamps keep advancing even if the captured tab
      // becomes visually static or the browser briefly throttles video callbacks.
      if (frameHeartbeatTimer == null) {
        frameHeartbeatTimer = setInterval(drawFrame, 250);
      }

      drawFrame();
    };

    const tryEnableRegionCapture = async (displayTrack) => {
      const CropTargetApi = window.CropTarget;
      if (!CropTargetApi?.fromElement || typeof displayTrack?.cropTo !== 'function') {
        return false;
      }

      try {
        const cropTarget = await CropTargetApi.fromElement(frame);
        await displayTrack.cropTo(cropTarget);

        // Ask Chromium to cap capture work at 24 fps. Width/height are only
        // ideals here because the visible crop can be smaller than 720×1280;
        // the lightweight final Canvas scale guarantees the file is exactly
        // 720×1280 regardless of screen size.
        try {
          await displayTrack.applyConstraints({
            frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
            width: { ideal: 720 },
            height: { ideal: 1280 }
          });
        } catch {
          // Constraints are an optimization only; cropTo itself is enough.
        }

        return true;
      } catch (err) {
        console.warn('Region Capture unavailable; using Canvas crop fallback:', err);
        try {
          if (typeof displayTrack?.cropTo === 'function') await displayTrack.cropTo(null);
        } catch {}
        return false;
      }
    };

    startButton.addEventListener('click', async () => {
      if (!payload || startButton.disabled) return;
      errorEl.style.display = 'none';
      startButton.disabled = true;

      try {
        audioContext = audioContext || new AudioContext();
        if (audioContext.state === 'suspended') await audioContext.resume();
        await decodeAllAudio();

        setStatus('Hãy chọn chính tab xuất video này trong hộp chia sẻ...');
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: TARGET_FPS },
          audio: false,
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude'
        });

        const displayTrack = displayStream.getVideoTracks()[0];
        const displaySurface = displayTrack?.getSettings?.().displaySurface;
        if (displaySurface && displaySurface !== 'browser') {
          displayStream.getTracks().forEach((track) => track.stop());
          displayStream = null;
          throw new Error('Bạn vừa chọn cửa sổ/màn hình. Hãy bấm lại và chọn đúng tab xuất video này.');
        }

        audioDestination = audioContext.createMediaStreamDestination();

        setup.style.display = 'none';
        recordingView.classList.add('active');

        // Give the captured tab time to switch from the setup card to the clean
        // 9:16 recording frame before asking Region Capture for this element.
        await new Promise((resolve) => setTimeout(resolve, 650));

        regionCaptureActive = await tryEnableRegionCapture(displayTrack);
        setStatus(
          regionCaptureActive
            ? 'Đang xuất 9:16 bằng Region Capture + Kore...'
            : 'Trình duyệt chưa hỗ trợ Region Capture. Đang dùng chế độ tương thích + Kore...'
        );

        sourceVideo = document.createElement('video');
        sourceVideo.muted = true;
        sourceVideo.playsInline = true;
        sourceVideo.srcObject = displayStream;

        await new Promise((resolve, reject) => {
          sourceVideo.onloadedmetadata = resolve;
          sourceVideo.onerror = () => reject(new Error('Không đọc được luồng hình từ tab.'));
        });
        await sourceVideo.play();

        outputCanvas = document.createElement('canvas');
        outputCanvas.width = 720;
        outputCanvas.height = 1280;
        const canvasStream = outputCanvas.captureStream(0);
        manualCanvasTrack = canvasStream.getVideoTracks()[0] || null;

        outputStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioDestination.stream.getAudioTracks()
        ]);

        const outputVideoTracks = outputStream.getVideoTracks();
        const outputAudioTracks = outputStream.getAudioTracks();
        if (outputVideoTracks.length !== 1 || outputAudioTracks.length !== 1) {
          throw new Error(
            'Không tạo đủ luồng hình và tiếng. Đã dừng xuất để tránh tạo file lỗi.'
          );
        }

        startCropLoop();
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Do not use bare "video/mp4": Chromium may mux Opus audio into
        // an MP4 container, which exists in the file but is silent in several
        // Windows players/editors. Prefer an explicit AAC-in-MP4 profile; if the
        // browser cannot record AAC, fall back to WebM/Opus instead of producing
        // a misleading MP4 with incompatible audio.
        const candidates = [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
        ];
        const mimeType =
          candidates.find((type) => MediaRecorder.isTypeSupported(type)) || 'video/webm';

        chunks = [];
        lessonCompleted = false;
        playedCueCount = 0;
        audibleCueCount = 0;
        recorder = new MediaRecorder(outputStream, {
          mimeType,
          videoBitsPerSecond: TARGET_VIDEO_BITRATE,
          audioBitsPerSecond: TARGET_AUDIO_BITRATE
        });

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };

        recorder.onerror = () => showError('Có lỗi khi mã hóa video.');

        recorder.onstop = () => {
          const hadVideoTrack = Boolean(outputStream?.getVideoTracks().length);
          const hadAudioTrack = Boolean(outputStream?.getAudioTracks().length);
          const hadAudibleKore = playedCueCount > 0 && audibleCueCount > 0;

          cleanupCapture();

          if (chunks.length === 0) {
            showError('Không nhận được dữ liệu video để lưu.');
            return;
          }

          if (!hadVideoTrack || !hadAudioTrack || !hadAudibleKore) {
            showError(
              'Bản xuất chưa đủ cả hình và tiếng Kore nên app không tải file lỗi. Hãy xuất lại.'
            );
            return;
          }

          const type = recorder.mimeType || mimeType || 'video/webm';
          const ext = type.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(chunks, { type });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = safeBaseName(payload.fileName) + '-Kore-9x16.' + ext;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);

          recordingView.classList.remove('active');
          setup.style.display = 'flex';
          startButton.disabled = false;
          setStatus(
            lessonCompleted
              ? 'Đã xuất video ' + ext.toUpperCase() + ' 720×1280 đủ hình + tiếng Kore.'
              : 'Đã lưu video nhưng quá trình ghi bị dừng sớm.'
          );
        };

        displayTrack?.addEventListener('ended', () => {
          if (recorder && recorder.state === 'recording') recorder.stop();
        });

        recorder.start(500);

        // Only start the HTML lesson after the recorder already has clean 9:16 frames.
        await new Promise((resolve) => setTimeout(resolve, 220));
        lesson.srcdoc = payload.runningHtml;
      } catch (err) {
        cleanupCapture();
        startButton.disabled = false;
        showError(err?.message || 'Không bắt đầu được quá trình xuất video.');
      }
    });

    // Reassure the opener that the blank export shell is alive.
    try {
      window.opener?.postMessage({
        source: 'videoai2-standalone-export-ready',
        exportId: EXPORT_ID
      }, '*');
    } catch {}
  })();
  <\/script>
</body>
</html>`;

  targetWindow.document.open();
  targetWindow.document.write(html);
  targetWindow.document.close();
};

# Prototype xuất HTML + Kore trên server

Giai đoạn 1, chưa thêm nút xuất vào app. Không thay đổi HTML bài giảng gốc,
phát âm, AudioEngine, LessonModule, geometry engine hay bộ xuất LessonScript.
Nút **Tải HTML + Kore để quay thủ công** vẫn được giữ nguyên.

Nghiệm thu 18/10/2026: [bài thực tế 18 cue đã đạt 3/3](ACCEPTANCE.md) trong
Docker offline, Chromium sandbox bật, 2 CPU / 4 GiB. Bố cục chữ lớn theo video
tham chiếu được xác minh riêng ngày 19/10, xem cùng báo cáo. Job API/UI chưa được tích hợp.

## Điều kiện chuyển sang tích hợp UI

Chỉ tích hợp khi cùng một bài thực tế 15–20 cue dùng **đúng Kore đã cache**
được xuất 3/3 lần, kiểm tra cue đầu/cuối và chuyển động. Ba lần xuất bằng âm
báo tổng hợp không được tính là nghiệm thu. `npm run benchmark` cố ý không
đánh dấu đạt nếu thiếu bằng chứng nghe/xem hoặc phép đo tương đương.

## Pipeline

HTML thật → Chromium headed trên Xvfb 720×1280 → FFmpeg lấy X11 và PulseAudio
monitor trong **cùng một tiến trình** → normalize → ffprobe + decode đầy đủ → MP4.

Trạng thái runner: BOOT → LOADING → READY → RECORDING_READY → RUNNING →
FINISHING → COMPLETE; lỗi đi vào ERROR, không phát hoàn thành giả.

- Wrapper tạm thời chặn entry `startAnimation` trước cả lời gọi eager trong
  cùng script; hỗ trợ khai báo hàm, lexical function/arrow và gán window.
- Không thay thân animation, `cue`, `withCue`, CSS animation hay đồng hồ JS.
- Chờ MathJax startup, font, ảnh và decode toàn bộ clip trước READY.
- `cue` chỉ resolve sau WebAudio `ended`; giữ nguyên `Promise.all` của withCue.
- FFmpeg phải xuất frame và audio timeline trước khi mở gate; lead sạch 350 ms.
- Chờ animation, hàng đợi, nguồn audio, DOM và finite CSS animations; tail 700 ms.
- Không nối WAV, không tính thời gian theo số chữ, không dùng `-shortest`.
- Capture MKV H.264 + PCM để giữ phiên ghi; file cuối encode H.264/AAC-LC,
  yuv420p, CFR 30 fps, faststart. Không Opus-in-MP4.
- Ngưỡng chênh thời lượng track ban đầu 0.25 giây. Sai codec, thiếu track,
  mất đoạn cuối, lỗi decode hoặc frame count sai đều làm job failed.
- Một lock cho mỗi worker, không chạy hai job cùng lúc.

**CFR không chứng minh không đứng hình.** FFmpeg có thể lặp frame khi nguồn
chậm. Báo cáo có số drop/duplicate và khoảng gián đoạn rAF; nghiệm thu vẫn
phải kiểm chứng chuyển động và hình/tiếng ở đầu, giữa, cuối video thực tế.
Hai input cùng phiên dùng wallclock timestamp và `-isync 0` với copyts/start_at_zero
để giữ chênh mốc mở input; không mặc nhiên có latency bằng
0: cần đo độ lệch của capture/display/audio buffer bằng video chẩn đoán.
File MKV trung gian có thể thiếu audio ở phần lead trước khi mở bài do input
PulseAudio khởi tạo sau input X11. Chỉ chấp nhận gap nằm trước start gate và
hai track kết thúc gần nhau; normalize giữ PTS và thêm silence đầu bằng
`aresample=async=1:first_pts=0`. MP4 cuối vẫn phải đạt đủ kiểm tra mốc bắt đầu,
thời lượng và ngưỡng 0.25 giây, không nới ngưỡng đầu ra.

PulseAudio có thể ngừng cung cấp packet im lặng trước lúc khung hình cuối kết
thúc. Chỉ cho phép gap nằm trong khoảng chờ đã đo sau `cue-end` cuối (tối đa
1 giây, trừ biên 150 ms), và kiểm tra mẫu audio cuối thực sự im lặng. Normalize
dùng `apad=whole_dur` theo thời điểm kết thúc video đã capture. Không cắt hoặc
dịch lời đọc; MP4 cuối vẫn kiểm tra chênh thời lượng tối đa 0.25 giây.

## Chữ lớn trong video dọc

Bài có cấu trúc `.container` / `#board` / `.step-box` được render ở viewport
CSS 288×512, DPR 2.5: raster Chromium và file MP4 vẫn là 720×1280, không phóng
video sau khi quay. Chữ 16–18 CSS px thành khoảng 40–45 pixel trong video,
thay vì quá nhỏ khi trải nguyên CSS trên viewport 720 px.

Chỉ bản HTML runtime được thêm layout: đề bài giữ phía trên, board dùng phần
chiều cao còn lại, cuộn tới bước hiện tại. Bước vừa khung giữ 85–100% cỡ chữ;
bước quá dài giữ 100% và cuộn theo dòng/công thức đang xuất hiện, tiêu đề bước
được giữ ở đầu vùng đọc. Công thức SVG được giới hạn theo chiều rộng. Bước cũ
vẫn nằm trong DOM và được cuộn ra khỏi vùng đọc; không cần nhét mọi bước cùng
lúc bằng cách thu chữ xuống rất nhỏ. Emoji dùng font fallback trong image.

Không sửa file HTML đầu vào, thân animation, thời gian cue hoặc clip Kore.
HTML không nhận diện được cấu trúc trên vẫn dùng profile cũ 720×1280 / DPR 1;
profile này không phải bộ sửa bố cục tổng quát cho mọi HTML Gemini tùy ý.
API nội bộ `openRunner(..., { readablePortrait: false })` tắt profile để đối chiếu.

## Package nhị phân

```text
package/
  manifest.json
  lesson.html
  audio/000.wav
  audio/001.wav
  assets/...
```

```json
{
  "version": 1,
  "width": 720,
  "height": 1280,
  "fps": 30,
  "playbackRate": 1,
  "voiceName": "Kore",
  "lesson": "lesson.html",
  "source": { "kind": "frontend-cached-kore" },
  "cues": [
    { "id": "cue_intro", "file": "audio/000.wav", "mimeType": "audio/wav", "sha256": "SHA256_CUA_BYTES_AUDIO" }
  ],
  "assets": []
}
```

Không TTS API, không key, không audio base64 trong JSON render. Thiếu bất kỳ
cue nào là lỗi có cueId, trước khi chạy native recorder. Với prototype có
thể chuyển HTML đã tải bằng nút fallback thành package:

```bash
cd render-worker
npm ci
npm run package:offline -- /input/bai-Kore.html /output/package
npm run assets -- /output/package
```

Importer chỉ đọc JSON clip nhúng, không eval mã HTML. Chỉ bản sao trong package
bỏ UI/start gate của trình phát offline để dùng gate server; file đầu vào không
bị sửa. Không tự bịa Kore khi chỉ nhận HTML chưa có audio.

Asset stager chạy **trước render**, tách khỏi worker offline. Chỉ cho CDN đã
liệt kê, HTTPS, DNS IPv4 public được pin theo request, giới hạn redirect/kích
thước, thu thập URL trong CSS ngoài/inline và font `@import`. Các lệnh autoload
mặc định và `require` của MathJax 3 được nhận diện để đóng gói extension như
`color`, `bbox` trước khi chạy. Renderer không truy cập CDN. Thư viện có custom
lazy-load JS/font chưa được đóng gói sẽ báo URL thiếu và dừng job; cần bổ sung snapshot
tài nguyên ở bước packaging, không bắt giáo viên sửa HTML hay cho worker mở mạng.
Không dùng stager như một proxy public.

## Docker

Build từ gốc repository:

```bash
docker build -f render-worker/Dockerfile -t videoai2-render .
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --cpus 2 --memory 4g --pids-limit 256 --shm-size 512m \
  --tmpfs /tmp:rw,nosuid,nodev,size=768m,uid=1001,gid=1001 \
  --mount type=bind,src=/absolute/package,dst=/input,readonly \
  --mount type=bind,src=/absolute/output,dst=/output \
  videoai2-render /input /output
```

Thư mục output phải ghi được bởi UID 1001. Chạy từng container cho từng job,
không mount repo, home, Docker socket hoặc secret của ứng dụng vào container.
Không khai báo GEMINI_API_KEY/USER_GEMINI_API_KEY cho worker.
HOME, XDG_CONFIG_HOME và cấu hình PulseAudio được tạo riêng trong thư mục tạm
của job để chạy được với filesystem image chỉ đọc.

Chromium sandbox bật mặc định; nếu host chặn sandbox, sửa cấu hình host/seccomp
cho Chromium non-root, **không** bật no-sandbox cho dịch vụ chứa HTML không tin
cậy. Môi trường Docker/Railway thật cần xác minh user namespaces/seccomp trước
khi coi là production. `RENDER_TRUSTED_DIAGNOSTIC=1` chỉ dành cho test cục bộ với
fixture đã đọc/kiểm soát; không dùng trong Railway/Cloud Run.

Trong browser, mọi request được fulfill từ package, không có route.continue,
không server filesystem, service worker bị chặn, websocket bị đóng; thêm proxy
dead-end và tắt UDP WebRTC ngoài proxy. Đây là lớp phòng thủ bổ sung cho sandbox
và network namespace, không thay thế ranh giới container.

## Kiểm thử

```bash
npm test
CHROMIUM_BIN=/usr/bin/chromium npm run test:browser
CHROMIUM_BIN=/usr/bin/chromium npm run test:media
npm run benchmark -- /input/real-kore-package /output/real-kore-benchmark
```

Test browser kiểm tra gate, withCue song song, cue cuối dài, lỗi animation,
audio hỏng, không phát lesson-complete giả. Test native chạy đúng Xvfb/PulseAudio/
Chromium/FFmpeg, dùng âm báo tổng hợp có nhãn chẩn đoán để không dùng hạn mức TTS.
File report lưu cue timestamps, thời lượng/codec/frame, gap rAF và lỗi.

## Tích hợp sau nghiệm thu

API dự kiến (chưa bật trong app): POST `/api/render/jobs` nhận package multipart
hoặc URL object storage được kiểm soát, trả jobId; GET `/api/render/jobs/:id`
trả queued/preparing/rendering/encoding/validating/completed/failed và downloadUrl
chỉ khi validation thành công. Polling đủ cho bản đầu. Không chuyển package lớn
qua Vercel Function; tải trực tiếp đến storage/ingress phù hợp.

Railway: dùng image này làm executor job riêng, một render tại một thời điểm,
2 vCPU/4 GiB để benchmark, không dùng instance sleep/free cho render đang chạy.
Một service API/queue riêng điều phối executor; không mount Docker socket vào
worker. Không public CLI như API không xác thực. Việc chọn filesystem/output
adapter và scheduler độc lập nền tảng; Cloud Run Jobs có thể gọi cùng CLI,
staging input/output qua object storage. Không hard-code Railway.

Chưa có deployment production, API public, retry tự động hay UI server export.
Các phần đó thuộc giai đoạn 2/3 sau cổng nghiệm thu 3/3 với Kore thực tế.

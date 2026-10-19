# Kiểm thử HTML + Kore thực tế — 18–19/10/2026

**Pipeline hình/tiếng ngày 18/10 đạt 3/3 với cùng một bài 18 cue và đúng Kore cache.**
Người dùng sau đó phản hồi chữ quá nhỏ: kết quả kỹ thuật này không có nghĩa
bố cục ban đầu đã đạt yêu cầu đọc trên điện thoại.
Chưa tích hợp Job API/nút xuất vào app, chưa deploy worker.

- [CI trọn luồng](https://github.com/Nhung1312/videoai2/actions/runs/39115752572), mã worker được kiểm thử: `0cefcc38f96e523ca39d22ab8a8f884181311303`.
- Docker headed Chromium sandbox bật, network none, filesystem image chỉ đọc, 2 CPU / 4 GiB RAM, từng job chạy riêng.
- HTML gốc không đổi; SHA-256 `4f7d1ae125f1b6fb4353ed0ee0023ed403495e873454227f81935f7f5771c3a3`.
- Đủ 18 clip Kore, tổng 122.08 giây, playbackRate 1; không gọi TTS.
- Mọi MP4: 720×1280, 30 fps CFR, H.264, AAC-LC, yuv420p, faststart; ffprobe và full decode đều đạt.
- 18 test logic đạt. FFmpeg báo drop=0, duplicate=0 ở cả ba lượt.

| Lượt | Video | Frames | Chênh thời lượng track | Lệch cue đầu | Lệch cue cuối | Trôi tương đối cue lớn nhất | Tail sau hết clip cuối |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 126.766667 s | 3803 | 0.667 ms | 46.12 ms | 55.21 ms | 11.18 ms | 0.869 s |
| 2 | 126.800000 s | 3804 | 0.000 ms | 45.50 ms | 26.54 ms | 14.33 ms | 0.940 s |
| 3 | 126.666667 s | 3800 | 0.667 ms | 40.25 ms | 54.50 ms | 18.65 ms | 0.801 s |

## Sửa cỡ chữ và vùng đọc — 19/10/2026

- [CI bản cuối](https://github.com/Nhung1312/videoai2/actions/runs/39194946632),
  source `e023f735cd798cd3af78942a3d8af97f6ba76c20`.
- 20/20 test logic và test Chromium native về cỡ chữ, viewport/DPR, gate,
  đoạn rất dài, dòng cuối và tiêu đề sticky đều đạt.
- Viewport CSS 288×512 / DPR 2.5 được xác nhận trên native X11 720×1280.
  Bounding box glyph tiêu đề trong video tham chiếu: 544×64 px; hình native
  bản mới: 542×65 px (sai khác raster/font nhỏ), thay cho chữ quá nhỏ của bản cũ.
- Sáu trạng thái native trước ghi: intro, đầy đủ bước 1/3/4, đoạn dài nhân tạo,
  tổng kết. Đã xem các ảnh; focus overflow = 0 ở cả sáu trạng thái. Kiểm thử
  đoạn dài giữ font 100%, không ép toàn bộ đoạn vào khung bằng chữ nhỏ.
- Một MP4 cuối đã chạy nguyên animation bài thật: **126.900 s, 3,807 frame**,
  720×1280, H.264 / AAC-LC, 30 fps; hai track bằng thời lượng, full decode đạt.
  FFmpeg drop=0, duplicate=0; rAF gap lớn nhất 83.4 ms; wall time 207.6 s trên
  2 CPU / 4 GiB, sandbox bật, network none.
- Waveform khớp đủ **18/18** clip cache; trôi tương đối cue tối đa 22.67 ms,
  tail sau hết clip cuối 0.942 s. Tương quan toàn clip thấp nhất 0.769; không
  coi audio capture/lossy AAC là byte-identical với cache gốc.
- Mốc hình/tiếng cue đầu: 24.62 ms; mốc fade overlay cue cuối: −95.33 ms.
  Đo từ pixel 30 fps và waveform, chịu transition của HTML. Giây typewriter
  đầu có 24 frame thay đổi. Đã xem 14 khung tại 2–124 giây, gồm toàn bộ các
  bước, popup và tổng kết. Không dùng metadata CFR để thay thế xem chuyển động.
- Bộ theo dõi vùng đọc trong lượt animation thật báo max focus overflow = 0.
  Tiêu đề giữ ở đầu vùng đọc; bước cũ cuộn khỏi board; dòng cuối của đoạn dài
  vẫn nhìn thấy. Font emoji có trong image, tránh mất ký tự icon tổng kết.

Đây là **một lượt xác minh bố cục cuối**, không ghi thành benchmark mới 3/3.
Profile chỉ nhận diện cấu trúc container/board/step của bài này; không cam kết
sửa mọi HTML tùy ý. Các class `vanish`/`collapse` do tác giả chủ động dùng vẫn
được tôn trọng. Thân animation, cue, thời lượng và toàn bộ clip Kore không sửa;
HTML đầu vào giữ nguyên SHA-256 đã ghi trên. Chưa tích hợp nút/API hoặc deploy.

## Bằng chứng và giới hạn phép đo

Đối chiếu waveform PCM giải mã từ MP4 với từng clip cache: khớp đủ 18/18
trong cả ba video; tương quan thấp nhất >0.96. Lệch đầu/cuối được đo từ thời điểm
khớp waveform và pixel xuất hiện bước đầu / fade của overlay cuối ở 30 fps.
Phép đo pixel có độ phân giải 33.3 ms và chịu thời gian transition của HTML;
đây không phải cam kết đồng bộ đến từng sample.

Đã xem khung hình đầu, giữa, bước dài và khung cuối của cả ba MP4. Giây typewriter
đầu có 22–23 frame thay đổi, rAF gap lớn nhất 50–67 ms. Không dùng CFR hoặc metadata
đơn thuần làm bằng chứng không đứng hình. Kết quả này nghiệm thu bài đã kiểm thử,
không khẳng định mọi HTML tùy ý đều chạy được.

## Sửa lỗi phát hiện qua bài thật

1. PulseAudio dùng HOME/XDG_CONFIG_HOME riêng của job, chạy được khi image chỉ đọc.
2. Asset stager đóng gói font trong CSS inline/@import và extension MathJax autoload
   như color/bbox; renderer vẫn chạy offline.
3. PulseAudio kết thúc packet im lặng sớm hơn hình giữ cuối khoảng 0.6 giây.
   Đã xác nhận đủ cả clip cuối và mẫu audio đuôi im lặng. Chỉ bù silence trong
   khoảng tail đo được, có biên 150 ms; MP4 cuối giữ ngưỡng duration ≤0.25 giây.

HTML/audio đầu vào và MP4 không được đưa vào repository ở dạng plaintext.
Nhánh CI dùng trao đổi mã hóa với khóa dùng một lần; chỉ các sửa lỗi worker và
báo cáo này cần tích hợp vào main. Các chức năng app, phát âm, cache và manual
HTML + Kore fallback giữ nguyên.

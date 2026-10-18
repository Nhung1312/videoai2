# Nghiệm thu bài HTML + Kore thực tế — 18/10/2026

**Giai đoạn 1 đạt 3/3 với cùng một bài 18 cue và đúng Kore cache.**
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

# Báo cáo sửa engine chung — 12/10/2026

Bản sửa áp dụng cho toàn app; AHBK chỉ là bài kiểm tra hồi quy. Không push/sync GitHub, không triển khai lên dịch vụ bên ngoài.

1. **Các file ứng dụng đã sửa (7):** `server.ts`, `src/lib/audioEngine.ts`, `src/lib/mathReveal.ts`, `src/lib/canvasMathRenderer.ts`, `src/components/MathRenderer.tsx`, `src/lib/videoExporter.ts`, `src/index.css`. **Hai helper mới:** `src/lib/ttsProfile.ts`, `src/lib/mixedMathText.ts`. Có thêm bộ kiểm tra trong `tests/` và báo cáo này. `videoExporter.ts` chỉ thay các lời gọi vẽ nội dung đề và chờ font trước render; phần tính timeline, ghép PCM và mux giữ nguyên.
2. Trước sửa: **2 nguồn phân tích mixed text/math** (`parseMixedMathSegments`, `splitLatexTextSegments`).
3. Sau sửa: **1 nguồn sự thật**, trong `mixedMathText.ts`. `mathReveal.ts` chỉ re-export để tương thích các lời gọi cũ. Bộ đọc MathML phục vụ bố trí công thức Canvas không phân loại prose/math và không quyết định thời điểm hiện chữ.
4. Preview (`FormattedMathText`, `MixedMathLineView`) và Canvas **gọi cùng parser**.
5. Lệch hàng trước đây: Canvas đặt `textBaseline = 'top'`, dùng font prose và font Toán với chiều cao khác nhau nhưng cùng tọa độ mép trên.
6. Canvas hiện dùng **`alphabetic`**, một baseline chung cho các run trên từng dòng. Số mũ/chỉ số, tử/mẫu có vị trí riêng theo cấu trúc công thức.
7. Có dùng **`measureText().actualBoundingBoxAscent/Descent`**. Kiểm tra trên Chromium thật xác nhận các chỉ số khả dụng và hữu hạn.
8. Khi thiếu metrics: ascent = **0,8 × fontSize**, descent = **0,2 × fontSize**. Khoảng dòng dựa trên cực đại ascent/descent, thêm gap 0,32 × fontSize; chiều cao tối thiểu gần 1,55 × fontSize. Không quay về top-align.
9. Prose Việt: **Segoe UI, Arial, Noto Sans, sans-serif**, không italic.
10. Toán Preview: **KaTeX**. Canvas: font **KaTeX_Main/KaTeX_Math**, có Cambria Math/STIX/serif dự phòng; adapter MathML giữ phân số, căn, số mũ, chỉ số và hệ phương trình. Ký hiệu hình học có biểu diễn Unicode tương ứng.
11. Thứ tự run, nội dung chuẩn hóa và khoảng trắng có ý nghĩa dùng chung. DOM dùng bố trí inline của trình duyệt; Canvas đo width/metrics để wrap và bố trí dòng. Không hứa hai renderer cho vị trí từng pixel giống hệt nhau. Canvas bố trí toàn bộ dòng trước khi reveal để baseline/wrapping không nhảy khi thêm chữ.
12. TTS trước sửa **có fallback model riêng từng request**, có thể trộn Flash/Lite trong một lesson.
13. Sau sửa: model/style/version được **khóa ở chính sách chung toàn app** (`ttsProfile.ts`), không có fallback theo câu. Mặc định vẫn Kore; bộ chọn giọng hiện có được giữ nguyên, người dùng chọn giọng khác một cách chủ động vẫn có cache/profile riêng.
14. **Không còn đường tự động trộn Flash/Lite.** Server chỉ gọi model chính và từ chối profile khác. Client kiểm tra metadata trước khi đưa audio vào cache. Quota trả 429, không đổi sang Lite.
15. Cache client: **profileVersion + model + voiceName + styleVersion + voiceSpeed + stepId + narration** (tuple JSON tránh va chạm).
16. Cache server: **profileVersion + actual model được gọi + voiceName + styleVersion + normalizedText**.
17. **Có profile/version trong cả hai cache key.** Cache vẫn được tái sử dụng; không xóa vô điều kiện. Khi profile thay đổi, audio phải tạo lại lần đầu cho profile mới.
18. Giọng mặc định cuối cùng: **Kore**, giữ nguyên hướng dẫn giọng giáo viên Việt Nam.
19. **Không thêm Web Speech**, không thêm nguồn giọng trình duyệt.
20. **Không sửa đo duration, đồng bộ playback, audio offsets, leadIn, tailPadding, ghép PCM hay mux.** Thứ tự preload → đo duration → final timeline → pause → merge → render → mux được giữ nguyên.
21. **`presentationModel.ts` không sửa**, SHA-256 trùng bản gốc.
22. **Geometry engine không sửa**, gồm `GeometryRenderer.tsx`, `canvasGeometryRenderer.ts`, `geometryUtils.ts`, dữ liệu mẫu và lesson builder; SHA-256 trùng bản gốc.
23. **Sequential reveal không sửa ở các hàm/engine phân bổ thời gian.** Các hàm reveal hiện có giữ nguyên; parser mới chỉ cung cấp run cho renderer. `VideoCanvas.tsx` và `useTimeline.ts` cũng giữ nguyên.
24. **Typography:** 8/8 trường hợp bắt buộc PASS bằng parser và renderer thật: prose; implicit mixed; `\text{}`; ký hiệu; kết luận; đại số; inline `$`; câu dài wrap. Thêm 3 trường hợp PASS: phân số/căn/số mũ/chỉ số; tên điểm khác; hệ phương trình. Kiểm baseline, font prose, không tràn ngang, không chồng dòng, layout ổn định khi reveal và fallback metrics đều PASS. Đã xem hình kết quả thực tế.
25. **TTS profile:** PASS. Lesson giả 5 bước trên client và endpoint server thực tế (Gemini client được mock) dùng cùng model/Kore/style/version. Test cache, quota 429, profile sai và chặn metadata Lite đều PASS. Tổng bộ engine: **15/15 PASS**, **0 lần gọi API Gemini thật**. Có thêm **20 phép đối chiếu SHA-256** cho file/hàm phải giữ nguyên.
26. **`npm run lint`: PASS**, exit 0, chạy một lần sau khi sửa code.
27. **`npm run build`: PASS**, exit 0, **chạy đúng một lần**, Vite hoàn thành. Cảnh báo về `__dirname` trong cấu hình Vite hiện có và bundle trên 500 kB; không có lỗi build. `package.json` và `bun.lock` giữ nguyên. Cài dependencies kiểm tra bằng `npm install --legacy-peer-deps` vì ràng buộc peer esbuild/Vite của bản gốc. Có sẵn `dist/` từ lần build này.
28. **SAFE FOR GENERAL APP — trong phạm vi thay đổi và bộ kiểm đã nêu.** Chưa gọi/nghe TTS Gemini thật; phép kiểm chứng minh chính sách model/profile/cache nhất quán, không xác nhận âm sắc tuyệt đối giống nhau giữa các lần tổng hợp của dịch vụ.

## Kiểm thêm đường xuất video

Xuất và giải mã MP4 thành công cho cả lesson mẫu Hình học và Đại số, ở 16:9 và 9:16. Bốn lượt smoke test dùng 720p, 2 fps và không audio để kiểm pipeline/bố cục, không tốn API. Có thêm một lượt Hình học 16:9 ở 24 fps xuất MP4 thành công trong kiểm tra trước đó. Tốc độ khung hình mặc định trong app không thay đổi. Không dùng những video thử không có lời đọc làm bằng chứng về giọng TTS thật.

| Bài mẫu | Tỉ lệ | Kích thước | FPS kiểm tra | Kết quả |
|---|---|---|---|---|
| Hình học | 16:9 | 1280 × 720 | 2 | PASS (MP4 giải mã được) |
| Hình học | 9:16 | 720 × 1280 | 2 | PASS (MP4 giải mã được) |
| Đại số | 16:9 | 1280 × 720 | 2 | PASS (MP4 giải mã được) |
| Đại số | 9:16 | 720 × 1280 | 2 | PASS (MP4 giải mã được) |

## Dùng bản sửa

Thư mục gốc của ZIP là cấu trúc dự án giống bản bạn gửi; toàn bộ nguồn ứng dụng đã có đủ trong ZIP. Không có API key thật trong bản đóng gói.

- Chạy phát triển như trước: `npm run dev`.
- Nếu dùng bản build sẵn trong môi trường production: cài dependencies rồi đặt `NODE_ENV=production` và chạy `npm start`.
- Cần Gemini API key của bạn để tạo giọng thật. Hết quota TTS sẽ báo lỗi, không thay model.
- Để kiểm tra lại logic không gọi API: `node --import tsx tests/engine-regression.mjs`.
- Bộ kiểm trình duyệt cần Playwright/Chromium ngoài dependencies ứng dụng: `START_VITE=1 node tests/browser-regression.mjs`; bật xuất thử bằng `TEST_VIDEO_EXPORT=1`. Các biến môi trường đường dẫn trong script chỉ phục vụ runtime kiểm thử, không được app sử dụng.

Kết quả máy đọc được nằm trong `tests/engine-results.json` và `tests/browser-results.json`. Manifest `tests/protected-baseline.json` lưu các SHA-256 của bản gốc để kiểm phần khóa không bị thay đổi.

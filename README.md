# Azota Exporter 2.0 (Android)

Ứng dụng Android mở `azota.vn` ngay trong WebView, theo dõi các câu hỏi mà tài khoản đang được phép xem, quét toàn bộ đề bằng cách tự cuộn và xuất ra PDF hoặc DOCX.

## Điểm mới 2.0

- Giao diện trạng thái rõ ràng: **Đã phát hiện / Đã trích / Còn thiếu**.
- Bộ quét nằm sẵn trong APK, không phụ thuộc Tampermonkey, Violentmonkey hoặc CDN.
- Tự theo dõi câu hỏi ngay cả khi người dùng cuộn thủ công.
- Quét nhiều lượt để giảm bỏ sót với trang lazy-load/virtualized.
- Hiển thị số câu còn thiếu để người dùng biết cần cuộn lại đâu.
- PDF ưu tiên giữ bố cục, công thức, SVG, hình ảnh giống trang gốc.
- DOCX thật (Office Open XML), văn bản có thể chỉnh sửa + hình ảnh/canvas tải được.
- Lưu vào `Download/AzotaExporter` qua MediaStore, không cần quyền bộ nhớ rộng.

## Phạm vi

Ứng dụng chỉ thu thập **nội dung đang được Azota hiển thị cho tài khoản trong WebView**. Không đọc đáp án ẩn, không tự chọn đáp án, không tự nộp bài và không vượt qua đăng nhập/quyền truy cập.

## Cách dùng

1. Mở app.
2. Dán link đề Azota → **Mở đề**.
3. Đăng nhập/bắt đầu bài nếu Azota yêu cầu.
4. Khi câu hỏi đã xuất hiện, bấm **Quét đề**.
5. Chờ thanh trạng thái báo số câu đã trích. Nếu `Còn thiếu = 0`, có thể xuất ngay.
6. Bấm **Xuất PDF** hoặc **Xuất DOCX**.
7. File nằm trong `Download/AzotaExporter`.

## Build

- JDK 17
- Gradle 8.9
- Android Gradle Plugin 8.7.3
- Android SDK 35
- Build Tools 35.0.0

### Android Studio

Mở project → **Build > Build APK(s)**.

### GitHub Actions

Project có `.github/workflows/build-apk.yml`. Push toàn bộ project lên nhánh `main`, vào **Actions → Build APK → Run workflow**. Artifact `AzotaExporter-debug-apk` chứa `app-debug.apk`.

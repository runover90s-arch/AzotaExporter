# Lấy file APK bằng GitHub

1. Tạo một repository trống trên GitHub, ví dụ `AzotaExporter`.
2. Upload toàn bộ file/folder trong project này vào repository.
3. Mở tab **Actions**.
4. Chọn workflow **Build APK**.
5. Chọn **Run workflow**.
6. Khi workflow hoàn tất, tải artifact **AzotaExporter-debug-apk**.
7. Giải nén artifact, bên trong là `app-debug.apk`.

APK debug cài trực tiếp được trên Android. Nếu Android cảnh báo nguồn không xác định, cấp quyền cài ứng dụng cho trình duyệt/quản lý tệp đang dùng.

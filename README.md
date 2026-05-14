# 🤖 Zalo Logistics & Order Bot (247Express Integration)

Một ứng dụng Zalo Bot mạnh mẽ, tích hợp quản lý đơn hàng chuyên nghiệp, tra cứu vận đơn 247Express tự động và đồng bộ Google Sheets.

## 🚀 Tính năng nổi bật

### 1. Quản lý Đơn hàng Thông minh (State-driven Menu)
- **Menu điều hướng số**: Sử dụng phím số (1-7) để thao tác, tối ưu cho giao diện Zalo di động.
- **Tính năng thoát thông minh**: Hỗ trợ từ khóa `thoat`, `tat`, `exit` để dừng bot theo ngữ cảnh.
- **Quay lại linh hoạt**: Nhấn `0` để quay lại Menu cấp cha hoặc làm mới trạng thái hiện tại.

### 2. Tích hợp 247Express (Logistics)
- **Tra cứu vận đơn**: Xem hành trình chi tiết, phí vận chuyển và thông tin người nhận.
- **Danh sách vận đơn**: Liệt kê 15 đơn hàng mới nhất với định dạng chi tiết (`Mã đơn - Người nhận - Địa chỉ - Trạng thái`).
- **Tra cứu theo tháng**: Hỗ trợ tìm kiếm đơn hàng theo định dạng `Tháng,Năm` (vd: `5,26`).
- **Bộ icon trực quan**: Sử dụng emoji logistics chuyên nghiệp (📝 Đã tiếp nhận, 📦 Đã lấy hàng, 🚚 Đang vận chuyển, ✅ Thành công).

### 3. Theo dõi & Thông báo Tự động (Auto-Tracking)
- **Background Job**: Tự động quét danh sách vận đơn mỗi 30 phút.
- **Redis Persistence**: Sử dụng Redis để lưu và so sánh trạng thái đơn hàng.
- **Thông báo thay đổi**: Tự động gửi tin nhắn Zalo khi đơn hàng đổi trạng thái (vd: Từ *Đang vận chuyển* -> *Thành công*).
- **Cấu hình linh hoạt**: Hỗ trợ lệnh `setnotify` để chọn nơi nhận tin (Nhóm hoặc Cá nhân).

### 4. Quản lý dữ liệu qua Google Sheets
- **Lưu đơn hàng**: Tự động ghi nhận thông tin đơn hàng mới vào Google Sheets.
- **Tra cứu sản phẩm**: Tìm kiếm thông tin sản phẩm trực tiếp từ Zalo.
- **Đồng bộ thời gian thực**: Phân loại đơn hàng theo Tuần/Tháng/Năm tự động.

### 5. Dashboard Quản trị Web
- **Giao diện Modern Dark**: Dashboard chuyên nghiệp hiển thị trạng thái Bot.
- **Đăng nhập QR**: Quét mã QR trực tiếp trên web để kích hoạt Bot.
- **Real-time Logs**: Theo dõi lịch sử tin nhắn và hoạt động của Bot thời gian thực.

## ⚙️ Cơ chế Vận hành & Duy trì (24/7)

### 1. Cách thức Đăng nhập
- Bot sử dụng thư viện `zalo-js` để giả lập môi trường web. 
- **Lần đầu**: Truy cập Dashboard (mặc định `http://localhost:3000`), nhấn **Login** để hiện mã QR và quét bằng Zalo.
- **Tự động đăng nhập**: Sau khi quét, Cookie (Session) sẽ được mã hóa và lưu vào **Upstash Redis**. Khi Server restart hoặc deploy lại, Bot sẽ tự động lấy Cookie từ Redis để đăng nhập lại mà không cần quét mã lần nữa.

### 2. Chống ngủ (Anti-Sleep / Keep-alive)
Để Bot không bị dừng (sleep) khi dùng các dịch vụ miễn phí như Koyeb, Render, bạn có thể áp dụng:
- **Tự động quét (Built-in)**: Hệ thống đã có sẵn `runAutoTracking` chạy mỗi 30 phút. Việc truy vấn API liên tục này giúp tiến trình Node.js luôn ở trạng thái Active.
- **External Ping**: Sử dụng các dịch vụ như [Cron-job.org](https://cron-job.org/) hoặc [UptimeRobot](https://uptimerobot.com/) để "ping" vào URL của Dashboard mỗi 5-10 phút. Điều này đảm bảo HTTP Server luôn thức.

### 3. Triển khai (Deployment)
1. **Clone project**: `git clone [URL_REPO]`
2. **Cài đặt**: `npm install`
3. **Cấu hình**: Sao chép `.env.example` thành `.env` và điền đầy đủ các API Key.
4. **Chạy Production**:
   - Sử dụng PM2: `pm2 start server.js --name zalo-bot`
   - Hoặc deploy trực tiếp lên Koyeb/Render/Heroku qua file `Dockerfile` hoặc `Build Command: npm install && npm run build`.

## 📋 Hướng dẫn Cài đặt & Sử dụng

### Biến môi trường (.env)
Cần cấu hình các biến sau:
- `GEMINI_API_KEY`: API Key cho AI (nếu dùng)
- `GOOGLE_SHEET_ID`: ID của file Google Sheet
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Email Service Account
- `GOOGLE_PRIVATE_KEY`: Private Key của Google API
- `GH247_CLIENT_ID` & `GH247_TOKEN`: Tài khoản 247Express
- `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`: Kết nối Redis (Dùng để lưu Session và trạng thái đơn hàng).

### Các lệnh chính trên Zalo
- `bot247`: Mở Menu quản lý logistics 247Express.
- `setnotify`: Thiết lập cuộc trò chuyện hiện tại làm nơi nhận thông báo tự động (mỗi 30p quét 1 lần).
- `testnotify`: Kích hoạt quét đơn hàng thủ công để kiểm tra thông báo ngay lập tức.
- `thoat`: Thoát khỏi các chế độ Menu/Bot.

---
*Phát triển bởi Antigravity Team*

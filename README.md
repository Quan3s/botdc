# ASYNCTAS — Discord Bot + Web Dashboard

Bot Discord bán/đăng ký tài khoản cloud kèm **web dashboard** đầy đủ: tài khoản web riêng,
shop lưu kho trên GitHub Gist, nhiệm vụ vượt link, bảng xếp hạng và trang quản trị.

## Tính năng

### Bot Discord
- `/reg` — panel chọn dịch vụ tạo tài khoản nhanh (VMOS, VSPhone).
- `/buycloud` — mua máy cloud qua Hanami (UGPhone / VMOS / VSPhone).
- `/getlink` — nhận link nhiệm vụ vượt link (2 lượt/ngày/dịch vụ, +50 xu).
- `/shop` — xem danh sách sản phẩm, giá, logo và tồn kho.
- `/connect <token>` — liên kết tài khoản web với Discord để **đồng bộ coin**.
- `/vi`, `/daily`, `/code`, `/pay`, `/star`, `/sdone`, `/adcoin`, `/gen`, `/op`, `/unop`, `/clear`.
- Sau khi tạo tài khoản, bot gửi kèm nút **📋 Copy acc|pass** (bấm để nhận lại đúng định dạng `tài khoản|mật_khẩu`).

### Web dashboard
- Đăng ký / đăng nhập tài khoản web riêng (mật khẩu hash bằng scrypt).
- Số dư coin hiển thị ở góc trên; nút bấm trực quan cho mọi chức năng.
- **Shop**: mua hàng, xem đồ đã mua, copy tài khoản.
- **Buy Device**: mua cloud (Hanami) và reg tài khoản.
- **Nhiệm vụ**: lấy link vượt link, theo dõi lượt trong ngày & trong tuần.
- **Xếp hạng**: bảng xếp hạng coin và bảng xếp hạng vượt link.
- **Chuyển tiền**: chuyển coin cho người khác (phí 5%).
- **Hồ sơ**: đổi mật khẩu, xem/copy token liên kết Discord.
- **Quản trị** (chỉ hiện với tài khoản đã liên kết Discord admin): tạo sản phẩm, upload kho lên GitHub Gist,
  đặt giá, thêm kho, sửa/xoá sản phẩm, xem đơn hàng, người dùng, chạy trả thưởng tuần.

### Thưởng bảng xếp hạng vượt link (tự động mỗi Chủ nhật)
| Hạng | Thưởng |
|------|--------|
| Top 1 | 300 coin |
| Top 2 | 150 coin |
| Top 3 | 75 coin |
| Top 4-10 | 40 coin |

Sau khi trả thưởng, bộ đếm vượt link bắt đầu kỳ mới. Có thể chạy thủ công trong trang Quản trị.

## Cài đặt

```bash
npm install
cp .env.example .env   # điền các biến cần thiết
npm start
```

- Mở `http://localhost:3000` để vào dashboard.
- Nếu **không** cấu hình `SUPABASE_URL`/`SUPABASE_KEY`, hệ thống tự dùng file JSON cục bộ
  `./data/local-db.json` (tiện dev/demo). Khi deploy thật hãy dùng Supabase.
- Đặt `DISABLE_BOT=1` nếu chỉ muốn chạy web khi dev.

### Supabase
Chạy `supabase_setup.sql` trong **SQL Editor** để tạo đầy đủ bảng (kể cả các bảng cũ của bot).

### GitHub Gist (kho shop)
Tạo token GitHub có quyền `gist` và điền `GITHUB_TOKEN`. Khi admin tạo sản phẩm:
1. Server tạo 1 **secret gist** chứa danh sách tài khoản (mỗi dòng 1 tài khoản).
2. Khi có người mua N tài khoản, server lấy N dòng đầu và **ghi lại gist** với phần còn lại
   (tự động xoá tài khoản đã bán), đồng thời cập nhật tồn kho.

Nếu chưa có `GITHUB_TOKEN`, kho được lưu tạm trong DB (chế độ local) để test.

### Liên kết admin
1. Đăng nhập web, vào **Hồ sơ**, copy token.
2. Trong Discord (tài khoản admin) gõ `/connect <token>`.
3. Mục **Quản trị** sẽ hiện trên dashboard.

Admin được xác định bởi `ADMIN_DISCORD_ID` (owner) hoặc bảng `admins` (cấp qua `/op`).

## Biến môi trường
Xem `.env.example`. Các biến quan trọng: `DISCORD_TOKEN`, `ADMIN_DISCORD_ID`,
`SUPABASE_URL`, `SUPABASE_KEY`, `RENDER_DOMAIN`, `GITHUB_TOKEN`, `HANAMI_TOKEN`, `LINK4M_API_KEY`, `LAYMA_TOKEN`.

## Bảo mật
- Token GitHub/Hanami chỉ nằm ở server, không bao giờ gửi xuống trình duyệt.
- Mật khẩu web hash bằng `scrypt`; session lưu dạng hash SHA-256 trong DB, cookie `HttpOnly`.
- Mọi thao tác coin/shop/admin đều kiểm tra quyền phía server.
- **Không commit file `.env`** (đã có trong `.gitignore`). Nếu token từng bị lộ, hãy thu hồi và tạo token mới.

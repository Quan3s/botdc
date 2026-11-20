# ASYNCTAS — Discord Bot + Web Dashboard

Bot Discord bán/đăng ký tài khoản cloud kèm **web dashboard** đầy đủ: tài khoản web riêng,
shop lưu kho trên GitHub Gist, nhiệm vụ vượt link, bảng xếp hạng và trang quản trị.

## Tính năng

### Bot Discord
- `/reg` — panel chọn dịch vụ tạo tài khoản nhanh (VMOS, VSPhone).
- `/buycloud` — mua máy cloud qua Hanami (UGPhone / VMOS / VSPhone).
- `/getlink` — nhận link nhiệm vụ vượt link (2 lượt/ngày/dịch vụ, +50 xu).
- `/shop` — xem danh sách sản phẩm, giá, logo và tồn kho.
- `/connect <token>` — liên kết tài khoản web với Discord để **cộng dồn coin** (coin web + coin Discord).
- `/token` — lấy **token cố định** của tài khoản (bằng `web_users.link_token`); dùng để đăng nhập web hoặc `/connect`.
- `/meows` — mua nhanh **UGPhone (49 xu)** hoặc **VSPhone VIP (15 xu)**.
- `/plugin ten:lenh` — gọi lệnh do plugin đăng ký.
- `/vi`, `/daily`, `/code`, `/pay`, `/star`, `/sdone`, `/adcoin`, `/gen`, `/op`, `/unop`, `/clear`.
- Sau khi tạo tài khoản, bot gửi kèm nút **📋 Copy acc|pass** (bấm để nhận lại đúng định dạng `tài khoản|mật_khẩu`).

### Web dashboard
- Đăng ký / đăng nhập tài khoản web riêng (mật khẩu hash bằng scrypt) hoặc đăng nhập bằng **token Discord**.
- Tên đăng nhập phải có **ít nhất 1 chữ cái**; tài khoản cũ chỉ toàn số bị ép đổi tên khi login.
- Số dư coin hiển thị ở góc trên; nút bấm trực quan cho mọi chức năng.
- **Shop**: mua hàng, xem đồ đã mua, copy tài khoản.
- **Giftcode**: nhập mã quà để nhận coin (mã tạo từ lệnh `/gen`).
- **Buy Device**: mua cloud (Hanami), reg tài khoản và mua nhanh (UGPhone 49 xu / VSPhone VIP 15 xu).
- **Cloud Status** (hiển thị cho mọi người, không cần đăng nhập): trạng thái **VMOS Cloud** và **VSPhone** của dịch vụ mua nhanh (lấy từ `GET https://meows.vn/api/cloud-status`). Tự làm mới mỗi 60s; API public `GET /api/status/cloud` (cache 60s, `?force=1` để lấy mới ngay). `status: offline` = hết máy. Nếu Meows trả 403, phần lỗi sẽ hiện rõ để biết IP server bị chặn; không ảnh hưởng các chức năng khác.
- **Nhiệm vụ**: lấy link vượt link, theo dõi lượt trong ngày & trong tuần.
- **Xếp hạng**: coin · vượt link **7 ngày** (có thưởng, reset sau mỗi kỳ) · vượt link **tổng** (không thưởng). Tên hiển thị là username, không phải ID số.
- **Chuyển tiền**: chuyển coin cho người khác (phí 5%).
- **Hồ sơ**: đổi mật khẩu, xem/copy token liên kết Discord.
- **Quản trị** (chỉ hiện với tài khoản đã liên kết Discord admin), chia 4 tab:
  - **User**: danh sách người dùng, đơn hàng, lịch sử trả thưởng.
  - **Shop**: tạo sản phẩm, upload kho lên GitHub Gist, đặt giá, thêm kho, sửa/xoá.
  - **Plugin**: dán link raw script → tự lưu Gist → lưu gist_id vào DB → load chạy ngay (không deploy lại).
  - **Cookie**: nhập/lưu cookie dùng cho 2 dịch vụ mua nhanh; tự chuẩn hoá `.COOKIESECURITY=<cookie>`, đổi không cần deploy.

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

### Plugin (thêm logic/API không cần deploy)
Vào **Quản trị → Plugin**, nhập tên và link raw script (http/https). Server sẽ:
1. Tải script về (tối đa 200KB).
2. Lưu nội dung vào 1 secret gist; `gist_id` lưu ở bảng `plugins`.
3. Load script ngay trong sandbox `vm` và mount route `/plugin/<plugin-id>/...`.
4. Load lại từ gist mỗi lần restart hoặc bấm **Reload**.

Script mẫu:
```js
api.get('/hello', (req, res) => res.json({ ok: true }));
api.command('ping', async ({ interaction, db, api }) => {
  await interaction.editReply('pong'); // /plugin <ten>:ping (lệnh đã deferReply)
});
```
Có thể dùng `api.get/post/put/patch/delete`, `api.command`, `api.kv`, `api.webhook`, `db`, `crypto`, `fetch`, `URL`, `Buffer`.
Chỉ admin mới được cài/sửa plugin; sandbox chỉ để hạn chế, không phải hàng rào bảo mật tuyệt đối — hãy dùng nguồn script tin cậy.

### Liên kết admin
1. Đăng nhập web, vào **Hồ sơ**, copy token.
2. Trong Discord (tài khoản admin) gõ `/connect <token>`.
3. Mục **Quản trị** sẽ hiện trên dashboard.

Admin được xác định bởi `ADMIN_DISCORD_ID` (owner) hoặc bảng `admins` (cấp qua `/op`).

### Cookie dịch vụ nhanh
Vào **Quản trị → Cookie**, dán cookie lấy từ trang cung cấp dịch vụ (có thể dán cả chuỗi `.COOKIESECURITY=...` hoặc cả header `Cookie: ...`).
Server tự lưu vào bảng `kv` (key `meows_cookie`) dạng `.COOKIESECURITY=<cookie>`; **không cần tạo bảng mới**.
Cookie hết hạn chỉ cần cập nhật ở đây, không deploy lại. Dùng cho `/meows` và mục **Buy Device → Mua nhanh**.

## Biến môi trường
Xem `.env.example`. Các biến quan trọng: `DISCORD_TOKEN`, `ADMIN_DISCORD_ID`,
`SUPABASE_URL`, `SUPABASE_KEY`, `RENDER_DOMAIN`, `GITHUB_TOKEN`, `HANAMI_TOKEN`, `LINK4M_API_KEY`, `LAYMA_TOKEN`.

## Bảo mật
- Token GitHub/Hanami chỉ nằm ở server, không bao giờ gửi xuống trình duyệt.
- Mật khẩu web hash bằng `scrypt`; session lưu dạng hash SHA-256 trong DB, cookie `HttpOnly`.
- Mọi thao tác coin/shop/admin đều kiểm tra quyền phía server.
- **Không commit file `.env`** (đã có trong `.gitignore`). Nếu token từng bị lộ, hãy thu hồi và tạo token mới.

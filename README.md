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
- **Cloud Status** (hiển thị cho mọi người, không cần đăng nhập): trạng thái **VMOS Cloud** và **VSPhone** của dịch vụ mua nhanh (lấy từ `GET https://meows.vn/api/cloud-status`). Tự làm mới mỗi 60s; API public `GET /api/status/cloud` (cache 60s, `?force=1` để lấy mới ngay). `status: offline` = hết máy. Nếu IP server bị Cloudflare chặn (`403 - Just a moment...`), hệ thống tự thử `www.meows.vn` rồi tới proxy đọc nội dung; ô thời gian sẽ hiện `proxy` khi đang dùng đường dự phòng. Cả 3 đường cùng lỗi mới hiện thông báo lỗi.
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

### Proxy API (Render / WARP / Worker) — dùng chung
IP Render bị Meows/Cloudflare chặn (`403 - Just a moment...`), nhưng **IP Cloudflare (WARP / Worker)** thì dùng được. Proxy này áp dụng cho:

- **Cloud Status**
- **Mua nhanh** Meows (UGPhone 49 xu / VSPhone VIP 15 xu)
- **Mua UGPhone** qua Hanami (`Buy Device` / lệnh `reg`)

**Render không cài được `warp-cli`** (cần `NET_ADMIN` + `/dev/net/tun`), nên dùng Cloudflare Worker.

**A. Cloudflare Worker (khuyến nghị trên Render)**

Copy nội dung file [`cloudflare-proxy-worker.js`](./cloudflare-proxy-worker.js) → Cloudflare Dashboard → **Workers & Pages → Create Worker** → dán → Deploy. Worker chỉ forward tới `meows.vn` và `hanaminikata.com`, nên không thành open proxy.

Rồi dán URL Worker vào **Quản trị → Cookie → Proxy API**, hoặc set env:

```text
MEOWS_API_PROXY=https://xxx.your-subdomain.workers.dev
```

Nếu đặt secret `PROXY_KEY` trên Worker, set thêm `MEOWS_PROXY_KEY` trên Render để bot gửi header `x-proxy-key`.

**B. WARP userspace bằng `wgcf` + `wireproxy` (không cần TUN/NET_ADMIN)**

Cách này chạy được trên VPS thường, không cần `warp-cli`, không cần `/dev/net/tun`. Có sẵn script trong repo: [`scripts/warp-wireproxy.sh`](./scripts/warp-wireproxy.sh).

```bash
# Cài 2 binary (xem trang release):
#   https://github.com/ViRb3/wgcf/releases
#   https://github.com/pufferffish/wireproxy/releases
wgcf register --accept-tos
wgcf generate                       # ra wgcf-profile.conf ([Interface] + [Peer])

# Tạo wireproxy.conf = nội dung file trên + đoạn [Socks5], rồi chạy:
./scripts/warp-wireproxy.sh

# Kiểm tra:
curl -x socks5h://127.0.0.1:1080 https://meows.vn/api/cloud-status
```

Nếu expose ra ngoài cho Render kết nối:

```bash
WARP_SOCKS_BIND=0.0.0.0 \
WARP_SOCKS_USER=proxyuser \
WARP_SOCKS_PASS='pass-khong-co-dau-cach' \
./scripts/warp-wireproxy.sh
```

Rồi set trên Render:

```text
MEOWS_API_PROXY=socks5h://proxyuser:pass-khong-co-dau-cach@IP_VPS:1080
```

VPS/script này **phải chạy 24/7** (dùng `systemd` hoặc Docker `restart: always`). WARP profile (`wgcf-profile.conf`) chứa private key → đã nằm trong `.gitignore`, không commit.

Nếu vẫn dùng `warp-cli` (cần TUN) thì proxy mode mặc định là `127.0.0.1:40000`.

Ưu tiên env: `MEOWS_API_PROXY` → `MEOWS_STATUS_PROXY` → ô trong DB → gọi trực tiếp.

**Mua máy dùng chung chain với status**: `worker`/`warp` → `direct` (**không dùng `www`**, vì API mua chỉ có trên domain chính và `www` dễ trả 404). Chỉ retry khi bị Cloudflare chặn (403/Just a moment), Worker trả 404 (bản cũ/sai route) hoặc lỗi mạng; **không retry sau khi API đã trả response hợp lệ** để tránh mua trùng/trừ coin trùng. Reader proxy chỉ dùng cho GET (status), không dùng cho POST mua hàng. Thông báo lỗi sẽ kèm `[nguồn: ...]` và danh sách các nguồn đã thử.

Ô thời gian trên **Cloud Status** hiện `worker` / `warp` / `www` / `proxy` tương ứng nguồn đang dùng.

## Biến môi trường
Xem `.env.example`. Các biến quan trọng: `DISCORD_TOKEN`, `ADMIN_DISCORD_ID`,
`SUPABASE_URL`, `SUPABASE_KEY`, `RENDER_DOMAIN`, `GITHUB_TOKEN`, `HANAMI_TOKEN`, `LINK4M_API_KEY`, `LAYMA_TOKEN`, `MEOWS_API_PROXY` / `MEOWS_STATUS_PROXY` (tuỳ chọn, Worker hoặc SOCKS5/WARP), `MEOWS_PROXY_KEY` (tuỳ chọn, secret của Worker).

## Bảo mật
- Token GitHub/Hanami chỉ nằm ở server, không bao giờ gửi xuống trình duyệt.
- Mật khẩu web hash bằng `scrypt`; session lưu dạng hash SHA-256 trong DB, cookie `HttpOnly`.
- Mọi thao tác coin/shop/admin đều kiểm tra quyền phía server.
- **Không commit file `.env`** (đã có trong `.gitignore`). Nếu token từng bị lộ, hãy thu hồi và tạo token mới.

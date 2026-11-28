# ASYNCTAS — Discord Bot + Web Dashboard

Bot Discord bán/đăng ký tài khoản cloud kèm **web dashboard** đầy đủ: tài khoản web riêng,
shop lưu kho trên GitHub Gist, nhiệm vụ vượt link, bảng xếp hạng và trang quản trị.

## Tính năng

### Bot Discord
- `/reg` — panel chọn dịch vụ: VMOS (60 xu), VSPhone (100 xu), **UGPhone (490 xu)** và **VSPhone VIP (150 xu)**. Giá chỉnh được trong Admin Hub → Kinh tế. Hai dịch vụ mua nhanh dùng chung luồng với `/asynctas` (`/meows` là lệnh cũ, vẫn hoạt động).
- `/buycloud` — mua máy cloud qua Hanami (UGPhone / VMOS / VSPhone).
- `/getlink` — nhận link nhiệm vụ: **Link4M +409 xu**, **LayMa +450 xu** (2 lượt/ngày), **bbmkts +259 xu** (1 lượt/ngày). Thưởng chỉnh được trong Admin Hub → Kinh tế.
- `/tasks` — xem tiến độ từng dịch vụ hôm nay (cùng dữ liệu `GET /api/tasks`).
- `/vmosfree` — lấy 1 tài khoản VMOS free mỗi ngày (cần đã vượt ≥ 1 link).
- `/cloudstatus` / `/cloudphone_status` — xem trạng thái VMOS Cloud / VSPhone (cùng nguồn với web). `/cloudphone_status lam_moi:true` bỏ cache như nút Làm mới trên web.
- `/theme`, `/username`, `/history`, `/buy`, `/leaderboard` — đồng bộ các chức năng web (giao diện, tên tài khoản, lịch sử mua/chuyển, mua shop, BXH) lên Discord.
- `/wallpaper`, `/proxy`, `/cookie` — (Admin) đổi ảnh nền, proxy trạng thái và cookie dịch vụ mua nhanh ngay trong Discord.
- `/shop` — xem danh sách sản phẩm, giá, logo và tồn kho.
- `/connect <token>` — liên kết tài khoản web với Discord để **cộng dồn coin** (coin web + coin Discord).
- `/token` — lấy **token cố định** của tài khoản (bằng `web_users.link_token`); dùng để đăng nhập web hoặc `/connect`.
- `/asynctas` — mua nhanh **UGPhone (490 xu)** hoặc **VSPhone VIP (150 xu)** (alias cũ: `/meows`).
- `/plugin ten:lenh` — gọi lệnh do plugin đăng ký.
- `/vi`, `/daily`, `/code`, `/pay`, `/star`, `/sdone`, `/adcoin`, `/gen`, `/op`, `/unop`, `/clear`.
- `/seller` — gửi yêu cầu làm seller (`request`); admin duyệt (`trust`, chỉ định `user` hoặc `id`) và xem danh sách (`list`).
- `/exchange` — đổi `coin -> ACOIN` hoặc `ACOIN -> coin` theo tỷ giá hiện hành (mặc định **1000 coin = 1 ACOIN**). `soluong` là số coin khi đổi sang ACOIN (`floor(soluong / rate)`) hoặc số ACOIN khi đổi sang coin (`soluong * rate`).
- `/acoin` — xem số dư ACOIN và tỷ giá quy đổi.
- `/shops` — tìm kiếm shop trên marketplace (lọc theo `recommended` / `newest` / `oldest` / `cheapest` / `priciest` / `topRated` / `bestSelling`).
- `/appeal` — (Admin) chấp nhận hoặc từ chối review/khiếu nại theo `id`, kèm ghi chú.
- Sau khi tạo tài khoản, bot gửi kèm nút **📋 Copy acc|pass** (bấm để nhận lại đúng định dạng `tài khoản|mật_khẩu`).

### Web dashboard
- Đăng ký / đăng nhập tài khoản web riêng (mật khẩu hash bằng scrypt) hoặc đăng nhập bằng **token Discord**.
- Tên đăng nhập phải có **ít nhất 1 chữ cái**; tài khoản cũ chỉ toàn số bị ép đổi tên khi login.
- Số dư coin hiển thị ở góc trên; nút bấm trực quan cho mọi chức năng.
- **Shop**: mua hàng, xem đồ đã mua, copy tài khoản.
- **Giftcode**: nhập mã quà để nhận coin (mã tạo từ lệnh `/gen`).
- **Buy Device**: mua cloud (Hanami), reg tài khoản và mua nhanh (UGPhone 490 xu / VSPhone VIP 150 xu). Riêng cụm **"Đã có lỗi xảy ra khi thực hiện câu lệnh."** thì tự gọi lại sau **1 giây** khi user bấm mua cloud (web/bot/plugin); không retry khi đã thành công/hết máy/lỗi khác.
- **Cloud Status** (hiển thị cho mọi người, không cần đăng nhập): trạng thái **VMOS Cloud** và **VSPhone** đều lấy từ **API chính chủ**, **không dùng Hanami để lấy status nữa**. VMOS gọi `https://api.vmoscloud.com/vcpcloud/api/padApi/getCloudGoodList` (ký V2 `X-Sign`); VSPhone gọi `https://api.vsphone.com/vsphone/api/padApi/getCloudGoodList` (`androidVersion=13`, ký **V4 `Authorization: HMAC-SHA256 ...`** theo example Node/Go trong docs — thực tế server trả `2032 Missing required parameter: Authorization` nếu gửi V2). Key VSPhone là `VSPHONE_ACCESS_KEY` / `VSPHONE_SECRET_KEY` — **không phải** `VSPHONE_API_KEY` (chỉ dùng mua nhanh). Nếu portal VSPhone bật **Danh sách trắng IP**, phải thêm IP Render. Thiếu key VSPhone thì phần VSPhone vẫn lấy `GET https://meows.vn/api/cloud-status` như cũ. Tồn kho đọc qua `sellOutFlag` / `countryList` / `goodTimes`: còn cấu hình hoặc quốc gia sẵn → `online`; tất cả `soldOut` → `offline` / hết máy. API được fetch **mỗi 5 giây** (job nền + cache 5s); `GET /api/status/cloud` hoặc `/cloudstatus` tự fetch lại khi quá 5s, `?force=1` fetch ngay. Gist secret `asynctas-cloud-status.json` vẫn ghi **mỗi 5 phút** để fallback khi API lỗi (VMOS ở top-level, VSPhone ở field `vsphone`); `source` tương ứng `vmoscloud` / `vsphone`. Web tự làm mới mỗi **5s**. `retryable: true` = API lỗi tạm thời, đang giữ trạng thái trước (🟡); `offline` = hết máy (🔴).
- **Nạp coin**: gồm 2 tab trong cùng view — **Nạp thẻ cào** (nhập `mã thẻ | seri | nhà cung cấp`) và **Nạp ngân hàng** (tối thiểu 10.000đ/lần, lấy mã nạp + VietQR, tự kiểm tra 15s). Cả hai dùng API REST v3 (`CARD2K_API_KEY` chỉ nằm ở server) và webhook là nguồn cộng xu chính: thẻ chỉ cộng khi `status=success`, ngân hàng chỉ cộng khi `status=completed` + `paid_amount>0`; `pending`/`wrong_value`/lỗi khác để admin duyệt. Mỗi thẻ chỉ gửi 1 lần; mỗi kết nối chỉ có 1 mã nạp hiệu lực trong 30 phút. Xu cập nhật tại chỗ, không reload trang.
- **Nhiệm vụ**: lấy link vượt link theo từng provider, theo dõi lượt trong ngày & trong tuần. 3 dịch vụ dùng chung cấu hình `economy.js` (Admin Hub → Kinh tế): Link4M 409 xu, LayMa 450 xu (2 lượt/ngày), **bbmkts 259 xu (1 lượt/ngày)**. 2ktraffic đã bị ẩn. Token bbmkts lấy từ `BBMKTS_API_TOKEN` (alias `VUOTNHANH_API_TOKEN`). Web và bot cùng đọc một cấu hình nên reward luôn đồng nhất.
- **Điểm danh mỗi ngày**: nút claim nhận random **10–100 xu** (cùng bucket với `/daily` Discord và plugin). Nếu đã vượt **≥ 1 link** thì mỗi ngày lấy được **1 trong 2**: tài khoản VMOS free hoặc VSPhone thường free — không trừ xu.
- **Xếp hạng**: coin · vượt link **7 ngày** (có thưởng, reset sau mỗi kỳ) · vượt link **tổng** (không thưởng). Tên hiển thị là username, không phải ID số.
- **Chuyển tiền**: chuyển coin cho người khác (phí 5%).
- **Hồ sơ**: đổi mật khẩu, xem/copy token liên kết Discord.
- **Hub Admin** (chỉ mở được từ mục "Quản trị" trong avatar, tài khoản đã liên kết Discord admin), 8 tab kiểu Seller, mỗi tab chỉ tải dữ liệu của tab đó:
  - **User**: danh sách người dùng, đơn hàng, lịch sử trả thưởng.
  - **Shop**: tạo sản phẩm, upload kho lên GitHub Gist, đặt giá (nhập `$` để dùng ACOIN), thêm kho, sửa/xoá.
  - **Plugin**: dán link raw script → tự lưu Gist → lưu gist_id vào DB → load chạy ngay (không deploy lại). Plugin viết bằng **JavaScript/CommonJS**, có API nội bộ bot/web, event bus và gọi API chéo plugin. Xem [docs/PLUGINS.md](docs/PLUGINS.md).
  - **Cookie**: nhập/lưu cookie dùng cho 2 dịch vụ mua nhanh; tự chuẩn hoá `.COOKIESECURITY=<cookie>`, đổi không cần deploy.
  - **Kinh tế**: sửa thưởng vượt link, giá tạo tài khoản, bảng xu nạp thẻ và tỷ giá ACOIN (lưu vào KV `economy_config`); kho test Hanami; đơn thẻ chờ duyệt; nút **migration x10** cho tài khoản cũ (bấm thủ công, chỉ chạy 1 lần, không tự chạy lúc deploy). Kho test Hanami chỉ còn dùng cho luồng **mua** cloud, không dùng cho Cloud Status.
  - Các tab còn lại: Market, Seller, Thưởng tuần, Gmail. Mỗi tài khoản Google/Gmail hợp lệ được duyệt cộng **1800 coin** (mức thưởng lấy từ `gmail-tasks.js`, áp dụng cả task pending cũ). Thưởng tuần lưu KV `weekly_rewards`, có hiệu lực kỳ sau.

### Thưởng bảng xếp hạng vượt link (tự động mỗi Chủ nhật)
| Hạng | Thưởng |
|------|--------|
| Top 1 | 300 coin |
| Top 2 | 150 coin |
| Top 3 | 75 coin |
| Top 4-10 | 40 coin |

Sau khi trả thưởng, bộ đếm vượt link bắt đầu kỳ mới. Có thể chạy thủ công trong trang Quản trị.

## Marketplace, ACOIN và Seller

- **ACOIN** là đơn vị thanh toán của marketplace. Tỷ giá mặc định do KV `exchange_coin_per_acoin` quyết định: **1000 coin = 1 ACOIN**. Admin đổi trong Admin Hub → Kinh tế. Dùng `/exchange` để đổi hai chiều; số dư không bao giờ xuống dưới 0 và mỗi lần đổi đều ghi event `bot:exchange`.
- Khi tạo sản phẩm trong Shop, nhập giá dạng `$100` để dùng ACOIN (thay vì coin). Lệnh `/acoin` hiển thị số dư kèm tỷ giá hiện tại.
- Seller gửi yêu cầu bằng `/seller request`, admin duyệt bằng `/seller trust`. Có thể trust trực tiếp user chưa từng gửi yêu cầu; hệ thống sẽ tạo luôn seller ở trạng thái `active`.
- Duyệt maintenance tự động lúc bot sẵn sàng và sau mỗi 24 giờ: seller **không hoạt động 30 ngày bị giáng quyền**, **180 ngày bị xoá**.
- `/shops` hiển thị tối đa 10 shop (tên, tỷ lệ đánh giá, số lượt bán). `/appeal` cho phép admin override quyết định review/khiếu nại.

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
Chạy `supabase_setup.sql` **hoặc** `supabase_new_tables.sql` trong **SQL Editor**: cả hai là cùng một file full schema, tạo đầy đủ mọi bảng (kể cả bảng cũ của bot, bảng nạp thẻ `card2k_orders`, nạp ngân hàng `card2k_deposits` và Gmail). Dùng `create table if not exists` / `add column if not exists` / `create index if not exists` nên chạy lại nhiều lần không lỗi, không xoá dữ liệu cũ; cuối file có `notify pgrst, 'reload schema';` để API thấy ngay bảng/cột mới. Nếu DB đã có bảng từ bản trước, file tự bổ sung cột còn thiếu rồi bật RLS.

### GitHub Gist (kho shop)
Tạo token GitHub có quyền `gist` và điền `GITHUB_TOKEN`. Khi admin tạo sản phẩm:
1. Server tạo 1 **secret gist** chứa danh sách tài khoản (mỗi dòng 1 tài khoản).
2. Khi có người mua N tài khoản, server lấy N dòng đầu và **ghi lại gist** với phần còn lại
   (tự động xoá tài khoản đã bán), đồng thời cập nhật tồn kho.

Nếu chưa có `GITHUB_TOKEN`, kho được lưu tạm trong DB (chế độ local) để test.

### Plugin (thêm logic/API không cần deploy)
Vào **Quản trị → Plugin**, nhập tên và link raw script (http/https). Server sẽ tải script (tối đa 200KB), lưu vào secret gist, rồi load trong sandbox `vm` và mount route `/plugin/<plugin-id>/...`. Reload luôn đọc từ gist.

**Ngôn ngữ plugin: JavaScript / CommonJS** — không cần build, không dependency.

Script mẫu:
```js
module.exports = function (api) {
  api.get('/hello', (req, res) => res.json({ ok: true }));
  api.command('ping', async ({ interaction }) => {
    await interaction.editReply('pong'); // /plugin <ten>:ping (đã deferReply)
  });
  api.events.on('web:daily:claim', ({ userKey, reward }) => api.log(userKey, reward));
  api.plugins.expose('greet', ({ name }) => `Xin chào ${name}!`);
};
```

Có sẵn nhiều namespace: `core`, `plugin`, routes/commands, `events`, `plugins` (expose/call), `bot`, `web`, `coins`, `users`, `shop`, `services`, `link`, `gift`, `daily`, `format`, `http`, `kv`, `onUnload`.

📖 **Tài liệu đầy đủ (API + toàn bộ event `web:*` / `bot:*` + bảo mật):** [docs/PLUGINS.md](docs/PLUGINS.md).

Chỉ admin mới được cài/sửa plugin; sandbox chỉ để hạn chế, không phải hàng rào bảo mật tuyệt đối — hãy dùng nguồn script tin cậy.

### Liên kết admin
1. Đăng nhập web, vào **Hồ sơ**, copy token.
2. Trong Discord (tài khoản admin) gõ `/connect <token>`.
3. Mục **Quản trị** sẽ hiện trên dashboard.

Admin được xác định bởi `ADMIN_DISCORD_ID` (owner) hoặc bảng `admins` (cấp qua `/op`).

### Cookie dịch vụ nhanh
Vào **Quản trị → Cookie**, dán cookie lấy từ trang cung cấp dịch vụ (có thể dán cả chuỗi `.COOKIESECURITY=...` hoặc cả header `Cookie: ...`).
Server tự lưu vào bảng `kv` (key `meows_cookie`) dạng `.COOKIESECURITY=<cookie>`; **không cần tạo bảng mới**.
Cookie hết hạn chỉ cần cập nhật ở đây, không deploy lại. Dùng cho `/asynctas` và mục **Buy Device → Mua nhanh**.

### Proxy API (Render / WARP / Worker) — dùng chung
IP Render bị nhà cung cấp/Cloudflare chặn (`403 - Just a moment...`), nhưng **IP Cloudflare (WARP / Worker)** thì dùng được. Proxy này áp dụng cho:

- **Cloud Status**
- **Mua nhanh** ASYNCTAS (UGPhone 490 xu / VSPhone VIP 150 xu)
- **Mua UGPhone** qua Hanami (`Buy Device` / lệnh `reg`)

**Render không cài được `warp-cli`** (cần `NET_ADMIN` + `/dev/net/tun`), nhưng **chạy được WARP userspace bằng `wireproxy` ngay trong Render** — xem mục **C** bên dưới (không cần VPS). Cloudflare Worker vẫn là phương án dự phòng.

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

**C. Chạy WARP thẳng trong Render (không VPS, không TUN)**

Script: [`scripts/render-start.sh`](./scripts/render-start.sh). Nó tự tải `wireproxy`, dựng cấu hình từ profile, mở SOCKS5 `127.0.0.1:1080`, rồi mới chạy bot.

1. Tạo profile **1 lần ở máy bạn**: `wgcf register --accept-tos && wgcf generate` → ra `wgcf-profile.conf`.
2. Encode: `base64 -w0 wgcf-profile.conf` → dán làm secret Render `WGCF_PROFILE_B64`.
3. Render → Service → Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `bash scripts/render-start.sh`
   - Env: `RENDER_WARP=1`, `WGCF_PROFILE_B64=<chuỗi base64>`

Script sẽ **health check qua chính SOCKS5** trước khi bật proxy:

- Tunnel OK → tự set `MEOWS_API_PROXY=socks5h://127.0.0.1:1080`, chain Meows (mua nhanh + fallback VSPhone khi chưa có key chính chủ) hiện `· warp`; VMOS/VSPhone Cloud Status đi thẳng API chính chủ.
- Không handshake được (Render chặn UDP ra cổng WireGuard) → tự bỏ proxy, bot chạy bình thường với chain cũ (Worker → direct → reader). **App không bao giờ treo vì WARP.**

Muốn tự đăng ký WARP ngay trên Render (không cần secret) thì thêm `WGCF_AUTO_REGISTER=1` — nhưng mỗi deploy sẽ ra identity mới, không khuyến khích.

**Cách ly**: `wireproxy` là userspace, **không sửa routing table**. Nên chỉ request nào dùng `SocksProxyAgent` mới đi WARP — ở đây là luồng mua nhanh + fallback Meows. Discord gateway, Supabase, web UI, gift code... vẫn đi IP Render bình thường. VMOS/VSPhone Cloud Status gọi `https://api.vmoscloud.com` / `https://api.vsphone.com` trực tiếp, không qua WARP. Hanami mặc định **không** đi WARP; bật nếu cần: `HANAMI_USE_PROXY=1`.

Ưu tiên env: `MEOWS_API_PROXY` → `MEOWS_STATUS_PROXY` → ô trong DB → gọi trực tiếp.

**Mua máy dùng chung chain với status**: `worker`/`warp` → `direct` (**không dùng `www`**, vì API mua chỉ có trên domain chính và `www` dễ trả 404). Chỉ retry khi bị Cloudflare chặn (403/Just a moment), Worker trả 404 (bản cũ/sai route) hoặc lỗi mạng; **không retry sau khi API đã trả response hợp lệ** để tránh mua trùng/trừ coin trùng. Reader proxy chỉ dùng cho GET (status), không dùng cho POST mua hàng. Thông báo lỗi sẽ kèm `[nguồn: ...]` và danh sách các nguồn đã thử.

Ô thời gian chung của Cloud Status hiện `worker` / `warp` / `www` / `proxy` tương ứng nguồn Meows đang dùng (chỉ còn ý nghĩa với mua nhanh/fallback); phần VMOS/VSPhone có đồng hồ `checkedAt` và nguồn API riêng trong dữ liệu trạng thái.

## Biến môi trường
Xem `.env.example`. Các biến quan trọng: `DISCORD_TOKEN`, `ADMIN_DISCORD_ID`,
`SUPABASE_URL`, `SUPABASE_KEY`, `RENDER_DOMAIN`, `GITHUB_TOKEN`, `HANAMI_TOKEN`, `LINK4M_API_KEY`, `LAYMA_TOKEN`, `BBMKTS_API_TOKEN` (hoặc alias `VUOTNHANH_API_TOKEN`), `MEOWS_API_PROXY` / `MEOWS_STATUS_PROXY` (tuỳ chọn, Worker hoặc SOCKS5/WARP, chỉ ảnh hưởng VSPhone/mua nhanh), `MEOWS_PROXY_KEY` (tuỳ chọn, secret của Worker), `VMOS_ACCESS_KEY` / `VMOS_SECRET_KEY` (bắt buộc để Cloud Status đọc API chính chủ VMOS Cloud), `VSPHONE_ACCESS_KEY` / `VSPHONE_SECRET_KEY` (để Cloud Status đọc API chính chủ VSPhone; thiếu thì fallback Meows).

## Bảo mật
- Token GitHub/Hanami chỉ nằm ở server, không bao giờ gửi xuống trình duyệt.
- Mật khẩu web hash bằng `scrypt`; session lưu dạng hash SHA-256 trong DB, cookie `HttpOnly`.
- Mọi thao tác coin/shop/admin đều kiểm tra quyền phía server.
- **Không commit file `.env`** (đã có trong `.gitignore`). Nếu token từng bị lộ, hãy thu hồi và tạo token mới.

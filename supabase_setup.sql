-- ============================================================
-- ASYNCTAS — schema Supabase
-- Chạy toàn bộ file này trong Supabase -> SQL Editor (một lần).
-- Bot & web dùng service_role key nên RLS bật mà không cần policy.
-- ============================================================

-- ---------- Bảng cũ của bot ----------
create table if not exists user_coins (
  user_id text primary key,
  balance bigint not null default 0
);

create table if not exists sessions (
  id text primary key,
  user_id text not null,
  provider text,
  created_at timestamptz default now()
);

create table if not exists gift_codes (
  code text primary key,
  amount bigint not null default 0,
  is_used boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists daily_limits (
  user_id text not null,
  provider text not null,
  date_str text not null,
  count integer not null default 0,
  primary key (user_id, provider, date_str)
);

create table if not exists admins (
  user_id text primary key,
  added_by text,
  created_at timestamptz default now()
);

create table if not exists kv (
  key text primary key,
  value text
);

-- ---------- Tài khoản web ----------
create table if not exists web_users (
  id text primary key,
  username text not null,
  username_lower text not null unique,
  password_hash text not null,
  link_token text not null unique,
  discord_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists web_sessions (
  id text primary key,
  user_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists web_sessions_user_idx on web_sessions (user_id);

-- ---------- BXH vượt link ----------
create table if not exists link_stats (
  user_id text not null,
  period text not null,
  count integer not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, period)
);
create index if not exists link_stats_period_idx on link_stats (period, count desc);

-- ---------- Shop ----------
create table if not exists shop_items (
  id text primary key,
  name text not null,
  description text default '',
  price bigint not null default 0,
  logo_url text default '',
  category text not null default 'shop',
  gist_id text,
  gist_filename text,
  stock integer not null default 0,
  stock_content text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists purchases (
  id text primary key,
  web_user_id text not null,
  item_id text not null,
  item_name text,
  quantity integer not null default 1,
  unit_price bigint not null default 0,
  total_price bigint not null default 0,
  accounts text,
  created_at timestamptz default now()
);
create index if not exists purchases_user_idx on purchases (web_user_id, created_at desc);

-- ---------- Chuyển coin ----------
create table if not exists transfers (
  id text primary key,
  from_user_id text not null,
  from_label text,
  to_label text,
  to_balance_key text,
  amount bigint not null default 0,
  fee bigint not null default 0,
  created_at timestamptz default now()
);
create index if not exists transfers_from_idx on transfers (from_user_id, created_at desc);

-- ---------- Lịch sử trả thưởng tuần ----------
create table if not exists payouts (
  id text primary key,
  period text not null,
  total bigint not null default 0,
  details text,
  created_at timestamptz default now()
);

-- ---------- Plugin (script lưu trên Gist) ----------
create table if not exists plugins (
  id text primary key,
  name text not null,
  source_url text not null default '',
  gist_id text,
  gist_filename text,
  enabled boolean not null default true,
  last_loaded_at timestamptz,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- Marketplace / seller / ACOIN / chat ----------
create table if not exists sellers (
  user_id text primary key,
  status text not null default 'pending', -- pending | active | suspended
  note text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists shops (
  id text primary key,
  owner_id text not null,
  name text not null,
  description text default '',
  logo_url text default '',
  background_url text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists shops_owner_idx on shops (owner_id);

-- shop_items được mở rộng thành sản phẩm của user-shop (xem alter bên dưới).

create table if not exists orders (
  id text primary key,
  buyer_id text not null,
  seller_id text not null,
  shop_id text not null,
  shop_name text default '',
  product_id text not null,
  item_name text default '',
  quantity integer not null default 1,
  total bigint not null default 0,
  currency text not null default 'coin', -- coin | acoin
  status text not null default 'pending', -- pending | completed | returned | complained
  viewed boolean not null default false,
  payout_state text not null default 'pending', -- pending | released | lost | returned
  seller_amount bigint not null default 0,
  hold_until timestamptz,
  accounts text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists orders_buyer_idx on orders (buyer_id, created_at desc);
create index if not exists orders_seller_idx on orders (seller_id, created_at desc);
create index if not exists orders_shop_idx on orders (shop_id);

create table if not exists reviews (
  id text primary key,
  shop_id text not null,
  product_id text not null,
  order_id text not null,
  buyer_id text not null,
  stars integer not null default 5,
  content text not null default '',
  status text not null default 'visible', -- visible | hidden | appealed
  admin_reply text,
  appealed boolean not null default false,
  appeal_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists reviews_shop_idx on reviews (shop_id, created_at desc);

create table if not exists complaints (
  id text primary key,
  order_id text not null,
  shop_id text not null,
  seller_id text not null,
  buyer_id text not null,
  reason text not null default '',
  status text not null default 'pending', -- pending | appealed | approved | rejected
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists complaints_order_idx on complaints (order_id);
create index if not exists complaints_seller_idx on complaints (seller_id);

create table if not exists acoin_balances (
  user_id text primary key,
  balance bigint not null default 0,
  updated_at timestamptz default now()
);

create table if not exists device_accounts (
  device_id text primary key,
  user_id text not null,
  created_at timestamptz default now()
);
create index if not exists device_accounts_user_idx on device_accounts (user_id);

-- ---------- Đổi thẻ Card2K (REST v3, webhook là nguồn cộng xu chính) ----------
create table if not exists card2k_orders (
  id text primary key,
  request_id text not null unique,
  user_id text,
  user_key text,
  username text default '',
  telco text not null,
  code text not null,
  serial text not null,
  amount bigint not null,
  status text not null default 'pending',
  message text default '',
  coins bigint not null default 0,
  declared_value bigint not null default 0,
  value bigint,
  received_amount bigint not null default 0,
  provider_status text default '',
  provider_code text default '',
  provider_card_id text default '',
  note text default '',
  credited_by text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint card2k_orders_card_unique unique (telco, code, serial)
);
create index if not exists card2k_orders_user_idx on card2k_orders (user_key);
create index if not exists card2k_orders_status_idx on card2k_orders (status);

-- ---------- Nếu bảng shop_items đã tồn tại từ trước, bổ sung cột còn thiếu ----------
alter table shop_items add column if not exists stock_content text;
alter table shop_items add column if not exists gist_filename text;
alter table shop_items add column if not exists gist_id text;
alter table shop_items add column if not exists active boolean not null default true;
alter table shop_items add column if not exists shop_id text;
alter table shop_items add column if not exists currency text not null default 'coin';
alter table shop_items add column if not exists price_value bigint not null default 0;
alter table shop_items add column if not exists max_lines integer not null default 2000;
alter table shop_items add column if not exists line_count integer not null default 0;
-- Cho phép seller cũ/set-admin giữ item không thuộc shop nào (shop_id null).
create index if not exists shop_items_shop_idx on shop_items (shop_id);

-- ---------- Bật RLS (chỉ service_role truy cập) ----------
alter table user_coins enable row level security;
alter table sessions enable row level security;
alter table gift_codes enable row level security;
alter table daily_limits enable row level security;
alter table admins enable row level security;
alter table kv enable row level security;
alter table web_users enable row level security;
alter table web_sessions enable row level security;
alter table link_stats enable row level security;
alter table shop_items enable row level security;
alter table purchases enable row level security;
alter table transfers enable row level security;
alter table payouts enable row level security;
alter table plugins enable row level security;
alter table sellers enable row level security;
alter table shops enable row level security;
alter table orders enable row level security;
alter table reviews enable row level security;
alter table complaints enable row level security;
alter table acoin_balances enable row level security;
alter table device_accounts enable row level security;
alter table card2k_orders enable row level security;

-- ---------- Nhiệm vụ Gmail (duyệt thủ công, ghim + tìm kiếm) ----------
create table if not exists gmail_tasks (
  id text primary key,
  user_id text not null,
  user_key text not null,
  username text default '',
  email text not null,
  password text not null,
  reward bigint not null default 180,
  status text not null default 'pending',
  pinned boolean not null default false,
  reject_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  notified boolean not null default false,
  coin_after bigint,
  created_at timestamptz default now()
);
create unique index if not exists gmail_tasks_email_key on gmail_tasks (email);
create index if not exists gmail_tasks_status_idx on gmail_tasks (status, pinned desc, created_at desc);
create index if not exists gmail_tasks_user_idx on gmail_tasks (user_key);
alter table gmail_tasks enable row level security;

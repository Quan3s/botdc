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

-- ---------- Nếu bảng shop_items đã tồn tại từ trước, bổ sung cột còn thiếu ----------
alter table shop_items add column if not exists stock_content text;
alter table shop_items add column if not exists gist_filename text;
alter table shop_items add column if not exists gist_id text;
alter table shop_items add column if not exists active boolean not null default true;

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

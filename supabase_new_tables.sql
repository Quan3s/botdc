-- ============================================================
-- ASYNCTAS — các BẢNG MỚI (CREATE TABLE)
-- Chạy file này trong Supabase → SQL Editor → New query → Run.
-- Dùng service_role key nên không cần policy RLS cho các bảng này.
-- File đầy đủ (kèm index/alter/RLS): supabase_setup.sql
-- ============================================================

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

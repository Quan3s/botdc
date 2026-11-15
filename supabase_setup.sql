-- Chạy trong Supabase -> SQL Editor (một lần)
create table if not exists admins (
  user_id text primary key,
  added_by text,
  created_at timestamptz default now()
);

create table if not exists kv (
  key text primary key,
  value text
);

-- Bật RLS và KHÔNG tạo policy: chỉ secret/service_role key của bot truy cập được
alter table admins enable row level security;
alter table kv enable row level security;

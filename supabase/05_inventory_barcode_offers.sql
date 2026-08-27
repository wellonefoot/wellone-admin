-- WellOne Admin v73: barcode, quantity inventory, variant stock and promotional items
-- Run once in Supabase Dashboard -> SQL Editor before deploying this admin version.

alter table public.products
  add column if not exists barcode text,
  add column if not exists barcode_enabled boolean not null default false,
  add column if not exists track_inventory boolean not null default false,
  add column if not exists stock_quantity integer not null default 0;

alter table public.product_variants
  add column if not exists stock integer not null default 0,
  add column if not exists stock_status text not null default 'in_stock';

create unique index if not exists products_barcode_unique
  on public.products (barcode)
  where barcode is not null and btrim(barcode) <> '';

create index if not exists products_barcode_lookup
  on public.products (barcode_enabled, barcode);

create table if not exists public.offer_items (
  id uuid primary key default gen_random_uuid(),
  title text,
  item_link text not null,
  offer_price numeric(12,2) not null check (offer_price >= 0),
  discount_percentage numeric(5,2) check (discount_percentage is null or (discount_percentage >= 0 and discount_percentage <= 100)),
  valid_until timestamptz,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists offer_items_active_sort
  on public.offer_items (is_active, sort_order, created_at desc);

-- PostgREST/API table privileges. RLS below still controls which rows each role can access.
grant select on table public.offer_items to anon;
grant select, insert, update, delete on table public.offer_items to authenticated;

alter table public.offer_items enable row level security;

drop policy if exists "Public can view active offer items" on public.offer_items;
create policy "Public can view active offer items"
  on public.offer_items for select
  using (is_active = true);

drop policy if exists "Admins can manage offer items" on public.offer_items;
create policy "Admins can manage offer items"
  on public.offer_items for all
  to authenticated
  using (exists (select 1 from public.admin_users where admin_users.id = auth.uid()))
  with check (exists (select 1 from public.admin_users where admin_users.id = auth.uid()));

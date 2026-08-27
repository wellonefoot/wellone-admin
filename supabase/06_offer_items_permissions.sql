-- WellOne v74 hotfix: offer_items API permissions
-- Run this once in Supabase Dashboard -> SQL Editor if the admin shows:
-- "permission denied for table offer_items"

-- Table-level privileges required by Supabase/PostgREST.
-- Row Level Security policies continue to decide which rows can be read/written.
grant select on table public.offer_items to anon;
grant select, insert, update, delete on table public.offer_items to authenticated;

alter table public.offer_items enable row level security;

-- Storefront: only active, non-expired offers are readable.
drop policy if exists "Public can view active offer items" on public.offer_items;
create policy "Public can view active offer items"
  on public.offer_items
  for select
  to anon, authenticated
  using (is_active = true and (valid_until is null or valid_until > now()));

-- Admin app: authenticated users that exist in public.admin_users can manage all offers.
drop policy if exists "Admins can manage offer items" on public.offer_items;
create policy "Admins can manage offer items"
  on public.offer_items
  for all
  to authenticated
  using (exists (
    select 1
    from public.admin_users
    where admin_users.id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.admin_users
    where admin_users.id = auth.uid()
  ));

-- WellOne v75: keep expired active offers visible to customers
-- Run once after 05/06 if your current database hides expired offer rows.
-- This does NOT allow customers to edit offers. It only lets the storefront
-- read active offer rows so the UI can show "Offer expired" and fall back
-- to the product's current regular price.

grant select on table public.offer_items to anon;
grant select on table public.offer_items to authenticated;

alter table public.offer_items enable row level security;

drop policy if exists "Public can view active offer items" on public.offer_items;
create policy "Public can view active offer items"
  on public.offer_items
  for select
  to anon, authenticated
  using (is_active = true);

-- Admin management policy remains unchanged.

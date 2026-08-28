-- WellOne v79: orders, employee stock desk and true colour + size variant inventory
-- Run this once in Supabase Dashboard -> SQL Editor before deploying v79.

create extension if not exists pgcrypto with schema extensions;

-- True independent variant dimensions. Existing unit/label columns are kept for backward compatibility.
alter table public.product_variants
  add column if not exists color text,
  add column if not exists size text;

update public.product_variants
set color = nullif(btrim(unit), '')
where color is null and nullif(btrim(unit), '') is not null;

update public.product_variants
set size = nullif(btrim(label), '')
where size is null and nullif(btrim(label), '') is not null;

create index if not exists product_variants_product_color_size_idx
  on public.product_variants (product_id, lower(coalesce(color,'')), lower(coalesce(size,'')));

-- Customer orders ------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_address text not null,
  payment_method text not null default 'cod' check (payment_method in ('cod','online')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  status text not null default 'confirmed' check (status in ('confirmed','packed','out_for_delivery','delivered','cancelled')),
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  tracking_hash text not null,
  cancellation_reason text,
  cancelled_at timestamptz,
  stock_restored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  color text,
  size text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  image_url text,
  stock_reserved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id);

create table if not exists public.order_status_history (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  note text,
  actor_type text not null default 'system',
  actor_label text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history(order_id, created_at);

-- Employees -----------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists employees_username_unique on public.employees(lower(username));

create table if not exists public.employee_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists employee_sessions_employee_idx on public.employee_sessions(employee_id, expires_at desc);

create table if not exists public.stock_movements (
  id bigserial primary key,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  quantity_delta integer not null,
  reason text not null,
  reference_id uuid,
  actor_type text not null,
  actor_label text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);


-- Keep historical orders/movements even when a product or its variants are edited/deleted.
alter table public.order_items alter column product_id drop not null;
alter table public.order_items drop constraint if exists order_items_product_id_fkey;
alter table public.order_items drop constraint if exists order_items_variant_id_fkey;
alter table public.order_items add constraint order_items_product_id_fkey foreign key (product_id) references public.products(id) on delete set null;
alter table public.order_items add constraint order_items_variant_id_fkey foreign key (variant_id) references public.product_variants(id) on delete set null;
alter table public.stock_movements alter column product_id drop not null;
alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table public.stock_movements drop constraint if exists stock_movements_variant_id_fkey;
alter table public.stock_movements add constraint stock_movements_product_id_fkey foreign key (product_id) references public.products(id) on delete set null;
alter table public.stock_movements add constraint stock_movements_variant_id_fkey foreign key (variant_id) references public.product_variants(id) on delete set null;

-- Direct access is intentionally restricted. Public/customer and employee writes use RPCs.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.employees enable row level security;
alter table public.employee_sessions enable row level security;
alter table public.stock_movements enable row level security;

revoke all on table public.orders, public.order_items, public.order_status_history, public.employees, public.employee_sessions, public.stock_movements from anon;
revoke all on table public.employees, public.employee_sessions from authenticated;
grant select, update on table public.orders to authenticated;
grant select on table public.order_items, public.order_status_history, public.stock_movements to authenticated;

-- Admin RLS policies.
drop policy if exists "Admins can read orders" on public.orders;
create policy "Admins can read orders" on public.orders for select to authenticated
using (exists (select 1 from public.admin_users a where a.id = auth.uid()));
drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders" on public.orders for update to authenticated
using (exists (select 1 from public.admin_users a where a.id = auth.uid()))
with check (exists (select 1 from public.admin_users a where a.id = auth.uid()));
drop policy if exists "Admins can read order items" on public.order_items;
create policy "Admins can read order items" on public.order_items for select to authenticated
using (exists (select 1 from public.admin_users a where a.id = auth.uid()));
drop policy if exists "Admins can read order history" on public.order_status_history;
create policy "Admins can read order history" on public.order_status_history for select to authenticated
using (exists (select 1 from public.admin_users a where a.id = auth.uid()));
drop policy if exists "Admins can read stock movements" on public.stock_movements;
create policy "Admins can read stock movements" on public.stock_movements for select to authenticated
using (exists (select 1 from public.admin_users a where a.id = auth.uid()));

-- Helper: recalculate the product-level stock summary from independent variants.
create or replace function public.wellone_recalc_product_stock(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_has_variants boolean;
  v_total integer;
begin
  select exists(select 1 from public.product_variants where product_id = p_product_id),
         coalesce(sum(greatest(stock,0)),0)
  into v_has_variants, v_total
  from public.product_variants
  where product_id = p_product_id;

  if v_has_variants then
    update public.products
       set stock_quantity = v_total,
           stock_status = case when v_total > 0 then 'in_stock' else 'out_of_stock' end,
           updated_at = now()
     where id = p_product_id and track_inventory = true;
  end if;
end;
$$;
revoke all on function public.wellone_recalc_product_stock(uuid) from public;

-- Customer order creation. Prices and stock are always re-read from the database.
create or replace function public.create_customer_order(
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_order_number text := 'WEL-' || to_char(clock_timestamp(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
  v_token text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  v_item jsonb;
  v_product public.products%rowtype;
  v_variant_id uuid;
  v_variant_stock integer;
  v_variant_stock_status text;
  v_variant_price numeric(12,2);
  v_variant_mrp numeric(12,2);
  v_variant_image text;
  v_variant_color text;
  v_variant_size text;
  v_qty integer;
  v_price numeric(12,2);
  v_total numeric(12,2) := 0;
  v_color text;
  v_size text;
  v_image text;
  v_offer_price numeric(12,2);
  v_has_variants boolean;
begin
  if nullif(btrim(p_customer_name),'') is null or nullif(btrim(p_customer_phone),'') is null or nullif(btrim(p_customer_address),'') is null then
    raise exception 'Name, phone and address are required.';
  end if;
  if p_payment_method not in ('cod','online') then p_payment_method := 'cod'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  insert into public.orders(id,order_number,customer_name,customer_phone,customer_address,payment_method,payment_status,status,tracking_hash)
  values(v_order_id,v_order_number,btrim(p_customer_name),btrim(p_customer_phone),btrim(p_customer_address),p_payment_method,'pending','confirmed',encode(digest(v_token,'sha256'),'hex'));

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item->>'quantity')::integer, 1));
    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    v_color := nullif(btrim(coalesce(v_item->>'color','')), '');
    v_size := nullif(btrim(coalesce(v_item->>'size','')), '');

    select * into v_product from public.products where id = (v_item->>'product_id')::uuid for update;
    if not found or coalesce(v_product.status,'active') <> 'active' then raise exception 'One selected product is no longer available.'; end if;

    select exists(select 1 from public.product_variants where product_id = v_product.id) into v_has_variants;
    v_variant_stock := null; v_variant_stock_status := null; v_variant_price := null; v_variant_mrp := null;
    v_variant_image := null; v_variant_color := null; v_variant_size := null;

    if v_variant_id is not null then
      select v.stock,v.stock_status,v.price,v.mrp,v.image_url,
             coalesce(nullif(v.color,''),nullif(v.unit,'')),coalesce(nullif(v.size,''),nullif(v.label,''))
        into v_variant_stock,v_variant_stock_status,v_variant_price,v_variant_mrp,v_variant_image,v_variant_color,v_variant_size
        from public.product_variants v where v.id = v_variant_id and v.product_id = v_product.id for update;
      if not found then v_variant_id := null; end if;
    end if;
    if v_variant_id is null and v_has_variants and (v_color is not null or v_size is not null) then
      select v.id,v.stock,v.stock_status,v.price,v.mrp,v.image_url,
             coalesce(nullif(v.color,''),nullif(v.unit,'')),coalesce(nullif(v.size,''),nullif(v.label,''))
        into v_variant_id,v_variant_stock,v_variant_stock_status,v_variant_price,v_variant_mrp,v_variant_image,v_variant_color,v_variant_size
        from public.product_variants v
       where v.product_id = v_product.id
         and (v_color is null or lower(coalesce(v.color,v.unit,'')) = lower(v_color))
         and (v_size is null or lower(coalesce(v.size,v.label,'')) = lower(v_size))
       order by v.sort_order nulls last, v.id
       limit 1
       for update;
      if not found then raise exception '% selected colour/size is no longer available.', v_product.name; end if;
    elsif v_has_variants then
      if (select count(*) from public.product_variants where product_id=v_product.id) = 1 then
        select v.id,v.stock,v.stock_status,v.price,v.mrp,v.image_url,
               coalesce(nullif(v.color,''),nullif(v.unit,'')),coalesce(nullif(v.size,''),nullif(v.label,''))
          into v_variant_id,v_variant_stock,v_variant_stock_status,v_variant_price,v_variant_mrp,v_variant_image,v_variant_color,v_variant_size
          from public.product_variants v where v.product_id=v_product.id limit 1 for update;
      else
        raise exception 'Select the exact colour/size for %.', v_product.name;
      end if;
    end if;

    if v_product.track_inventory then
      if v_variant_id is not null then
        if coalesce(v_variant_stock_status,'in_stock') = 'out_of_stock' or coalesce(v_variant_stock,0) < v_qty then
          raise exception 'Only % unit(s) of % % % are available.', greatest(coalesce(v_variant_stock,0),0), v_product.name, coalesce(v_color,v_variant_color,''), coalesce(v_size,v_variant_size,'');
        end if;
        update public.product_variants
           set stock = stock - v_qty,
               stock_status = case when stock - v_qty > 0 then 'in_stock' else 'out_of_stock' end
         where id = v_variant_id;
      else
        if coalesce(v_product.stock_status,'in_stock') = 'out_of_stock' or coalesce(v_product.stock_quantity,0) < v_qty then
          raise exception 'Only % unit(s) of % are available.', greatest(coalesce(v_product.stock_quantity,0),0), v_product.name;
        end if;
        update public.products
           set stock_quantity = stock_quantity - v_qty,
               stock_status = case when stock_quantity - v_qty > 0 then 'in_stock' else 'out_of_stock' end,
               updated_at = now()
         where id = v_product.id;
      end if;
    end if;

    v_offer_price := null;
    if nullif(v_item->>'offer_id','') is not null then
      select oi.offer_price into v_offer_price
      from public.offer_items oi
      where oi.id=(v_item->>'offer_id')::uuid
        and oi.is_active=true
        and (oi.valid_until is null or oi.valid_until>now())
        and coalesce(oi.item_link,'') ~ ('(^|[?&])id=' || v_product.id::text || '(&|$)')
      limit 1;
    end if;
    v_price := coalesce(v_offer_price, nullif(v_variant_price,0), nullif(v_product.price,0), nullif(v_variant_mrp,0), nullif(v_product.mrp,0), 0);
    v_image := coalesce(nullif(v_variant_image,''), nullif(v_product.main_image_url,''));
    if v_variant_id is not null then
      v_color := coalesce(v_color, v_variant_color);
      v_size := coalesce(v_size, v_variant_size);
    end if;

    insert into public.order_items(order_id,product_id,variant_id,product_name,color,size,quantity,unit_price,line_total,image_url,stock_reserved)
    values(v_order_id,v_product.id,v_variant_id,v_product.name,v_color,v_size,v_qty,v_price,v_price*v_qty,v_image,v_product.track_inventory);

    v_total := v_total + (v_price * v_qty);
    insert into public.stock_movements(product_id,variant_id,quantity_delta,reason,reference_id,actor_type,actor_label)
    values(v_product.id,v_variant_id,-v_qty,'customer_order',v_order_id,'customer',btrim(p_customer_name));

    if v_product.track_inventory and v_variant_id is not null then perform public.wellone_recalc_product_stock(v_product.id); end if;
  end loop;

  update public.orders set subtotal=v_total,total=v_total,updated_at=now() where id=v_order_id;
  insert into public.order_status_history(order_id,status,note,actor_type,actor_label)
  values(v_order_id,'confirmed','Order confirmed','customer',btrim(p_customer_name));

  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'tracking_token',v_token,'status','confirmed','total',v_total,'payment_method',p_payment_method);
exception when others then
  raise;
end;
$$;
revoke all on function public.create_customer_order(text,text,text,text,jsonb) from public;
grant execute on function public.create_customer_order(text,text,text,text,jsonb) to anon, authenticated;

-- Read one customer order using its private local tracking token.
create or replace function public.get_customer_order(p_order_id uuid, p_tracking_token text)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
select case when o.id is null then null else jsonb_build_object(
  'id',o.id,'order_number',o.order_number,'customer_name',o.customer_name,'customer_phone',o.customer_phone,'customer_address',o.customer_address,
  'payment_method',o.payment_method,'payment_status',o.payment_status,'status',o.status,'subtotal',o.subtotal,'total',o.total,
  'cancellation_reason',o.cancellation_reason,'cancelled_at',o.cancelled_at,'created_at',o.created_at,'updated_at',o.updated_at,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'variant_id',i.variant_id,'product_name',i.product_name,'color',i.color,'size',i.size,'quantity',i.quantity,'unit_price',i.unit_price,'line_total',i.line_total,'image_url',i.image_url,'stock_reserved',i.stock_reserved) order by i.created_at) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object('status',h.status,'note',h.note,'actor_type',h.actor_type,'actor_label',h.actor_label,'created_at',h.created_at) order by h.created_at) from public.order_status_history h where h.order_id=o.id),'[]'::jsonb)
) end
from public.orders o
where o.id=p_order_id and o.tracking_hash=encode(digest(coalesce(p_tracking_token,''),'sha256'),'hex');
$$;
revoke all on function public.get_customer_order(uuid,text) from public;
grant execute on function public.get_customer_order(uuid,text) to anon, authenticated;

create or replace function public.restore_order_stock(p_order_id uuid, p_actor_type text, p_actor_label text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r record;
begin
  if exists(select 1 from public.orders where id=p_order_id and stock_restored=true) then return; end if;
  for r in select * from public.order_items where order_id=p_order_id and stock_reserved=true loop
    if r.product_id is null then continue; end if;
    if r.variant_id is not null and exists(select 1 from public.product_variants where id=r.variant_id and product_id=r.product_id) then
      update public.product_variants set stock=greatest(coalesce(stock,0),0)+r.quantity, stock_status='in_stock' where id=r.variant_id;
      perform public.wellone_recalc_product_stock(r.product_id);
    elsif (r.color is not null or r.size is not null) and exists(
      select 1 from public.product_variants v where v.product_id=r.product_id
       and (r.color is null or lower(coalesce(v.color,v.unit,''))=lower(r.color))
       and (r.size is null or lower(coalesce(v.size,v.label,''))=lower(r.size))
    ) then
      update public.product_variants v set stock=greatest(coalesce(v.stock,0),0)+r.quantity,stock_status='in_stock'
       where v.id=(select vv.id from public.product_variants vv where vv.product_id=r.product_id
        and (r.color is null or lower(coalesce(vv.color,vv.unit,''))=lower(r.color))
        and (r.size is null or lower(coalesce(vv.size,vv.label,''))=lower(r.size)) order by vv.sort_order nulls last,vv.id limit 1);
      perform public.wellone_recalc_product_stock(r.product_id);
    else
      update public.products set stock_quantity=greatest(stock_quantity,0)+r.quantity, stock_status='in_stock', updated_at=now() where id=r.product_id and track_inventory=true;
    end if;
    insert into public.stock_movements(product_id,variant_id,quantity_delta,reason,reference_id,actor_type,actor_label)
    values(r.product_id,r.variant_id,r.quantity,'order_cancel_restore',p_order_id,p_actor_type,p_actor_label);
  end loop;
  update public.orders set stock_restored=true,updated_at=now() where id=p_order_id;
end;
$$;
revoke all on function public.restore_order_stock(uuid,text,text) from public;

create or replace function public.cancel_customer_order(p_order_id uuid, p_tracking_token text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id=p_order_id and tracking_hash=encode(digest(coalesce(p_tracking_token,''),'sha256'),'hex') for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.status='cancelled' then return public.get_customer_order(p_order_id,p_tracking_token); end if;
  if o.status='delivered' then raise exception 'Delivered orders cannot be cancelled.'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Enter a cancellation reason.'; end if;
  perform public.restore_order_stock(p_order_id,'customer',o.customer_name);
  update public.orders set status='cancelled',cancellation_reason=btrim(p_reason),cancelled_at=now(),updated_at=now() where id=p_order_id;
  insert into public.order_status_history(order_id,status,note,actor_type,actor_label) values(p_order_id,'cancelled',btrim(p_reason),'customer',o.customer_name);
  return public.get_customer_order(p_order_id,p_tracking_token);
end;
$$;
revoke all on function public.cancel_customer_order(uuid,text,text) from public;
grant execute on function public.cancel_customer_order(uuid,text,text) to anon, authenticated;

-- Admin order operations -----------------------------------------------------
create or replace function public.admin_update_order_status(p_order_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_admin uuid := auth.uid(); v_old text;
begin
  if v_admin is null or not exists(select 1 from public.admin_users where id=v_admin) then raise exception 'Admin login required.'; end if;
  if p_status not in ('confirmed','packed','out_for_delivery','delivered','cancelled') then raise exception 'Invalid order status.'; end if;
  select status into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_old='cancelled' and p_status<>'cancelled' then raise exception 'Cancelled order cannot be reopened.'; end if;
  if p_status='cancelled' and v_old<>'cancelled' then perform public.restore_order_stock(p_order_id,'admin',v_admin::text); end if;
  update public.orders set status=p_status,cancellation_reason=case when p_status='cancelled' then coalesce(nullif(btrim(p_note),''),'Cancelled by admin') else cancellation_reason end,cancelled_at=case when p_status='cancelled' then now() else cancelled_at end,updated_at=now() where id=p_order_id;
  insert into public.order_status_history(order_id,status,note,actor_type,actor_label) values(p_order_id,p_status,nullif(btrim(p_note),''),'admin',v_admin::text);
end;
$$;
revoke all on function public.admin_update_order_status(uuid,text,text) from public;
grant execute on function public.admin_update_order_status(uuid,text,text) to authenticated;

create or replace function public.admin_set_order_payment(p_order_id uuid, p_payment_status text)
returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users where id=auth.uid()) then raise exception 'Admin login required.'; end if;
  if p_payment_status not in ('pending','paid','failed','refunded') then raise exception 'Invalid payment status.'; end if;
  update public.orders set payment_status=p_payment_status,updated_at=now() where id=p_order_id;
end; $$;
revoke all on function public.admin_set_order_payment(uuid,text) from public;
grant execute on function public.admin_set_order_payment(uuid,text) to authenticated;

-- Employee account management ----------------------------------------------
create or replace function public.admin_list_employees()
returns table(id uuid, username text, is_active boolean, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users where id=auth.uid()) then raise exception 'Admin login required.'; end if;
  return query select e.id,e.username,e.is_active,e.created_at,e.updated_at from public.employees e order by e.created_at desc;
end; $$;
revoke all on function public.admin_list_employees() from public;
grant execute on function public.admin_list_employees() to authenticated;

create or replace function public.admin_save_employee(p_username text, p_password text, p_employee_id uuid default null)
returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users where id=auth.uid()) then raise exception 'Admin login required.'; end if;
  if nullif(btrim(p_username),'') is null then raise exception 'Enter employee username.'; end if;
  if p_employee_id is null and length(coalesce(p_password,'')) < 4 then raise exception 'Password must be at least 4 characters.'; end if;
  if p_employee_id is null then
    insert into public.employees(username,password_hash,created_by) values(btrim(p_username),crypt(p_password,gen_salt('bf')),auth.uid()) returning id into v_id;
  else
    update public.employees set username=btrim(p_username),password_hash=case when nullif(p_password,'') is null then password_hash else crypt(p_password,gen_salt('bf')) end,updated_at=now() where id=p_employee_id returning id into v_id;
    if v_id is null then raise exception 'Employee not found.'; end if;
    delete from public.employee_sessions where employee_id=v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'That employee username already exists.';
end; $$;
revoke all on function public.admin_save_employee(text,text,uuid) from public;
grant execute on function public.admin_save_employee(text,text,uuid) to authenticated;

create or replace function public.admin_set_employee_active(p_employee_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if auth.uid() is null or not exists(select 1 from public.admin_users where id=auth.uid()) then raise exception 'Admin login required.'; end if;
  update public.employees set is_active=p_active,updated_at=now() where id=p_employee_id;
  if not p_active then delete from public.employee_sessions where employee_id=p_employee_id; end if;
end; $$;
revoke all on function public.admin_set_employee_active(uuid,boolean) from public;
grant execute on function public.admin_set_employee_active(uuid,boolean) to authenticated;

create or replace function public.employee_login(p_username text, p_password text)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare e public.employees%rowtype; v_token text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
begin
  delete from public.employee_sessions where expires_at < now();
  select * into e from public.employees where lower(username)=lower(btrim(p_username)) and is_active=true limit 1;
  if not found or e.password_hash <> crypt(coalesce(p_password,''), e.password_hash) then raise exception 'Invalid username or password.'; end if;
  insert into public.employee_sessions(employee_id,token_hash,expires_at) values(e.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '30 days');
  return jsonb_build_object('token',v_token,'employee_id',e.id,'username',e.username,'expires_at',now()+interval '30 days');
end; $$;
revoke all on function public.employee_login(text,text) from public;
grant execute on function public.employee_login(text,text) to anon, authenticated;

create or replace function public.employee_from_token(p_token text)
returns uuid
language sql security definer set search_path=public,extensions as $$
select e.id from public.employee_sessions s join public.employees e on e.id=s.employee_id where s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex') and s.expires_at>now() and e.is_active=true limit 1;
$$;
revoke all on function public.employee_from_token(text) from public;

create or replace function public.employee_get_product_by_barcode(p_token text, p_barcode text)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_emp uuid; p record;
begin
  v_emp := public.employee_from_token(p_token); if v_emp is null then raise exception 'Employee login expired.'; end if;
  select pr.* into p from public.products pr where pr.barcode_enabled=true and pr.barcode=btrim(p_barcode) limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id',p.id,'name',p.name,'barcode',p.barcode,'image_url',p.main_image_url,'track_inventory',p.track_inventory,'stock_quantity',p.stock_quantity,'stock_status',p.stock_status,
    'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'color',coalesce(nullif(v.color,''),nullif(v.unit,'')),'size',coalesce(nullif(v.size,''),nullif(v.label,'')),'stock',v.stock,'stock_status',v.stock_status,'price',coalesce(v.price,p.price)) order by v.sort_order,v.id) from public.product_variants v where v.product_id=p.id),'[]'::jsonb)
  );
end; $$;
revoke all on function public.employee_get_product_by_barcode(text,text) from public;
grant execute on function public.employee_get_product_by_barcode(text,text) to anon, authenticated;

create or replace function public.employee_record_sale(p_token text, p_product_id uuid, p_variant_id uuid, p_quantity integer default 1)
returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_emp uuid; v_username text; p public.products%rowtype; v public.product_variants%rowtype; q integer := greatest(1,coalesce(p_quantity,1));
begin
  v_emp := public.employee_from_token(p_token); if v_emp is null then raise exception 'Employee login expired.'; end if;
  select username into v_username from public.employees where id=v_emp;
  select * into p from public.products where id=p_product_id for update;
  if not found then raise exception 'Product not found.'; end if;
  if not p.track_inventory then raise exception 'Stock tracking is off for this item. Turn on Track stock quantity in Admin first.'; end if;
  if p_variant_id is not null then
    select * into v from public.product_variants where id=p_variant_id and product_id=p.id for update;
    if not found then raise exception 'Variant not found.'; end if;
    if coalesce(v.stock,0)<q then raise exception 'Only % unit(s) are available.',greatest(coalesce(v.stock,0),0); end if;
    update public.product_variants set stock=stock-q,stock_status=case when stock-q>0 then 'in_stock' else 'out_of_stock' end where id=v.id;
    perform public.wellone_recalc_product_stock(p.id);
  else
    if exists(select 1 from public.product_variants where product_id=p.id) then raise exception 'Select the exact colour/size variant.'; end if;
    if coalesce(p.stock_quantity,0)<q then raise exception 'Only % unit(s) are available.',greatest(coalesce(p.stock_quantity,0),0); end if;
    update public.products set stock_quantity=stock_quantity-q,stock_status=case when stock_quantity-q>0 then 'in_stock' else 'out_of_stock' end,updated_at=now() where id=p.id;
  end if;
  insert into public.stock_movements(product_id,variant_id,quantity_delta,reason,actor_type,actor_label) values(p.id,p_variant_id,-q,'employee_sale','employee',v_username);
  return public.employee_get_product_by_barcode(p_token,p.barcode);
end; $$;
revoke all on function public.employee_record_sale(text,uuid,uuid,integer) from public;
grant execute on function public.employee_record_sale(text,uuid,uuid,integer) to anon, authenticated;

-- Enable live admin order receiving through Supabase Realtime when possible.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
exception when others then
  raise notice 'Could not add orders to supabase_realtime publication automatically: %', sqlerrm;
end $$;

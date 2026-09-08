-- ═══════════════════════════════════════════════════════════════════════
--  0080 — Cotizaciones (modulo 31, F9/S56)
--
--  Los totales reutilizan documentTotals()/lineTotals() de
--  documents.ts TAL CUAL -la misma formula que ya usan pedidos,
--  tickets de POS y facturas-. La vigencia reutiliza
--  certificadoVigente() de training.ts -quinta vez que se resuelve la
--  misma pregunta ("esto ya vencio?")-.
--
--  Deliberadamente SIN FK a leads: recomienda `crm`, no lo requiere
--  -mismo criterio que logistics dejando el vehiculo como texto
--  libre en vez de una FK a fleet-. SI requiere `products`
--  (regb.module_catalog: requires '{products}'), por eso quote_lines
--  referencia products con una FK real.
--
--  Una cotizacion tiene versiones: crear una version nueva marca la
--  anterior 'superseded' y crea una fila nueva con
--  supersedes_id apuntando a la vieja -nunca se sobrescribe la
--  original, el historial de que se cotizo cada vez queda intacto-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.quotes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  quote_number     text not null,
  version          integer not null default 1 check (version > 0),
  supersedes_id    uuid references public.quotes(id),
  customer_id      uuid references public.customers(id),
  status           text not null default 'draft'
                     check (status in ('draft', 'sent', 'approved', 'rejected', 'expired', 'superseded')),
  valid_until      date,
  subtotal         numeric(12,2) not null default 0,
  discount         numeric(12,2) not null default 0,
  tax              numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  terms            text,
  rejected_reason  text,
  created_by       uuid,
  sent_at          timestamptz,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, quote_number, version)
);

create index on public.quotes (tenant_id, status);
create index on public.quotes (tenant_id, customer_id);

create table public.quote_lines (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references public.quotes(id) on delete cascade,
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  description   text,
  quantity      numeric(14,4) not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate      numeric(5,4) not null default 0.18 check (tax_rate between 0 and 1),
  line_total    numeric(12,2) not null check (line_total >= 0)
);

create index on public.quote_lines (tenant_id, quote_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.quotes enable row level security;
alter table public.quotes force row level security;
alter table public.quote_lines enable row level security;
alter table public.quote_lines force row level security;

create policy tenant_module on public.quotes for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quotes'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quotes'));
create policy provider_impersonating on public.quotes for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.quote_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('quotes'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('quotes'));
create policy provider_impersonating on public.quote_lines for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_referencia_ajena_cotizacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.customer_id is not null then
    select tenant_id into v_tenant from public.customers where id = new.customer_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  if new.supersedes_id is not null then
    select tenant_id into v_tenant from public.quotes where id = new.supersedes_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Esa cotizacion anterior no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_cotizacion
  before insert or update on public.quotes
  for each row execute function public.impedir_referencia_ajena_cotizacion();

create function public.impedir_referencia_ajena_linea_cotizacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_cotizacion uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_cotizacion from public.quotes where id = new.quote_id;
  if v_tenant_cotizacion is distinct from new.tenant_id then
    raise exception 'Esa cotizacion no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_linea_cotizacion
  before insert on public.quote_lines
  for each row execute function public.impedir_referencia_ajena_linea_cotizacion();

-- ── Inmutabilidad: contenido congelado fuera de draft ──────────────────
create function public.impedir_editar_cotizacion_no_borrador() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status != 'draft' then
    if new.quote_number is distinct from old.quote_number
       or new.customer_id is distinct from old.customer_id
       or new.valid_until is distinct from old.valid_until
       or new.terms is distinct from old.terms
       or new.subtotal is distinct from old.subtotal
       or new.discount is distinct from old.discount
       or new.tax is distinct from old.tax
       or new.total is distinct from old.total then
      raise exception 'Esa cotizacion ya no esta en borrador; su contenido no se puede cambiar.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_editar_cotizacion_no_borrador
  before update on public.quotes
  for each row execute function public.impedir_editar_cotizacion_no_borrador();

-- Las lineas solo existen mientras la cotizacion sigue en borrador:
-- una vez enviada, son un hecho historico de lo que se cotizo.
create function public.impedir_editar_linea_cotizacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.quotes
    where id = coalesce(new.quote_id, old.quote_id);
  if v_status != 'draft' then
    raise exception 'Esa cotizacion ya no esta en borrador; sus lineas no se pueden cambiar.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_linea_cotizacion
  before update or delete on public.quote_lines
  for each row execute function public.impedir_editar_linea_cotizacion();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.quotes
  for each row execute function audit.record('quotes');
create trigger audit_me after insert or update or delete on public.quote_lines
  for each row execute function audit.record('quotes');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Cada version de una cotizacion queda en el historial, nunca se sobrescribe la anterior',
    problem      = 'Sin versiones reales, cotizar de nuevo despues de un cambio significa perder que se ofrecio la primera vez -o mantener el rastro en un documento de Word aparte-.',
    features     = '[
      {"titulo":"Versiones de verdad","detalle":"Revisar una cotizacion crea una version nueva y marca la anterior superseded -nunca se sobrescribe, el historial completo queda intacto-."},
      {"titulo":"Contenido congelado al enviar","detalle":"Una cotizacion enviada ya no puede cambiar sus lineas ni su cliente -corregir algo significa una version nueva, no editar la enviada-."},
      {"titulo":"Los mismos totales que el resto del ERP","detalle":"El calculo de subtotal, descuento e ITBIS es EXACTAMENTE el mismo que usan pedidos, POS y facturas -una sola formula, en un solo lugar-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que cotice antes de vender y necesite un historial real de versiones, no un documento de Word que se sobrescribe"}',
    faq          = '[
      {"p":"¿Necesito CRM para cotizar?","r":"No -quotes funciona por su cuenta, aunque se complementa con crm si ya capturas leads-."},
      {"p":"¿Puedo editar una cotizacion ya enviada?","r":"No -su contenido se congela al enviarla; para corregir algo se crea una version nueva-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'quotes';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'quotes'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'quotes no tiene precio en los 3 tiers';
  end if;
end $$;

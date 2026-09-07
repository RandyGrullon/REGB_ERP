-- ═══════════════════════════════════════════════════════════════════════
--  0064 — Cotizacion a proveedores / RFQ (modulo 44, F8/S44)
--
--  SIN portal de proveedores -cada cotizacion se registra a mano por
--  quien compra, mismo criterio que "sin portal de empleo" en
--  recruiting: este esquema nunca otorga acceso a datos de negocio al
--  rol `anon`-. El comparativo automatico SI se resuelve de verdad:
--  mejorCotizacion() (@regb/operations) elige siempre por el monto mas
--  bajo, desempatando por el plazo de entrega mas corto -nunca en SQL-.
--
--  Reutiliza public.suppliers (0038/0061) para invitar y cotizar, sin
--  duplicar el registro de proveedor.
-- ═══════════════════════════════════════════════════════════════════════

create table public.rfqs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  title         text not null,
  description   text,
  deadline      date,
  status        text not null default 'open' check (status in ('open', 'awarded', 'cancelled')),
  awarded_supplier_id uuid references public.suppliers(id),
  awarded_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.rfqs (tenant_id, status);

create table public.rfq_invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  rfq_id      uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  invited_at  timestamptz not null default now(),
  unique (tenant_id, rfq_id, supplier_id)
);

create index on public.rfq_invitations (tenant_id, rfq_id);

-- Una cotizacion es un hecho fijo desde que se registra -mismo
-- criterio que una evaluacion de proveedor o un certificado de
-- capacitacion-: no hay estado de "borrador", se inserta ya enviada.
create table public.rfq_quotes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  rfq_id         uuid not null references public.rfqs(id) on delete cascade,
  supplier_id    uuid not null references public.suppliers(id),
  total_amount   numeric(12,2) not null check (total_amount > 0),
  lead_time_days integer not null check (lead_time_days >= 0),
  notes          text,
  submitted_at   timestamptz not null default now(),
  unique (tenant_id, rfq_id, supplier_id)
);

create index on public.rfq_quotes (tenant_id, rfq_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('rfqs',             'rfq'),
      ('rfq_invitations',  'rfq'),
      ('rfq_quotes',       'rfq')
    ) as t(tabla, modulo)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('alter table public.%I force row level security', r.tabla);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(%L))
         with check (tenant_id = rls.tenant_id() and rls.module_active(%L))',
      r.tabla, r.modulo, r.modulo);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', r.tabla);
  end loop;
end $$;

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenece el proveedor -ni, en rfqs, a quien
-- pertenece el proveedor adjudicado-.
create function public.impedir_rfq_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.awarded_supplier_id is not null then
    select tenant_id into v_tenant from public.suppliers where id = new.awarded_supplier_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese proveedor no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_rfq_ajeno before insert or update on public.rfqs
  for each row execute function public.impedir_rfq_ajeno();

create function public.impedir_referencia_ajena_rfq() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_rfq      uuid;
  v_tenant_proveedor uuid;
begin
  select tenant_id into v_tenant_rfq from public.rfqs where id = new.rfq_id;
  if v_tenant_rfq is distinct from new.tenant_id then
    raise exception 'Esa cotizacion no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_proveedor from public.suppliers where id = new.supplier_id;
  if v_tenant_proveedor is distinct from new.tenant_id then
    raise exception 'Ese proveedor no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_invitacion_ajena before insert on public.rfq_invitations
  for each row execute function public.impedir_referencia_ajena_rfq();
create trigger no_cotizacion_ajena before insert on public.rfq_quotes
  for each row execute function public.impedir_referencia_ajena_rfq();

-- ── Un RFQ resuelto (awarded/cancelled) es inmutable ─────────────────────
create function public.impedir_editar_rfq_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('awarded', 'cancelled') then
    raise exception 'Ese RFQ ya quedo resuelto y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_rfq_resuelto
  before update or delete on public.rfqs
  for each row execute function public.impedir_editar_rfq_resuelto();

-- ── Una cotizacion registrada es inmutable -sin excepcion, como un pago- ─
create function public.impedir_editar_cotizacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una cotizacion ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_cotizacion
  before update or delete on public.rfq_quotes
  for each row execute function public.impedir_editar_cotizacion();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.rfqs
  for each row execute function audit.record('rfq');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Comparativo automatico de verdad: el precio mas bajo gana, sin favoritismos',
    problem      = 'Sin un registro real, comparar cotizaciones de varios proveedores es una hoja de calculo distinta cada vez, y la adjudicacion se decide de memoria.',
    features     = '[
      {"titulo":"Comparativo automatico real","detalle":"Gana siempre el monto mas bajo -desempatando por el plazo de entrega mas corto-, calculado con la misma regla cada vez, nunca a criterio de quien compra."},
      {"titulo":"Una cotizacion registrada es un hecho fijo","detalle":"Igual que una evaluacion de proveedor: una vez registrada, no se edita ni se borra -un error se corrige con una cotizacion nueva-."},
      {"titulo":"Honesto sobre el portal de proveedores","detalle":"No hay portal publico donde el proveedor suba su propia cotizacion -este sistema nunca expone datos de negocio sin sesion iniciada-. Se registra a mano."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan suppliers y cotizan con varios proveedores a la vez","Cualquiera que quiera un historial real de por que se eligio a un proveedor"}',
    faq          = '[
      {"p":"¿El proveedor puede subir su propia cotizacion?","r":"No en esta version -este sistema nunca expone datos de negocio a quien no ha iniciado sesion-. Quien compra registra cada cotizacion a mano."},
      {"p":"¿Se puede corregir una cotizacion despues de registrarla?","r":"No, igual que una evaluacion de proveedor: es un hecho fijo. Una correccion se hace con una cotizacion nueva."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'rfq';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'rfq'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'rfq no tiene precio en los 3 tiers';
  end if;
end $$;

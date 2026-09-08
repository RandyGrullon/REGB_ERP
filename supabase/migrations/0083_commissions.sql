-- ═══════════════════════════════════════════════════════════════════════
--  0083 — Comisiones (modulo 34, F9/S57)
--
--  calcularComision() es la unica formula: porcentaje sobre una base
--  o un monto fijo, nunca una mezcla ambigua. transicionValidaComision()
--  sigue el mismo criterio que un CAPA de quality: no se puede pagar
--  sin aprobar primero.
--
--  REQUIERE sales-orders (regb.module_catalog: requires
--  '{sales-orders}'): una comision se calcula sobre un pedido de
--  venta real, por eso commission_entries tiene una FK autentica
--  hacia sales_orders. Recomienda payroll -para la liquidacion final-
--  sin exigirlo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.commission_plans (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  name       text not null,
  basis      text not null check (basis in ('percentage', 'fixed')),
  rate       numeric(10,4) not null check (rate > 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.commission_plans (tenant_id, active);

create table public.commission_entries (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  plan_id             uuid not null references public.commission_plans(id),
  sales_order_id      uuid not null references public.sales_orders(id),
  salesperson_id      uuid not null,
  base_amount         numeric(12,2) not null check (base_amount >= 0),
  commission_amount   numeric(12,2) not null check (commission_amount >= 0),
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected', 'paid')),
  approved_at         timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on public.commission_entries (tenant_id, salesperson_id);
create index on public.commission_entries (tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.commission_plans enable row level security;
alter table public.commission_plans force row level security;
alter table public.commission_entries enable row level security;
alter table public.commission_entries force row level security;

create policy tenant_module on public.commission_plans for all
  using (tenant_id = rls.tenant_id() and rls.module_active('commissions'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('commissions'));
create policy provider_impersonating on public.commission_plans for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.commission_entries for all
  using (tenant_id = rls.tenant_id() and rls.module_active('commissions'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('commissions'));
create policy provider_impersonating on public.commission_entries for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_referencia_ajena_comision() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_plan uuid;
  v_tenant_orden uuid;
begin
  select tenant_id into v_tenant_plan from public.commission_plans where id = new.plan_id;
  if v_tenant_plan is distinct from new.tenant_id then
    raise exception 'Ese plan de comision no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_orden from public.sales_orders where id = new.sales_order_id;
  if v_tenant_orden is distinct from new.tenant_id then
    raise exception 'Esa orden de venta no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_comision
  before insert on public.commission_entries
  for each row execute function public.impedir_referencia_ajena_comision();

-- ── Inmutabilidad: congelada solo en su estado TERMINAL ────────────────
-- 'approved' no es terminal -tiene que poder seguir avanzando a
-- 'paid'-. Congelar en cuanto sale de 'pending' bloquearia esa misma
-- transicion que la maquina de estados exige.
create function public.impedir_editar_comision_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('paid', 'rejected') then
    raise exception 'Esa comision ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_comision_resuelta
  before update or delete on public.commission_entries
  for each row execute function public.impedir_editar_comision_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.commission_plans
  for each row execute function audit.record('commissions');
create trigger audit_me after insert or update on public.commission_entries
  for each row execute function audit.record('commissions');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Una formula, nunca una mezcla ambigua: porcentaje sobre una base o un monto fijo',
    problem      = 'Sin un calculo consistente, cada vendedor termina calculando su comision distinto, y la liquidacion se demora porque nadie confia en el numero hasta revisarlo a mano.',
    features     = '[
      {"titulo":"Una sola formula por plan","detalle":"Porcentaje sobre una base o monto fijo -nunca una mezcla ambigua entre los dos-."},
      {"titulo":"Liquidacion con aprobacion real","detalle":"Una comision no se paga sin aprobarse primero -el mismo criterio que ya usa un CAPA de control de calidad-."},
      {"titulo":"Ligada a la orden de venta real","detalle":"Cada comision referencia la orden de venta exacta que la genero, no un monto suelto sin respaldo."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que pague comision de ventas y hoy la calcule en una hoja de calculo aparte"}',
    faq          = '[
      {"p":"¿Necesito nomina para pagar las comisiones?","r":"No -commissions calcula y aprueba, recomienda payroll para la liquidacion final pero no lo exige-."},
      {"p":"¿Se puede pagar una comision sin aprobarla?","r":"No -tiene que pasar por aprobada antes de poder marcarse pagada-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'commissions';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'commissions'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'commissions no tiene precio en los 3 tiers';
  end if;
end $$;

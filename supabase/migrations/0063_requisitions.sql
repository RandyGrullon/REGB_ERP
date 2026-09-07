-- ═══════════════════════════════════════════════════════════════════════
--  0063 — Requisiciones (modulo 43, F8/S44)
--
--  El flujo de aprobacion por MONTO reutiliza `max_amount` -ya existe
--  en @regb/permissions, probado desde antes de esta fase- en vez de
--  inventar un motor de aprobacion aparte: la accion de aprobar llama
--  exigir(ctx, 'requisitions', 'requisitions.approve', estimated_amount),
--  y si el rol de quien aprueba tiene un limite mas bajo, el propio
--  mecanismo lo rechaza con el motivo "amount-exceeded". La jerarquia es
--  el sistema de roles mismo: un rol sin ese limite (Gerente General,
--  Owner) aprueba en su lugar -no hace falta una tabla de cadena de
--  aprobacion aparte-.
--
--  La transicion de estado se valida en TypeScript
--  (transicionValidaRequisicion() en @regb/operations), no en SQL.
--
--  Honesto sobre el alcance: "convertida" es un estado manual con una
--  referencia de texto libre a la orden de compra resultante -todavia
--  NO crea automaticamente una fila en purchase_orders-. Esa
--  integracion real es un paso futuro, declarado explicitamente.
-- ═══════════════════════════════════════════════════════════════════════

create table public.purchase_requisitions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  employee_id       uuid not null references public.employees(id),
  department        text,
  description       text not null,
  estimated_amount  numeric(12,2) not null check (estimated_amount > 0),
  status            text not null default 'draft'
                      check (status in ('draft', 'pending', 'approved', 'rejected', 'converted')),
  -- Sin FK a employees: quien aprueba es el usuario autenticado (user_profiles),
  -- no necesariamente alguien con fila en employees -mismo criterio que
  -- decided_by en time-off (0054) y expenses (0055)-. Su tenant ya lo
  -- garantiza la sesion/RLS, no hace falta validarlo aqui.
  approved_by       uuid,
  approved_at       timestamptz,
  decision_note     text,
  po_reference      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index on public.purchase_requisitions (tenant_id, employee_id);
create index on public.purchase_requisitions (tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.purchase_requisitions enable row level security;
alter table public.purchase_requisitions force row level security;

create policy tenant_module on public.purchase_requisitions for all
  using (tenant_id = rls.tenant_id() and rls.module_active('requisitions'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('requisitions'));

create policy provider_impersonating on public.purchase_requisitions for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila nueva,
-- no a quien pertenece employee_id. `approved_by` no se valida aqui -es
-- el usuario autenticado, no una fila de employees; su tenant ya lo
-- garantiza la sesion bajo la que corre asUser()-.
create function public.impedir_requisicion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_empleado uuid;
begin
  select tenant_id into v_tenant_empleado from public.employees where id = new.employee_id;
  if v_tenant_empleado is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_requisicion_ajena before insert or update on public.purchase_requisitions
  for each row execute function public.impedir_requisicion_ajena();

-- ── Una requisicion resuelta (rejected/converted) es inmutable ───────────
-- 'approved' NO es terminal: todavia puede pasar a 'converted'.
create function public.impedir_editar_requisicion_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('rejected', 'converted') then
    raise exception 'Esa requisicion ya quedo resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_requisicion_resuelta
  before update or delete on public.purchase_requisitions
  for each row execute function public.impedir_editar_requisicion_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.purchase_requisitions
  for each row execute function audit.record('requisitions');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Aprobacion por monto real -el limite de cada rol decide, no una hoja de firmas-',
    problem      = 'Sin un registro real, pedir un cotizador nuevo pasa por WhatsApp y nadie sabe quien lo aprobo ni por que monto.',
    features     = '[
      {"titulo":"El limite de cada rol decide, no una firma en papel","detalle":"Aprobar una requisicion usa el mismo limite de monto que ya tiene cada rol -si el limite no alcanza, el sistema lo dice claro, y alguien con mayor jerarquia lo aprueba-."},
      {"titulo":"Un flujo con reglas reales","detalle":"Borrador, pendiente, aprobada o rechazada -no se puede saltar directo de borrador a aprobada, ni reabrir una ya resuelta-."},
      {"titulo":"Honesto sobre la conversion a orden","detalle":"Marcar una requisicion como convertida es manual, con una referencia de texto a la orden resultante -todavia no crea la orden de compra automaticamente-."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan employees y purchase-orders y quieren dejar de aprobar por WhatsApp","Cualquiera con mas de un nivel de aprobacion segun el monto"}',
    faq          = '[
      {"p":"¿Convierte la requisicion en una orden de compra automaticamente?","r":"No todavia -queda marcada como convertida con una referencia de texto a la orden resultante-. Esa integracion real es un paso futuro."},
      {"p":"¿Cada rol tiene su propio limite de aprobacion?","r":"Si -el mismo limite de monto que ya existe en el sistema de roles y permisos, no una tabla de aprobacion aparte-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'requisitions';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'requisitions'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'requisitions no tiene precio en los 3 tiers';
  end if;
end $$;

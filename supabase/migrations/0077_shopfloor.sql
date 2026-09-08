-- ═══════════════════════════════════════════════════════════════════════
--  0077 — Piso de planta / OEE (modulo 60, F8.5/S54)
--
--  OEE = disponibilidad x rendimiento x calidad, cada factor recortado
--  a [0,1] antes de multiplicar (calcularOee() en @regb/operations).
--  El tiempo trabajado reutiliza workedHours() de attendance.ts -la
--  misma resta entre entrada y salida-; la calidad reutiliza
--  tasaMerma() de manufacturing.ts -calidad es 1 menos la merma-.
--
--  shopfloor REQUIERE manufacturing (regb.module_catalog: requires
--  '{manufacturing}'): el terminal marca tiempos y paros sobre una
--  orden de produccion real, no tiene sentido sin ella. Por eso esta
--  migracion SI altera production_orders -acoplamiento legitimo
--  porque el requires esta declarado, mismo criterio que
--  lots-serials alterando inventory_movements/products-.
-- ═══════════════════════════════════════════════════════════════════════

-- El ciclo ideal es una estimacion que declara quien opera el
-- terminal -sin ella, rendimiento() no tiene con que calcularse-.
alter table public.production_orders
  add column ideal_cycle_hours numeric(10,4) check (ideal_cycle_hours is null or ideal_cycle_hours > 0);

-- Una sesion de operario en el terminal: se cierra marcando salida.
-- Antes de cerrar es un registro vivo (se puede corregir la entrada);
-- cerrada, es un hecho historico.
create table public.shopfloor_sessions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id),
  operator_id         uuid,
  clocked_in_at       timestamptz not null default now(),
  clocked_out_at      timestamptz,
  created_at          timestamptz not null default now(),
  check (clocked_out_at is null or clocked_out_at >= clocked_in_at)
);

create index on public.shopfloor_sessions (tenant_id, production_order_id);

-- Un paro de la orden: mismo patron -abierto es vivo, cerrado es
-- historico-. Sus horas cerradas son las que disponibilidad() resta
-- del tiempo planificado.
create table public.shopfloor_downtime (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id),
  reason              text not null,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  created_at          timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index on public.shopfloor_downtime (tenant_id, production_order_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.shopfloor_sessions enable row level security;
alter table public.shopfloor_sessions force row level security;
alter table public.shopfloor_downtime enable row level security;
alter table public.shopfloor_downtime force row level security;

create policy tenant_module on public.shopfloor_sessions for all
  using (tenant_id = rls.tenant_id() and rls.module_active('shopfloor'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('shopfloor'));
create policy provider_impersonating on public.shopfloor_sessions for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.shopfloor_downtime for all
  using (tenant_id = rls.tenant_id() and rls.module_active('shopfloor'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('shopfloor'));
create policy provider_impersonating on public.shopfloor_downtime for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_orden_ajena_sesion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.production_orders where id = new.production_order_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa orden de produccion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_orden_ajena_sesion
  before insert or update on public.shopfloor_sessions
  for each row execute function public.impedir_orden_ajena_sesion();

create trigger no_orden_ajena_paro
  before insert or update on public.shopfloor_downtime
  for each row execute function public.impedir_orden_ajena_sesion();

-- ── Inmutabilidad: vivo mientras abierto, historico al cerrar ──────────
create function public.impedir_editar_sesion_cerrada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.clocked_out_at is not null then
    raise exception 'Esa sesion ya se cerro y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_sesion_cerrada
  before update or delete on public.shopfloor_sessions
  for each row execute function public.impedir_editar_sesion_cerrada();

create function public.impedir_editar_paro_cerrado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.ended_at is not null then
    raise exception 'Ese paro ya se cerro y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_paro_cerrado
  before update or delete on public.shopfloor_downtime
  for each row execute function public.impedir_editar_paro_cerrado();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.shopfloor_sessions
  for each row execute function audit.record('shopfloor');
create trigger audit_me after insert or update on public.shopfloor_downtime
  for each row execute function audit.record('shopfloor');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'OEE de verdad -disponibilidad x rendimiento x calidad-, no un numero inventado en una hoja de calculo',
    problem      = 'Sin marcaje de tiempos y paros por orden de produccion, el OEE que reporta el supervisor es una estimacion de memoria: nadie sabe cuanto tiempo real se perdio en paros ni si el ciclo ideal se cumplio.',
    features     = '[
      {"titulo":"OEE calculado, no estimado","detalle":"Disponibilidad, rendimiento y calidad se calculan de las sesiones y paros reales marcados en el terminal, no de una estimacion."},
      {"titulo":"Terminal tactil simple","detalle":"Marcar entrada, marcar salida, iniciar o terminar un paro -pensado para tocarse en planta, no para navegar menus-."},
      {"titulo":"Cada factor recortado a su rango real","detalle":"Un ciclo ideal mal estimado no puede inflar el rendimiento por encima de 100%; el OEE final nunca miente por un solo factor fuera de rango."}
    ]'::jsonb,
    audience     = '{"Quien ya usa manufacturing y quiere saber que tan bien se esta usando el equipo, no solo si se completo la orden"}',
    faq          = '[
      {"p":"¿Necesito manufacturing para usar este modulo?","r":"Si -shopfloor marca tiempos sobre ordenes de produccion reales, no existe sin ellas-."},
      {"p":"¿El OEE se actualiza en vivo mientras la orden esta en progreso?","r":"Si -se recalcula con cada sesion y cada paro que se cierra-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'shopfloor';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'shopfloor'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'shopfloor no tiene precio en los 3 tiers';
  end if;
end $$;

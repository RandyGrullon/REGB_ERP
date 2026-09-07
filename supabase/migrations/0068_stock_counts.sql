-- ═══════════════════════════════════════════════════════════════════════
--  0068 — Conteos ciclicos (modulo 51, F8/S47)
--
--  `inventory` (0019) ya tiene `stock_counts`/`stock_count_lines`: abrir
--  un conteo, escribir lo contado junto al numero del sistema, cerrar y
--  ajustar de una vez -sin programacion, sin conteo ciego, sin
--  aprobacion-. Este modulo NO la reemplaza: agrega las tres cosas que
--  el catalogo promete y esa version no tiene.
--
--  1. Programacion ABC real: clasificarAbc() (@regb/operations) es un
--     Pareto 80/15/5 del valor acumulado, no una tabla que alguien
--     llena a mano. frecuenciaConteoDias() dice cada cuanto le toca a
--     cada clase (A cada 30 dias, B cada 90, C cada 180).
--  2. Conteo CIEGO de verdad: la pantalla de contar no muestra
--     system_qty mientras se cuenta -esa es la diferencia real con
--     stock_counts, donde el numero del sistema esta justo al lado del
--     campo para escribir-.
--  3. Ajuste con aprobacion: contar deja el conteo en pending_approval;
--     el ajuste a inventory_movements/stock_levels SOLO se postea si
--     alguien con permiso de aprobar lo aprueba. transicionValidaConteo()
--     (@regb/operations) valida la maquina de estados.
-- ═══════════════════════════════════════════════════════════════════════

create table public.count_schedules (
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  product_id       uuid not null references public.products(id),
  abc_class        text not null check (abc_class in ('A', 'B', 'C')),
  frequency_days   integer not null check (frequency_days > 0),
  last_counted_at  timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, product_id)
);

create index on public.count_schedules (tenant_id, abc_class);

create table public.cycle_counts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses(id),
  status        text not null default 'counting'
                  check (status in ('counting', 'pending_approval', 'approved', 'rejected')),
  notes         text,
  started_by    uuid,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.cycle_counts (tenant_id, warehouse_id);
create index on public.cycle_counts (tenant_id, status);

create table public.cycle_count_lines (
  id            uuid primary key default gen_random_uuid(),
  count_id      uuid not null references public.cycle_counts(id) on delete cascade,
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  -- Fotografia del sistema AL ABRIR el conteo -igual que stock_count_lines
  -- (0019)-. Nunca se muestra a quien cuenta mientras cuenta: esa es la
  -- diferencia entre un conteo ciego y uno que no lo es.
  system_qty    numeric(14,3) not null,
  counted_qty   numeric(14,3),
  unit_cost     numeric(12,4) not null default 0,
  unique (count_id, product_id)
);

create index on public.cycle_count_lines (tenant_id, count_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.count_schedules enable row level security;
alter table public.count_schedules force row level security;
alter table public.cycle_counts enable row level security;
alter table public.cycle_counts force row level security;
alter table public.cycle_count_lines enable row level security;
alter table public.cycle_count_lines force row level security;

create policy tenant_module on public.count_schedules for all
  using (tenant_id = rls.tenant_id() and rls.module_active('stock-counts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('stock-counts'));
create policy provider_impersonating on public.count_schedules for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.cycle_counts for all
  using (tenant_id = rls.tenant_id() and rls.module_active('stock-counts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('stock-counts'));
create policy provider_impersonating on public.cycle_counts for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.cycle_count_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('stock-counts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('stock-counts'));
create policy provider_impersonating on public.cycle_count_lines for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_programacion_conteo_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_programacion_conteo_ajena before insert or update on public.count_schedules
  for each row execute function public.impedir_programacion_conteo_ajena();

create function public.impedir_conteo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_almacen uuid;
begin
  select tenant_id into v_tenant_almacen from public.warehouses where id = new.warehouse_id;
  if v_tenant_almacen is distinct from new.tenant_id then
    raise exception 'Ese almacen no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_conteo_ajeno before insert or update on public.cycle_counts
  for each row execute function public.impedir_conteo_ajeno();

create function public.impedir_referencia_ajena_linea_conteo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_conteo uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_conteo from public.cycle_counts where id = new.count_id;
  if v_tenant_conteo is distinct from new.tenant_id then
    raise exception 'Ese conteo no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_linea_conteo
  before insert or update on public.cycle_count_lines
  for each row execute function public.impedir_referencia_ajena_linea_conteo();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
-- El encabezado: aprobado o rechazado es terminal -el ajuste ya se
-- decidio, y reabrirlo es empezar un conteo nuevo, no editar el viejo-.
create function public.impedir_editar_conteo_resuelto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('approved', 'rejected') then
    raise exception 'Ese conteo ya fue resuelto y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_conteo_resuelto
  before update or delete on public.cycle_counts
  for each row execute function public.impedir_editar_conteo_resuelto();

-- Las lineas: solo se escriben mientras el conteo del encabezado sigue
-- en 'counting' -una vez se pide aprobacion, lo contado queda fijo
-- para que el aprobador revise exactamente lo que se declaro, no una
-- version que alguien siga corrigiendo mientras tanto-.
create function public.impedir_editar_linea_conteo_no_editable() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  select status into v_estado from public.cycle_counts where id = old.count_id;
  if v_estado is distinct from 'counting' then
    raise exception 'Ese conteo ya no admite cambios en sus lineas.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_linea_conteo_no_editable
  before update or delete on public.cycle_count_lines
  for each row execute function public.impedir_editar_linea_conteo_no_editable();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.cycle_counts
  for each row execute function audit.record('stock-counts');
create trigger audit_me after insert or update or delete on public.cycle_count_lines
  for each row execute function audit.record('stock-counts');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Conteo ciego de verdad, con ajuste que necesita aprobacion antes de tocar el inventario',
    problem      = 'Sin conteo ciego, quien cuenta ve el numero del sistema y tiende a copiarlo -el conteo deja de servir para encontrar diferencias reales-. Sin aprobacion, cualquier ajuste entra directo, sin que nadie mas lo revise.',
    features     = '[
      {"titulo":"Clasificacion ABC real, no una tabla a mano","detalle":"El 80% del valor acumulado es clase A, el siguiente 15% es B, el resto es C -un Pareto de verdad sobre el valor anual, no una etiqueta que alguien asigna a ojo-."},
      {"titulo":"Conteo ciego","detalle":"Quien cuenta no ve el numero del sistema mientras cuenta -solo despues, al comparar-."},
      {"titulo":"El ajuste necesita aprobacion","detalle":"Contar deja el conteo esperando revision; el inventario solo se ajusta si alguien con permiso de aprobar lo aprueba."}
    ]'::jsonb,
    audience     = '{"Negocios con catalogos grandes que no pueden contar todo cada mes","Cualquiera que sospeche que sus conteos actuales estan sesgados porque quien cuenta ve el numero del sistema"}',
    faq          = '[
      {"p":"¿Reemplaza el conteo simple que ya trae inventory?","r":"No -esa version sigue disponible para un conteo rapido sin programacion ni aprobacion. Este modulo agrega las tres cosas que le faltan-."},
      {"p":"¿Que pasa si se rechaza un conteo?","r":"Queda marcado como rechazado, sin ajustar nada; hay que abrir un conteo nuevo para volver a intentarlo-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'stock-counts';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'stock-counts'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'stock-counts no tiene precio en los 3 tiers';
  end if;
end $$;

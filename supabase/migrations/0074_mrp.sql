-- ═══════════════════════════════════════════════════════════════════════
--  0074 — Planificacion MRP (modulo 57, F8.5/S52)
--
--  Explosion de necesidades real: explotarNecesidadesMrp()
--  (@regb/operations) recorre el arbol de un BOM -multinivel, igual
--  que bom.ts- y ACUMULA la necesidad bruta de cada componente por su
--  producto, sumando entre ramas que repiten la misma materia prima.
--  necesidadNeta() resta lo disponible, nunca negativa.
--
--  Cada corrida (`mrp_runs`) deja una sugerencia por componente
--  (`mrp_suggestions`): comprar (si no tiene receta activa propia) o
--  producir (si la tiene). Aceptar una sugerencia de "producir" crea
--  una orden de produccion en borrador -manufacturing es un REQUIRES
--  real, ese acoplamiento es legitimo-. Aceptar una de "comprar" NO
--  crea automaticamente una requisicion ni una orden de compra -ese
--  acoplamiento no esta declarado (`recommends`, no `requires`), y
--  crearlo en silencio violaria la regla del registry-.
-- ═══════════════════════════════════════════════════════════════════════

-- Una corrida es un hecho historico -lo que se calculo en ese
-- momento-: inmutable desde el primer insert, igual que audit.log.
create table public.mrp_runs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  target_product_id uuid not null references public.products(id),
  target_qty        numeric(14,3) not null check (target_qty > 0),
  run_at            timestamptz not null default now(),
  created_by        uuid,
  notes             text
);

create index on public.mrp_runs (tenant_id, run_at desc);

create table public.mrp_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.mrp_runs(id) on delete cascade,
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  product_id          uuid not null references public.products(id),
  action              text not null check (action in ('purchase', 'produce')),
  qty_suggested       numeric(14,3) not null check (qty_suggested > 0),
  status              text not null default 'pending'
                        check (status in ('pending', 'accepted', 'dismissed')),
  -- Solo se llena cuando una sugerencia de "producir" se acepta y crea
  -- la orden en borrador -manufacturing es requires, no recommends-.
  production_order_id uuid references public.production_orders(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index on public.mrp_suggestions (tenant_id, run_id);
create index on public.mrp_suggestions (tenant_id, status);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.mrp_runs enable row level security;
alter table public.mrp_runs force row level security;
alter table public.mrp_suggestions enable row level security;
alter table public.mrp_suggestions force row level security;

create policy tenant_module on public.mrp_runs for all
  using (tenant_id = rls.tenant_id() and rls.module_active('mrp'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('mrp'));
create policy provider_impersonating on public.mrp_runs for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.mrp_suggestions for all
  using (tenant_id = rls.tenant_id() and rls.module_active('mrp'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('mrp'));
create policy provider_impersonating on public.mrp_suggestions for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_producto_ajeno_corrida_mrp() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_producto from public.products where id = new.target_product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_producto_ajeno_corrida_mrp
  before insert on public.mrp_runs
  for each row execute function public.impedir_producto_ajeno_corrida_mrp();

create function public.impedir_referencia_ajena_sugerencia_mrp() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_corrida uuid;
  v_tenant_producto uuid;
begin
  select tenant_id into v_tenant_corrida from public.mrp_runs where id = new.run_id;
  if v_tenant_corrida is distinct from new.tenant_id then
    raise exception 'Esa corrida de MRP no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_producto from public.products where id = new.product_id;
  if v_tenant_producto is distinct from new.tenant_id then
    raise exception 'Ese producto no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_sugerencia_mrp
  before insert or update on public.mrp_suggestions
  for each row execute function public.impedir_referencia_ajena_sugerencia_mrp();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
create function public.impedir_editar_corrida_mrp() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una corrida de MRP ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_corrida_mrp
  before update or delete on public.mrp_runs
  for each row execute function public.impedir_editar_corrida_mrp();

create function public.impedir_editar_sugerencia_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status != 'pending' then
    raise exception 'Esa sugerencia ya fue resuelta y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_sugerencia_resuelta
  before update or delete on public.mrp_suggestions
  for each row execute function public.impedir_editar_sugerencia_resuelta();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert on public.mrp_runs
  for each row execute function audit.record('mrp');
create trigger audit_me after insert or update or delete on public.mrp_suggestions
  for each row execute function audit.record('mrp');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Explosion de necesidades real -la misma materia prima en varias recetas se suma, no se cuenta dos veces-',
    problem      = 'Sin esto, saber cuanto hay que comprar o producir para cumplir la demanda significa sumar recetas a mano, hoja por hoja, y es facil contar la misma materia prima dos veces si aparece en mas de un producto.',
    features     = '[
      {"titulo":"Explosion multinivel real","detalle":"Recorre el arbol completo del BOM -si un componente se produce, tambien explota SUS componentes-, sumando la misma materia prima entre ramas distintas."},
      {"titulo":"Sugerencia, no ejecucion automatica","detalle":"Aceptar una sugerencia de producir crea la orden en borrador; aceptar una de comprar queda registrado, pero no crea una orden de compra sola -eso lo decide quien compra-."},
      {"titulo":"Cada corrida queda en el historial","detalle":"Una corrida de MRP es un hecho historico -que se calculo, cuando-, no se sobrescribe con la siguiente."}
    ]'::jsonb,
    audience     = '{"Negocios que ya fabrican con bom y manufacturing y necesitan planificar que comprar o producir","Cualquiera que hoy calcule necesidades de material en una hoja de calculo aparte"}',
    faq          = '[
      {"p":"¿Crea automaticamente ordenes de compra?","r":"No -aceptar una sugerencia de comprar queda registrado como decision, pero no crea una orden de compra ni una requisicion automaticamente-."},
      {"p":"¿Considera lo que ya esta en camino de un proveedor?","r":"Todavia no -la necesidad neta resta solo el stock disponible, no las ordenes de compra pendientes de recibir-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'mrp';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'mrp'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'mrp no tiene precio en los 3 tiers';
  end if;
end $$;

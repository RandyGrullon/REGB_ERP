-- ═══════════════════════════════════════════════════════════════════════
--  0072 — Lista de materiales / BOM (modulo 55, F8.5/S50-51)
--
--  Multinivel de verdad: un componente (`bom_lines.component_product_id`)
--  puede ser el mismo producto de OTRO BOM activo, y el costeo lo
--  resuelve recursivamente (costoUnitarioMultinivel() en
--  @regb/operations) -no asume un solo nivel de componentes-.
--
--  Versiones: cada `(product_id, version)` es una fila propia; solo
--  una version por producto puede estar `active` a la vez (indice
--  unico parcial). Corregir un BOM activo significa crear la version
--  siguiente, no editar la vieja -por eso un BOM deja de ser editable
--  en cuanto sale de `draft`-.
--
--  Sustitutos: una linea puede marcar `is_substitute_for` apuntando a
--  la linea principal que reemplaza; elegirComponente()
--  (@regb/operations) decide cual usar segun el stock disponible de
--  cada uno.
-- ═══════════════════════════════════════════════════════════════════════

create table public.bill_of_materials (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  version     integer not null check (version > 0),
  status      text not null default 'draft'
                check (status in ('draft', 'active', 'obsolete')),
  output_qty  numeric(14,3) not null default 1 check (output_qty > 0),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, product_id, version)
);

-- Solo una version ACTIVA por producto a la vez.
create unique index bill_of_materials_una_activa_idx
  on public.bill_of_materials (tenant_id, product_id)
  where status = 'active';

create index on public.bill_of_materials (tenant_id, product_id);

create table public.bom_lines (
  id                    uuid primary key default gen_random_uuid(),
  bom_id                uuid not null references public.bill_of_materials(id) on delete cascade,
  tenant_id             uuid not null references regb.tenants(id) on delete cascade,
  component_product_id  uuid not null references public.products(id),
  quantity_per_unit     numeric(14,4) not null check (quantity_per_unit > 0),
  -- Nula = linea principal. Si tiene valor, ES el sustituto de esa
  -- linea principal -misma tabla, no una tabla de sustitutos aparte-.
  is_substitute_for     uuid references public.bom_lines(id),
  notes                 text
);

create index on public.bom_lines (tenant_id, bom_id);
create index on public.bom_lines (tenant_id, component_product_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.bill_of_materials enable row level security;
alter table public.bill_of_materials force row level security;
alter table public.bom_lines enable row level security;
alter table public.bom_lines force row level security;

create policy tenant_module on public.bill_of_materials for all
  using (tenant_id = rls.tenant_id() and rls.module_active('bom'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('bom'));
create policy provider_impersonating on public.bill_of_materials for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.bom_lines for all
  using (tenant_id = rls.tenant_id() and rls.module_active('bom'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('bom'));
create policy provider_impersonating on public.bom_lines for select
  using (rls.impersonating(tenant_id));

-- El mismo agujero de siempre (0031 y cada modulo de F6/F7/F8 desde
-- entonces): la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenecen las referencias.
create function public.impedir_bom_ajeno() returns trigger
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

create trigger no_bom_ajeno before insert or update on public.bill_of_materials
  for each row execute function public.impedir_bom_ajeno();

create function public.impedir_referencia_ajena_linea_bom() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_bom uuid;
  v_producto_bom uuid;
  v_tenant_componente uuid;
  v_tenant_sustituto uuid;
  v_bom_sustituto uuid;
begin
  select tenant_id, product_id into v_tenant_bom, v_producto_bom
    from public.bill_of_materials where id = new.bom_id;
  if v_tenant_bom is distinct from new.tenant_id then
    raise exception 'Ese BOM no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_componente from public.products where id = new.component_product_id;
  if v_tenant_componente is distinct from new.tenant_id then
    raise exception 'Ese componente no pertenece a esta cuenta.' using errcode = '42501';
  end if;

  -- Un producto no puede ser componente de su propio BOM -el caso
  -- directo de referencia circular; ciclos mas profundos (A usa B, B
  -- usa A) no se detectan aqui, es una limitacion conocida-.
  if new.component_product_id = v_producto_bom then
    raise exception 'Un producto no puede ser componente de su propio BOM.' using errcode = '23514';
  end if;

  if new.is_substitute_for is not null then
    select tenant_id, bom_id into v_tenant_sustituto, v_bom_sustituto
      from public.bom_lines where id = new.is_substitute_for;
    if v_tenant_sustituto is distinct from new.tenant_id then
      raise exception 'Esa linea principal no pertenece a esta cuenta.' using errcode = '42501';
    end if;
    if v_bom_sustituto is distinct from new.bom_id then
      raise exception 'El sustituto debe pertenecer al mismo BOM que la linea principal.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_linea_bom before insert or update on public.bom_lines
  for each row execute function public.impedir_referencia_ajena_linea_bom();

-- ── Inmutabilidad condicional ───────────────────────────────────────────
-- Un BOM deja de ser editable en cuanto sale de `draft`: corregirlo
-- significa crear la version siguiente, no reescribir la que ya se
-- publico o se dio de baja. Excepcion deliberada: la transicion
-- natural `active -> obsolete` -retirar una version porque otra se
-- acaba de activar- SI se permite, mientras ningun otro campo cambie;
-- eso no es corregir la receta, es su ciclo de vida normal.
create function public.impedir_editar_bom_no_borrador() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'obsolete'
     and new.product_id is not distinct from old.product_id
     and new.version is not distinct from old.version
     and new.output_qty is not distinct from old.output_qty
     and new.notes is not distinct from old.notes then
    return new;
  end if;

  if old.status != 'draft' then
    raise exception 'Ese BOM ya no esta en borrador; crea una version nueva para corregirlo.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_bom_no_borrador
  before update or delete on public.bill_of_materials
  for each row execute function public.impedir_editar_bom_no_borrador();

-- Una linea hereda la misma regla del encabezado: solo editable
-- mientras el BOM sigue en draft.
create function public.impedir_editar_linea_bom_no_borrador() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  select status into v_estado from public.bill_of_materials where id = old.bom_id;
  if v_estado is distinct from 'draft' then
    raise exception 'Ese BOM ya no esta en borrador; sus lineas no se editan.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_linea_bom_no_borrador
  before update or delete on public.bom_lines
  for each row execute function public.impedir_editar_linea_bom_no_borrador();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.bill_of_materials
  for each row execute function audit.record('bom');
create trigger audit_me after insert or update or delete on public.bom_lines
  for each row execute function audit.record('bom');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Costeo multinivel real -un componente puede tener su propia receta, y el costo se resuelve solo-',
    problem      = 'Sin esto, saber cuanto cuesta de verdad producir algo con componentes que a su vez se fabrican significa sumar a mano, hoja por hoja.',
    features     = '[
      {"titulo":"Multinivel real, no de un solo paso","detalle":"Un componente puede tener su propia receta -el costo se resuelve recursivamente, no se asume que todo se compra ya terminado-."},
      {"titulo":"Versiones, no ediciones silenciosas","detalle":"Corregir una receta activa crea la version siguiente; la version vieja queda intacta como historial."},
      {"titulo":"Sustitutos con criterio real","detalle":"Si el componente principal no tiene stock suficiente, el sustituto declarado entra en su lugar -o se marca faltante real, nunca se inventa disponibilidad-."}
    ]'::jsonb,
    audience     = '{"Negocios que fabrican o ensamblan lo que venden","Cualquiera que hoy calcule el costo de produccion en una hoja de calculo aparte"}',
    faq          = '[
      {"p":"¿Detecta un ciclo donde A usa B y B usa A?","r":"Solo el caso directo -un producto no puede ser componente de su propio BOM-. Un ciclo mas profundo entre varios productos no se detecta todavia."},
      {"p":"¿Puedo tener dos versiones activas del mismo producto?","r":"No -solo una version puede estar activa a la vez. Activar una version nueva es una decision explicita, no automatica-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'bom';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'bom'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'bom no tiene precio en los 3 tiers';
  end if;
end $$;

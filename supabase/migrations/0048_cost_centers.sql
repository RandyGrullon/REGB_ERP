-- ═══════════════════════════════════════════════════════════════════════
--  0048 — Centros de costo (modulo 23, F6/S35)
--
--  Distribucion, prorrateo y rentabilidad por centro. El prorrateo -la
--  parte que de verdad necesita logica propia- vive en splitAmount()
--  (@regb/operations): reparte un monto entre varios centros por peso
--  relativo, dejando que el ULTIMO centro absorba el residuo de redondeo
--  para que la suma cuadre exacto contra el total. Esta migracion solo
--  guarda el RESULTADO de ese reparto -cada asignacion ya calculada-, no
--  reimplementa el prorrateo en SQL.
--
--  A diferencia de `budgets`, este modulo NO exige `accounting`: una
--  asignacion puede ser manual (un gasto que se reparte entre sucursales
--  sin pasar por un asiento) o puede etiquetar una linea de asiento ya
--  existente si `accounting` esta activo. El catalogo (0009) ya traia
--  requires='{}' para este, y aqui SI es correcto -no hay una tabla
--  externa que las asignaciones deban referenciar obligatoriamente-.
--
--  Rentabilidad por centro se deja para una mejora: requiere atribuir
--  tambien el INGRESO por centro, no solo el costo, y eso es una decision
--  de negocio (¿por sucursal que vendio? ¿por vendedor?) que este primer
--  corte no asume. Declarado en la ficha, no escondido.
-- ═══════════════════════════════════════════════════════════════════════

create table public.cost_centers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index on public.cost_centers (tenant_id, is_active);

create table public.cost_center_allocations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  cost_center_id  uuid not null references public.cost_centers(id),
  allocation_date date not null default current_date,
  amount          numeric(12,2) not null check (amount > 0),
  description     text not null,
  -- De donde salio: escrita a mano, o la etiqueta de una linea de asiento
  -- ya existente (si accounting esta activo -no es obligatorio-).
  source_type     text not null default 'manual' check (source_type in ('manual', 'journal_entry')),
  source_id       uuid,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  check (source_type = 'manual' or source_id is not null)
);

create index on public.cost_center_allocations (tenant_id, cost_center_id, allocation_date desc);

comment on column public.cost_center_allocations.source_id is
  'Si source_type=journal_entry, apunta a una fila de public.journal_entry_lines -sin FK fisica: accounting es opcional para este modulo, y una FK obligaria a que siempre exista-.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('cost_centers',            'cost-centers'),
      ('cost_center_allocations', 'cost-centers')
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

-- El mismo agujero de siempre (0031/0040/accounting/ap/treasury/bank-rec/
-- fixed-assets/budgets), tapado desde el primer dia: la RLS de insert solo
-- compara el tenant_id de la fila nueva, no a quien pertenece
-- cost_center_id. source_id NO se valida por FK a proposito (ver
-- comentario de columna), asi que tampoco hay una referencia externa que
-- verificar ahi.
create function public.impedir_asignacion_centro_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.cost_centers where id = new.cost_center_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese centro de costo no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_asignacion_centro_ajeno before insert on public.cost_center_allocations
  for each row execute function public.impedir_asignacion_centro_ajeno();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.cost_centers
  for each row execute function audit.record('cost-centers');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{accounting,budgets}',
    tagline      = 'Sabe cuanto cuesta de verdad cada sucursal, proyecto o departamento',
    problem      = 'El gasto general -luz, alquiler, nomina administrativa- se paga una sola vez pero pertenece a varias partes del negocio, y repartirlo a mano en una hoja de calculo cada mes es el trabajo que nadie quiere hacer, asi que casi nunca se hace.',
    features     = '[
      {"titulo":"Prorrateo que cuadra exacto","detalle":"Reparte un monto entre varios centros por peso -no hace falta que sumen 100-, y la suma de las partes da EXACTO el total: nunca un centavo perdido por redondeo."},
      {"titulo":"Asignacion manual o etiquetando un asiento","detalle":"Un gasto se reparte a mano, o -si contabilidad esta activa- se etiqueta directamente sobre la linea del asiento que ya lo registro."},
      {"titulo":"Funciona sin contabilidad","detalle":"No exige accounting: sirve solo para llevar la cuenta de cuanto se le atribuye a cada sucursal o departamento, aunque contabilidad no este activa todavia."},
      {"titulo":"Historial nunca se pierde","detalle":"Cada asignacion queda con su fecha, su descripcion y su origen -manual o de que asiento salio-."}
    ]'::jsonb,
    audience     = '{"Negocios con varias sucursales","Distribuidoras con gastos compartidos entre departamentos","Negocios que ya usan accounting y quieren repartir el gasto general"}',
    faq          = '[
      {"p":"¿Necesito contabilidad para usarlo?","r":"No. Puedes llevar centros de costo solo con asignaciones manuales. Si accounting esta activo, ademas puedes etiquetar una linea de asiento con su centro."},
      {"p":"¿Calcula la rentabilidad por centro?","r":"Todavia no: eso pide atribuir tambien el ingreso por centro, una decision de negocio -por sucursal que vendio, por vendedor- que este primer corte no asume."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'cost-centers';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'cost-centers'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'cost-centers no tiene precio en los 3 tiers';
  end if;
end $$;

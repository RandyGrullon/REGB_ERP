-- ═══════════════════════════════════════════════════════════════════════
--  0047 — Presupuestos (modulo 22, F6/S35)
--
--  Por cuenta, mes por mes. El catalogo (§5.2) tambien promete "por
--  centro o proyecto" -esas dos dimensiones no existen todavia (centro
--  llega con `cost-centers`, proyecto ya existe como modulo 71 pero
--  presupuestar contra el es una extension futura), asi que este primer
--  corte presupuesta por CUENTA, la unica dimension real disponible hoy.
--  Documentado en la ficha, no prometido de mas.
--
--  DEPENDE de `accounting`: budget_lines referencia public.accounts -sin
--  cuentas no hay contra que presupuestar-. El catalogo (0009) trae
--  requires='{}' para este modulo porque se sembro antes de decidir esto;
--  se corrige aqui mismo, igual que la 0043 corrigio el mismo tipo de
--  desincronizacion para accounting/ap.
--
--  Una LINEA de presupuesto SI se edita libremente mientras el presupuesto
--  este en 'draft' o 'active' -es un plan, no un movimiento de dinero ya
--  ocurrido, a diferencia de un asiento o un movimiento bancario-. Solo se
--  congela cuando el presupuesto se marca 'closed'.
-- ═══════════════════════════════════════════════════════════════════════

create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  name         text not null,
  fiscal_year  smallint not null,
  status       text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, fiscal_year, name)
);

create index on public.budgets (tenant_id, fiscal_year);

create table public.budget_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  budget_id     uuid not null references public.budgets(id) on delete cascade,
  account_id    uuid not null references public.accounts(id),
  period_month  smallint not null check (period_month between 1 and 12),
  amount        numeric(12,2) not null check (amount >= 0),
  unique (tenant_id, budget_id, account_id, period_month)
);

create index on public.budget_lines (tenant_id, budget_id);
create index on public.budget_lines (tenant_id, account_id);

comment on column public.budget_lines.amount is
  'En la direccion normal de la cuenta: para gasto, cuanto se planea gastar; para ingreso, cuanto se espera ganar. Ver accountBalance() en @regb/operations -la misma formula lee el real en la misma direccion-.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('budgets',      'budgets'),
      ('budget_lines', 'budgets')
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
-- fixed-assets), tapado desde el primer dia: la RLS de insert solo
-- compara el tenant_id de la fila nueva, no a quien pertenecen budget_id
-- ni account_id.
create function public.impedir_linea_presupuesto_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_presupuesto uuid;
  v_tenant_cuenta      uuid;
begin
  select tenant_id into v_tenant_presupuesto from public.budgets where id = new.budget_id;
  if v_tenant_presupuesto is distinct from new.tenant_id then
    raise exception 'Ese presupuesto no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_cuenta from public.accounts where id = new.account_id;
  if v_tenant_cuenta is distinct from new.tenant_id then
    raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_linea_presupuesto_ajena before insert or update on public.budget_lines
  for each row execute function public.impedir_linea_presupuesto_ajena();

-- ── Un presupuesto cerrado se congela ────────────────────────────────────
create function public.impedir_editar_presupuesto_cerrado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'Un presupuesto cerrado no se edita: abre uno nuevo si hace falta revisar el plan.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_presupuesto_cerrado
  before update or delete on public.budgets
  for each row execute function public.impedir_editar_presupuesto_cerrado();

create function public.impedir_editar_linea_presupuesto_cerrado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.budgets where id = coalesce(new.budget_id, old.budget_id);
  if v_status = 'closed' then
    raise exception 'Un presupuesto cerrado no se edita: abre uno nuevo si hace falta revisar el plan.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_linea_presupuesto_cerrado
  before update or delete on public.budget_lines
  for each row execute function public.impedir_editar_linea_presupuesto_cerrado();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.budgets
  for each row execute function audit.record('budgets');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia. Se corrige `requires`
--  de '{}' a '{accounting}' -ver comentario de cabecera-.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{accounting}',
    recommends   = '{cost-centers}',
    tagline      = 'Sabe si el gasto de este mes va segun el plan o se salio de control',
    problem      = 'El presupuesto vive en una hoja de calculo que nadie actualiza, y para cuando el gerente revisa cuanto se gasto de verdad ya paso el mes -y el dinero-.',
    features     = '[
      {"titulo":"Por cuenta y por mes","detalle":"Cada cuenta del catalogo puede tener su propio monto planeado mes a mes -mas marketing en diciembre, menos en enero-, no un numero anual repartido a partes iguales."},
      {"titulo":"Real contra presupuesto, siempre actualizado","detalle":"El real sale directo de los asientos contabilizados -no hay que teclearlo aparte-, y se compara en la misma direccion normal de la cuenta: gasto contra gasto, ingreso contra ingreso."},
      {"titulo":"Alerta antes de pasarse, no despues","detalle":"En 90% de lo presupuestado ya avisa en amarillo -no hay que esperar a que se pase del 100% para enterarse-."},
      {"titulo":"Cerrar congela el plan","detalle":"Mientras esta en borrador o activo, el presupuesto se edita libremente -es un plan, no un movimiento de dinero-. Cerrarlo lo deja fijo como referencia historica."},
      {"titulo":"Sin presupuesto declarado, la alerta es la mas seria","detalle":"Gastar en una cuenta que nadie presupuesto avisa en rojo desde el primer peso -es la senal de un gasto que no se planeo en absoluto-."}
    ]'::jsonb,
    audience     = '{"Negocios que ya usan contabilidad","Gerentes que necesitan controlar el gasto mes a mes","Distribuidoras con presupuesto de marketing o de flota"}',
    faq          = '[
      {"p":"¿Necesito contabilidad para usarlo?","r":"Si -el presupuesto se compara contra las mismas cuentas del catalogo de accounting, y el real sale de sus asientos contabilizados-."},
      {"p":"¿Puedo presupuestar por centro de costo o por proyecto?","r":"Todavia no: hoy el presupuesto es por cuenta. Presupuestar por centro llega con el modulo cost-centers."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'budgets';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'budgets'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'budgets no tiene precio en los 3 tiers';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  0052 — Nomina (modulo 62, F7/S37-38)
--
--  TSS, ISR, prestaciones, regalia y volantes. La ARITMETICA (tasas de
--  AFP/SFS, tramos de ISR) vive en calculatePayrollLine() de
--  @regb/operations, NO aqui: SQL solo guarda el resultado ya calculado.
--  Reimplementar tramos progresivos de impuesto en PL/pgSQL duplicaria la
--  logica en dos lenguajes -exactamente el error que post_journal_entry()
--  evito en accounting (0041) al mantener el debito=credito en los dos
--  lados a proposito, pero aqui NO hace falta un espejo en SQL porque
--  nada mas que este modulo inserta una linea de nomina-.
--
--  `tax_params` guarda una FOTO de las tasas usadas al procesar cada
--  periodo -si el ISR cambia el ano que viene (cambia TODOS los anos por
--  ajuste inflacionario), las nominas ya procesadas no se recalculan
--  solas con la tasa nueva-.
--
--  Un periodo procesado o pagado es inmutable, mismo criterio que un
--  asiento contabilizado (0041) o un presupuesto cerrado (0047): la
--  nomina calculada y comunicada a un empleado no se corrige por encima,
--  se corrige con un ajuste aparte en el siguiente periodo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.payroll_periods (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  pay_date     date not null,
  status       text not null default 'draft' check (status in ('draft', 'processed', 'paid')),
  -- Foto de las tasas usadas -null mientras sigue en borrador, porque
  -- todavia no se proceso con ninguna-.
  tax_params   jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, period_start, period_end),
  check (period_end >= period_start),
  check (status = 'draft' or tax_params is not null)
);

create index on public.payroll_periods (tenant_id, status, period_end desc);

create table public.payroll_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  period_id         uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id       uuid not null references public.employees(id),
  gross_salary      numeric(12,2) not null check (gross_salary >= 0),
  tss_deduction     numeric(12,2) not null check (tss_deduction >= 0),
  income_tax        numeric(12,2) not null check (income_tax >= 0),
  other_deductions  numeric(12,2) not null default 0 check (other_deductions >= 0),
  net_salary        numeric(12,2) not null check (net_salary >= 0),
  created_at        timestamptz not null default now(),
  unique (tenant_id, period_id, employee_id)
);

create index on public.payroll_lines (tenant_id, period_id);
create index on public.payroll_lines (tenant_id, employee_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('payroll_periods', 'payroll'),
      ('payroll_lines',   'payroll')
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
-- fixed-assets/budgets/cost-centers/payments/employees), tapado desde el
-- primer dia: la RLS de insert solo compara el tenant_id de la fila
-- nueva, no a quien pertenece employee_id.
create function public.impedir_linea_nomina_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.employees where id = new.employee_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese empleado no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_linea_nomina_ajena before insert on public.payroll_lines
  for each row execute function public.impedir_linea_nomina_ajena();

-- ── Un periodo procesado o pagado es inmutable ───────────────────────────
create function public.impedir_editar_periodo_procesado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Un periodo procesado no se edita: corrige con el siguiente periodo.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_periodo_procesado
  before update or delete on public.payroll_periods
  for each row execute function public.impedir_editar_periodo_procesado();

-- Antes de insert TAMBIEN, no solo update/delete: sin esto, un periodo ya
-- procesado seguia aceptando lineas nuevas -el hueco se encontro escribiendo
-- el test de inmutabilidad, que esperaba el mensaje de "no se edita" y en
-- cambio recibio una violacion de unicidad, prueba de que el insert nunca
-- llego a bloquearse por el periodo procesado-.
create function public.impedir_editar_linea_procesada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.payroll_periods
  where id = coalesce(new.period_id, old.period_id);

  if v_status <> 'draft' then
    raise exception 'Un periodo procesado no se edita: corrige con el siguiente periodo.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_linea_procesada
  before insert or update or delete on public.payroll_lines
  for each row execute function public.impedir_editar_linea_procesada();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.payroll_periods
  for each row execute function audit.record('payroll');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{employees}',
    recommends   = '{accounting}',
    tagline      = 'Calcula TSS e ISR correctos, sin pelear con la hoja de calculo cada quincena',
    problem      = 'Calcular TSS e ISR a mano -o en una hoja de calculo que alguien arma de memoria cada vez- es donde una nomina se equivoca: un tramo de ISR mal aplicado, o un tope de cotizacion que se le olvida a alguien, y el empleado cobra mal.',
    features     = '[
      {"titulo":"TSS e ISR calculados, no adivinados","detalle":"AFP y SFS con su tope de cotizacion, ISR con la tabla progresiva real -incluida la parte que casi nadie hace bien: proyectar el mes a un ano para encontrar el tramo correcto-."},
      {"titulo":"Cada periodo guarda las tasas que uso","detalle":"El ISR se ajusta cada ano por inflacion. Cuando cambie, las nominas ya procesadas de anos anteriores no se recalculan solas con la tasa nueva -quedan con la foto de lo que de verdad se aplico-."},
      {"titulo":"Un periodo procesado queda fijo","detalle":"Ni una linea de nomina ni el periodo se editan despues de procesar -se corrige con el siguiente periodo, nunca reescribiendo lo que el empleado ya vio-."},
      {"titulo":"Regalia y prestaciones con la formula real","detalle":"La regalia pascual como un doceavo de lo devengado, y el calculo base de cesantia y preaviso por antiguedad -el caso general del Codigo de Trabajo, no cada excepcion legal-."}
    ]'::jsonb,
    audience     = '{"Negocios con empleados formales","Cualquiera que ya use el modulo de empleados","Negocios que hoy calculan la nomina en Excel"}',
    faq          = '[
      {"p":"¿Las tasas de TSS e ISR estan actualizadas?","r":"Las que trae el sistema son las conocidas al momento de construirlo. El ISR se ajusta cada ano por la DGII: siempre hay que verificarlas contra la tabla vigente antes de procesar una nomina real -el sistema guarda que tasas uso cada periodo, precisamente para poder auditar esto despues-."},
      {"p":"¿Genera el archivo que pide el portal de la TSS?","r":"Todavia no: este primer corte calcula y guarda el desglose por empleado, pero no genera el formato de archivo especifico que exige cada portal -eso es una integracion aparte."}
    ]'::jsonb,
    setup_minutes = 30
where id = 'payroll';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'payroll'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'payroll no tiene precio en los 3 tiers';
  end if;
end $$;

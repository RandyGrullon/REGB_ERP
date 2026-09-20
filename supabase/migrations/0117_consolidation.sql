-- ═══════════════════════════════════════════════════════════════════════
--  0117 — Consolidacion (modulo 28, F11/S80)
--
--  Suma los estados de varias empresas del mismo cliente en una sola
--  balanza de grupo, quitando lo que se deben entre ellas. Si A le facturo
--  a B, ese ingreso y ese gasto NO son del grupo: contarlos seria declarar
--  una venta que nunca salio de la familia.
--
--  ANTES DE ESTA MIGRACION EL MODULO ERA IMPOSIBLE. `public.journal_entries`
--  no tenia `company_id`: la contabilidad era del CLIENTE, no de la
--  empresa, asi que no habia forma de separar los estados de dos razones
--  sociales. Se agrega esa columna desde aqui -precedente en el repo: la
--  0062 altera `customers` desde price-lists y la 0066 altera `products`
--  desde lots-serials-. Sin ella esto seria una hoja de calculo con RLS.
--
--  QUE SE CONGELA Y QUE NO. Se congela la ENTRADA (consolidation_run_
--  balances: la foto de cuanto aporto cada empresa en cada cuenta), nunca
--  el RESULTADO. No existe una tabla `consolidation_lines` a proposito: la
--  0041 ya fijo la regla del repo -"el mayor y la balanza NO son tablas:
--  se derivan... un saldo guardado se desincroniza el dia que algo se
--  corrija"-. El consolidado se deriva entero de la foto mas las
--  eliminaciones, en buildConsolidationWorksheet() (@regb/operations).
--
--  La foto SI hace falta: un asiento con fecha atrasada puede entrar
--  manana y cambiar el pasado. Mismo criterio que payroll_periods.
--  tax_params (0052) -se guarda con que numeros se calculo, no el numero-.
--
--  UNA CORRIDA CERRADA ES INMUTABLE, igual que un asiento contabilizado
--  (0041) o un periodo de nomina procesado (0052): un consolidado que ya
--  se entrego no se corrige por encima, se hace otro.
--
--  Deliberadamente SIN interes minoritario, SIN traduccion de moneda y SIN
--  emparejamiento automatico de operaciones inter-compania. Ver la ficha:
--  docs/modules/consolidation.md.
-- ═══════════════════════════════════════════════════════════════════════

-- ── El hueco que tapa este modulo ───────────────────────────────────────
--  Nullable a proposito: la pantalla de contabilidad todavia no pregunta a
--  que empresa pertenece el asiento -eso es un cambio de `accounting`, no
--  de este modulo- y obligar a llenarla romperia todo lo ya capturado. Un
--  asiento sin empresa se lee como de la empresa principal (is_default):
--  antes de que existiera multi-empresa, todo era de ella. La pantalla de
--  la corrida dice EN NUMERO cuantos asientos estan sin etiquetar, en vez
--  de esconder el supuesto.
alter table public.journal_entries add column company_id uuid references public.companies(id);

create index on public.journal_entries (tenant_id, company_id);

comment on column public.journal_entries.company_id is
  'A que razon social del cliente pertenece el asiento. Null = la empresa is_default, por compatibilidad con todo lo capturado antes de multi-empresa. Lo lee `consolidation` (0117).';

-- El agujero de siempre, ahora tambien aqui: la RLS de insert solo compara
-- el tenant_id de la fila nueva, no a quien pertenece company_id.
create function public.impedir_asiento_de_empresa_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.company_id is null then
    return new;
  end if;
  select tenant_id into v_tenant from public.companies where id = new.company_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa empresa no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- El nombre importa: los triggers de la misma tabla y momento disparan en
-- orden alfabetico, y `no_editar_contabilizado` va antes que
-- `no_empresa_ajena`. Asi, al intentar editar un asiento ya contabilizado,
-- el usuario recibe el mensaje que de verdad explica lo que pasa.
create trigger no_empresa_ajena before insert or update on public.journal_entries
  for each row execute function public.impedir_asiento_de_empresa_ajena();

-- ── El grupo empresarial ────────────────────────────────────────────────
--  Un cliente puede tener mas de un grupo: un holding con dos ramas que se
--  reportan por separado no es un caso raro, es el caso normal de quien
--  compra este modulo.
create table public.consolidation_groups (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references regb.tenants(id) on delete cascade,
  name                  text not null,
  presentation_currency char(3) not null default 'DOP',
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (tenant_id, name)
);

create index on public.consolidation_groups (tenant_id, is_active);

-- Sin ownership_pct a proposito: este corte consolida al 100% (integracion
-- global) y el interes minoritario esta declarado como no-hace. Una columna
-- de porcentaje que nadie lee seria fingir que la consolidacion parcial
-- existe, y alguien la llenaria creyendo que hace algo.
create table public.consolidation_group_members (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  group_id   uuid not null references public.consolidation_groups(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  is_parent  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, group_id, company_id)
);

-- Una sola matriz por grupo, mismo truco del indice parcial con el que
-- `companies` garantiza una sola empresa principal por cliente (0003).
create unique index on public.consolidation_group_members (tenant_id, group_id) where is_parent;

-- ── La corrida de un periodo ────────────────────────────────────────────
--  group_id SIN `on delete cascade`, a diferencia de los miembros: si
--  borrar el grupo arrastrara sus corridas, un consolidado ya cerrado y
--  entregado desapareceria con un clic. Asi la base directamente impide
--  borrar un grupo que tiene historia.
create table public.consolidation_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  group_id     uuid not null references public.consolidation_groups(id),
  period_start date not null,
  period_end   date not null,
  status       text not null default 'draft' check (status in ('draft','closed')),
  closed_at    timestamptz,
  -- Los asientos sin empresa que vio ESTA corrida, congelados junto con
  -- la foto y no leidos en vivo: si manana alguien los etiqueta, o entra
  -- al grupo la empresa principal, un consolidado ya entregado tiene que
  -- seguir diciendo lo mismo. `unlabeled_included` distingue los dos
  -- casos que la pantalla confundia: se sumaron a la principal, o se
  -- cayeron de la foto porque la principal no es miembro de este grupo.
  unlabeled_entries  integer       not null default 0 check (unlabeled_entries >= 0),
  unlabeled_amount   numeric(12,2) not null default 0 check (unlabeled_amount >= 0),
  unlabeled_included boolean       not null default false,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, group_id, period_start, period_end),
  check (period_end >= period_start),
  -- Una corrida cerrada sin fecha de cierre no se puede auditar: "¿cuando
  -- se entrego este consolidado?" no deberia depender de la bitacora.
  check (status = 'draft' or closed_at is not null)
);

create index on public.consolidation_runs (tenant_id, group_id, period_end desc);

-- ── La foto de entrada ──────────────────────────────────────────────────
create table public.consolidation_run_balances (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  run_id       uuid not null references public.consolidation_runs(id) on delete cascade,
  company_id   uuid not null references public.companies(id),
  account_id   uuid not null references public.accounts(id),
  total_debit  numeric(12,2) not null default 0 check (total_debit >= 0),
  total_credit numeric(12,2) not null default 0 check (total_credit >= 0),
  created_at   timestamptz not null default now(),
  unique (tenant_id, run_id, company_id, account_id),
  -- Una fila en cero no es informacion, es ruido: la hoja de trabajo ya
  -- pinta en cero la empresa que no movio esa cuenta.
  check (total_debit > 0 or total_credit > 0)
);

create index on public.consolidation_run_balances (tenant_id, run_id);

-- ── Lo que se quita ─────────────────────────────────────────────────────
--  Una eliminacion es un PAR (una cuenta al debito, una al credito, un
--  solo monto), no una lista de lineas. Asi no puede descuadrar el grupo
--  por construccion, y no hace falta un post_journal_entry() que lo vigile.
--  Los casos de tres patas -quitar el margen de un inventario comprado al
--  grupo junto con su impuesto diferido- se capturan como dos eliminaciones
--  separadas.
create table public.consolidation_eliminations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  run_id            uuid not null references public.consolidation_runs(id) on delete cascade,
  from_company_id   uuid not null references public.companies(id),
  to_company_id     uuid not null references public.companies(id),
  debit_account_id  uuid not null references public.accounts(id),
  credit_account_id uuid not null references public.accounts(id),
  amount            numeric(12,2) not null check (amount > 0),
  kind              text not null default 'other'
                      check (kind in ('revenue_expense','receivable_payable','dividend','other')),
  description       text not null,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  -- Eliminarse contra uno mismo no es una eliminacion.
  check (from_company_id <> to_company_id),
  check (debit_account_id <> credit_account_id)
);

create index on public.consolidation_eliminations (tenant_id, run_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('consolidation_groups',        'consolidation'),
      ('consolidation_group_members', 'consolidation'),
      ('consolidation_runs',          'consolidation'),
      ('consolidation_run_balances',  'consolidation'),
      ('consolidation_eliminations',  'consolidation')
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

-- ═══════════════════════════════════════════════════════════════════════
--  El agujero de siempre, cinco veces
--
--  Cinco tablas con llaves foraneas a companies, accounts y entre ellas:
--  la RLS de insert solo compara el tenant_id de la FILA NUEVA, nunca a
--  quien pertenece lo referenciado. Sin estos triggers, alguien podia
--  colar una fila con SU propio tenant_id -que pasa la RLS- apuntando al
--  grupo, la corrida, la empresa o la cuenta de otro cliente.
--
--  UNA FUNCION POR TABLA, no una generica: NEW es RECORD en PL/pgSQL y el
--  nombre de columna se resuelve en tiempo de ejecucion contra la tabla
--  real del trigger, asi que una funcion compartida revienta con "record
--  new has no field" en cuanto las formas de fila no coinciden. Esta
--  leccion ya esta escrita en la 0041.
-- ═══════════════════════════════════════════════════════════════════════

create function public.impedir_miembro_de_grupo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_tenant   uuid;
  v_group_currency char(3);
  v_comp_tenant    uuid;
  v_comp_currency  char(3);
begin
  select tenant_id, presentation_currency into v_group_tenant, v_group_currency
  from public.consolidation_groups where id = new.group_id;
  if v_group_tenant is distinct from new.tenant_id then
    raise exception 'Ese grupo de consolidacion no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id, currency into v_comp_tenant, v_comp_currency
  from public.companies where id = new.company_id;
  if v_comp_tenant is distinct from new.tenant_id then
    raise exception 'Esa empresa no pertenece a ese cliente.' using errcode = '42501';
  end if;

  -- Este corte NO traduce moneda. Dejar entrar una empresa en USD a un
  -- grupo que presenta en DOP produciria una suma sin ningun sentido, y
  -- una nota al pie no impide que alguien la lea como un numero real:
  -- mejor cerrar la puerta en la base.
  if v_comp_currency is distinct from v_group_currency then
    raise exception 'Esa empresa lleva % y el grupo presenta en %: la consolidacion no traduce moneda.',
      v_comp_currency, v_group_currency using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger no_miembro_de_grupo_ajeno before insert or update
  on public.consolidation_group_members
  for each row execute function public.impedir_miembro_de_grupo_ajeno();

-- La otra puerta de la misma habitacion. La funcion de arriba cierra la
-- moneda al AGREGAR una empresa, pero el grupo se podia cambiar despues:
-- con dos empresas en DOP ya dentro, un update de presentation_currency a
-- USD dejaba los mismos pesos impresos en la cabecera y en las tres
-- tarjetas con la etiqueta USD. No hay conversion ninguna -este corte no
-- traduce moneda-, solo una etiqueta nueva encima de los mismos numeros.
create function public.impedir_cambiar_moneda_del_grupo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.presentation_currency is distinct from old.presentation_currency then
    -- Un consolidado ya entregado no cambia de moneda ni aunque hoy las
    -- empresas coincidan: lo que se imprimio en enero tiene que leerse
    -- igual en marzo. Si el grupo va a presentar en otra moneda, es otro
    -- grupo.
    if exists (select 1 from public.consolidation_runs r
               where r.group_id = old.id and r.status = 'closed') then
      raise exception 'Ese grupo ya tiene consolidados cerrados en %: la moneda de presentacion no se cambia, se arma otro grupo.',
        old.presentation_currency using errcode = '55000';
    end if;

    if exists (select 1 from public.consolidation_group_members m
               join public.companies c on c.id = m.company_id
               where m.group_id = old.id
                 and c.currency is distinct from new.presentation_currency) then
      raise exception 'El grupo ya tiene empresas en %: la consolidacion no traduce moneda.',
        old.presentation_currency using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_cambiar_moneda_del_grupo before update
  on public.consolidation_groups
  for each row execute function public.impedir_cambiar_moneda_del_grupo();

create function public.impedir_corrida_de_grupo_ajeno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.consolidation_groups where id = new.group_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese grupo de consolidacion no pertenece a ese cliente.' using errcode = '42501';
  end if;

  -- Una corrida que ya tiene foto no cambia de grupo ni de periodo. Nada
  -- recalcula la foto al moverla, asi que la corrida acabaria colgando de
  -- un grupo cuyos miembros no son las empresas de sus saldos -y la
  -- comprobacion de pertenencia de las eliminaciones mediria contra el
  -- grupo equivocado-, o imprimiendo en la cabecera un periodo que la
  -- foto nunca miro. Si el periodo estaba mal, se genera otra corrida.
  --
  -- `old.status = 'draft'` no es una excusa, es el mensaje: los triggers
  -- de la misma tabla disparan en orden alfabetico y este va antes que
  -- `no_editar_corrida_cerrada`. Sobre una corrida CERRADA el usuario
  -- tiene que leer que esta cerrada -que es lo que de verdad pasa-, no
  -- que su foto esta congelada. Misma leccion que el orden de
  -- `no_editar_contabilizado` contra `no_empresa_ajena` aqui arriba.
  if tg_op = 'UPDATE'
     and old.status = 'draft'
     and (new.group_id, new.period_start, new.period_end)
         is distinct from (old.group_id, old.period_start, old.period_end)
     and exists (select 1 from public.consolidation_run_balances b where b.run_id = old.id) then
    raise exception 'Esa corrida ya tiene su foto congelada: el grupo y el periodo no se cambian, se genera otra corrida.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger no_corrida_de_grupo_ajeno before insert or update
  on public.consolidation_runs
  for each row execute function public.impedir_corrida_de_grupo_ajeno();

-- Copia exacta del criterio de impedir_editar_entry_contabilizado (0041).
create function public.impedir_editar_corrida_cerrada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'Esa corrida ya esta cerrada: un consolidado entregado no se corrige, se hace otro.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_corrida_cerrada before update or delete
  on public.consolidation_runs
  for each row execute function public.impedir_editar_corrida_cerrada();

-- La foto valida TRES tenant en la misma funcion -corrida, empresa y
-- cuenta-, igual que impedir_editar_linea_contabilizada valida entry_id y
-- account_id de una vez (0041). Cubre tambien el DELETE: borrar la foto de
-- una corrida cerrada la dejaria sin la entrada de la que se deriva, que es
-- otra forma de corregirla por encima.
create function public.impedir_saldo_de_corrida_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_tenant uuid;
  v_run_status text;
  v_group      uuid;
  v_viejo      text;
  v_tenant     uuid;
begin
  -- Las DOS puntas del update, no solo el destino. Mirando unicamente
  -- new.run_id, mover la foto de una corrida CERRADA a un borrador
  -- pasaba limpio: el trigger evaluaba el estado del destino. La corrida
  -- entregada se quedaba en cero -y sin rastro, porque esta tabla no
  -- lleva bitacora a proposito- mientras el borrador declaraba como
  -- suyos unos saldos que eran de otro periodo.
  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_viejo
    from public.consolidation_runs where id = old.run_id;
    if v_viejo = 'closed' then
      raise exception 'Esa corrida ya esta cerrada: su foto de saldos no se toca.'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select tenant_id, status, group_id into v_run_tenant, v_run_status, v_group
  from public.consolidation_runs where id = new.run_id;

  if v_run_status = 'closed' then
    raise exception 'Esa corrida ya esta cerrada: su foto de saldos no se toca.'
      using errcode = '55000';
  end if;

  if v_run_tenant is distinct from new.tenant_id then
    raise exception 'Esa corrida no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from public.companies where id = new.company_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa empresa no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from public.accounts where id = new.account_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
  end if;

  -- La tabla que SUMA dinero valida la pertenencia al grupo igual que la
  -- que lo RESTA. Sin esto, una empresa del mismo cliente que nunca entro
  -- al grupo se colaba como una columna mas de la hoja -que se pinta
  -- desde la foto, no desde los miembros de hoy- y su saldo se sumaba al
  -- consolidado sin descuadrar nada: la fila entra por un solo lado bien
  -- formado, asi que debito sigue igual a credito.
  if not exists (
        select 1 from public.consolidation_group_members m
        where m.group_id = v_group and m.tenant_id = new.tenant_id
          and m.company_id = new.company_id) then
    raise exception 'Esa empresa no es miembro del grupo de esa corrida.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_saldo_de_corrida_ajena before insert or update or delete
  on public.consolidation_run_balances
  for each row execute function public.impedir_saldo_de_corrida_ajena();

-- Cinco tenant que comparar, mas una regla que ninguna llave foranea puede
-- expresar: las dos empresas de una eliminacion tienen que ser miembros del
-- grupo de ESA corrida. Sin eso, se podria eliminar contra una empresa del
-- mismo cliente que no entra en el consolidado, y el grupo cerraria con un
-- ingreso quitado que nunca estuvo sumado.
create function public.impedir_eliminacion_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_tenant uuid;
  v_run_status text;
  v_group      uuid;
  v_viejo      text;
  v_tenant     uuid;
begin
  -- Las DOS puntas del update, por lo mismo que en la foto de saldos:
  -- mover las eliminaciones de una corrida cerrada a un borrador las
  -- sacaba del consolidado ya entregado sin que nada se quejara.
  if tg_op in ('UPDATE', 'DELETE') then
    select status into v_viejo
    from public.consolidation_runs where id = old.run_id;
    if v_viejo = 'closed' then
      raise exception 'Esa corrida ya esta cerrada: sus eliminaciones no se tocan.'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  select tenant_id, status, group_id into v_run_tenant, v_run_status, v_group
  from public.consolidation_runs where id = new.run_id;

  if v_run_status = 'closed' then
    raise exception 'Esa corrida ya esta cerrada: sus eliminaciones no se tocan.'
      using errcode = '55000';
  end if;

  if v_run_tenant is distinct from new.tenant_id then
    raise exception 'Esa corrida no pertenece a ese cliente.' using errcode = '42501';
  end if;

  -- Cada empresa se verifica por separado y no con un `count(*) ... in
  -- (from, to)`: cuando las dos columnas traen la MISMA empresa, contar da
  -- uno y el trigger acusaria "empresa ajena" tapando el error de verdad,
  -- que es el check de la tabla -eliminarse contra uno mismo-. Un trigger
  -- que miente sobre la causa cuesta mas caro que uno que no existe.
  select tenant_id into v_tenant from public.companies where id = new.from_company_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa empresa no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from public.companies where id = new.to_company_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa empresa no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from public.accounts where id = new.debit_account_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
  end if;

  select tenant_id into v_tenant from public.accounts where id = new.credit_account_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
  end if;

  if not exists (
        select 1 from public.consolidation_group_members m
        where m.group_id = v_group and m.tenant_id = new.tenant_id
          and m.company_id = new.from_company_id)
     or not exists (
        select 1 from public.consolidation_group_members m
        where m.group_id = v_group and m.tenant_id = new.tenant_id
          and m.company_id = new.to_company_id) then
    raise exception 'Las dos empresas de una eliminacion tienen que ser miembros del grupo de esa corrida.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger no_eliminacion_ajena before insert or update or delete
  on public.consolidation_eliminations
  for each row execute function public.impedir_eliminacion_ajena();

-- ══════════════════════════════════════════════════════════════════════
--  Congelar la foto
--
--  El insert...select de la foto vive AQUI y no en la accion de la
--  pantalla por una razon que ya costo un bug: la ventana que congela la
--  foto -acumulado hasta period_end- estaba escrita en la accion, y otra
--  vez, distinta (`between period_start and period_end`), en la pantalla
--  que avisa de los asientos sin etiquetar. La pantalla decia cero
--  mientras la foto los habia sumado. Una sola escritura de la regla.
--
--  De paso guarda en la corrida cuantos asientos sin empresa vio, por
--  cuanto, y si de verdad entraron: eso es parte de la ENTRADA congelada,
--  no del presente. Etiquetarlos manana no cambia lo que se entrego.
--
--  ACUMULADO hasta period_end, no el movimiento del periodo. El que rompe
--  todo es el BALANCE: una cuenta por cobrar entre dos empresas del grupo
--  nacio en marzo, y si la foto solo mira octubre esa cuenta vale cero en
--  octubre y la eliminacion de receivable_payable -el caso estrella del
--  modulo- no tiene nada que eliminar. El precio es que ingresos y gastos
--  salen acumulados; se asume a proposito mientras el repo no tenga
--  cierre anual, y se DICE en la pantalla y en la ficha en vez de
--  prometer lo contrario.
-- ══════════════════════════════════════════════════════════════════════
create function public.consolidation_freeze(p_run uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_run       public.consolidation_runs%rowtype;
  v_principal uuid;
  v_entries   integer;
  v_amount    numeric(12,2);
begin
  select * into v_run from public.consolidation_runs where id = p_run;
  if v_run.id is null then
    raise exception 'Esa corrida no existe.' using errcode = '42501';
  end if;

  -- Un asiento sin empresa se lee como de la empresa principal: antes de
  -- multi-empresa todo era de ella.
  select c.id into v_principal
  from public.companies c
  where c.tenant_id = v_run.tenant_id and c.is_default and c.deleted_at is null
  limit 1;

  select count(*), coalesce(sum(t.debito), 0) into v_entries, v_amount
  from (
    select e.id, coalesce(sum(l.debit), 0) as debito
    from public.journal_entries e
    left join public.journal_entry_lines l on l.entry_id = e.id
    where e.tenant_id = v_run.tenant_id
      and e.status = 'posted'
      and e.company_id is null
      and e.entry_date <= v_run.period_end
    group by e.id
  ) t;

  -- Va ANTES del insert de la foto: con la foto ya puesta, el trigger de
  -- la corrida vigila que no se le cambie el grupo ni el periodo, y este
  -- update no tiene por que discutir con el.
  update public.consolidation_runs
  set unlabeled_entries  = v_entries,
      unlabeled_amount   = v_amount,
      unlabeled_included = exists (
        select 1 from public.consolidation_group_members m
        where m.tenant_id = v_run.tenant_id
          and m.group_id = v_run.group_id
          and m.company_id = v_principal)
  where id = p_run;

  insert into public.consolidation_run_balances
    (tenant_id, run_id, company_id, account_id, total_debit, total_credit)
  select v_run.tenant_id, p_run, m.company_id, l.account_id,
         sum(l.debit), sum(l.credit)
  from public.journal_entry_lines l
  join public.journal_entries e on e.id = l.entry_id
  join public.consolidation_group_members m
    on m.tenant_id = v_run.tenant_id
   and m.group_id = v_run.group_id
   and m.company_id = coalesce(e.company_id, v_principal)
  where l.tenant_id = v_run.tenant_id
    and e.status = 'posted'
    and e.entry_date <= v_run.period_end
  group by m.company_id, l.account_id
  having sum(l.debit) > 0 or sum(l.credit) > 0;
end;
$$;

comment on function public.consolidation_freeze(uuid) is
  'Congela la foto de entrada de una corrida y anota los asientos sin empresa que vio. La ventana -acumulado hasta period_end- se escribe aqui y en ningun otro sitio.';

-- Las cuentas con las que se pinta una corrida: las activas de hoy MAS
-- toda cuenta que esa corrida haya tocado.
--
-- El catalogo vivo no sirve para una hoja historica. Desactivar una
-- cuenta en /contabilidad es un clic, y la hoja se arma recorriendo las
-- cuentas: una cuenta ausente no produce fila, asi que un consolidado
-- cerrado y entregado en enero perdia en marzo su fila de la 4100 con su
-- millon dentro -y saltaba el cartel de "la hoja no cuadra", que manda a
-- buscar la causa a la contabilidad, donde no esta-. Es la misma razon
-- por la que las EMPRESAS salen de la foto y no de los miembros de hoy.
create function public.consolidation_run_accounts(p_run uuid)
returns table (id uuid, code text, name text, type text, is_active boolean)
language sql
stable
set search_path = ''
as $$
  select a.id, a.code, a.name, a.type, a.is_active
  from public.accounts a
  join public.consolidation_runs r on r.id = p_run
  where a.tenant_id = r.tenant_id
    and (a.is_active
         or exists (select 1 from public.consolidation_run_balances b
                    where b.run_id = r.id and b.account_id = a.id)
         or exists (select 1 from public.consolidation_eliminations e
                    where e.run_id = r.id
                      and (e.debit_account_id = a.id or e.credit_account_id = a.id)))
  order by a.code;
$$;

-- ── Bitacora ────────────────────────────────────────────────────────────
--  Se auditan las DECISIONES -quien armo el grupo, quien metio una empresa,
--  quien genero o cerro la corrida, quien elimino que-. La foto de saldos
--  no lleva bitacora a proposito: son cientos de filas escritas de golpe
--  por la maquina en un solo acto que YA queda registrado como la creacion
--  de la corrida, y auditarlas ahogaria la bitacora del cliente.
create trigger audit_me after insert or update or delete on public.consolidation_groups
  for each row execute function audit.record('consolidation');
create trigger audit_me after insert or update or delete on public.consolidation_group_members
  for each row execute function audit.record('consolidation');
create trigger audit_me after insert or update or delete on public.consolidation_runs
  for each row execute function audit.record('consolidation');
create trigger audit_me after insert or update or delete on public.consolidation_eliminations
  for each row execute function audit.record('consolidation');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
--  UPDATE, no insert: la fila del catalogo existe desde la 0009 y el precio
--  de los tres tiers ya esta derivado de category = 'enterprise'.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{accounting,orgs}',
    recommends   = '{}',
    tagline      = 'Suma tus empresas en un solo estado, sin contar dos veces lo que se venden entre ellas',
    problem      = 'Un grupo con dos o tres razones sociales arma su consolidado en Excel una vez al ano: se copian los saldos a mano, se restan las facturas entre empresas de memoria, y nadie puede decir seis meses despues de donde salio cada numero ni quien lo cambio.',
    features     = '[
      {"titulo":"Hoja de trabajo clasica, con sus columnas","detalle":"Una columna por empresa, una de eliminaciones y una consolidada, cuenta por cuenta. Es la misma hoja que el contador ya sabe leer, calculada sola."},
      {"titulo":"Dice cuanto se habria inflado el grupo","detalle":"Arriba, en numero: cuanto ingreso y cuanto activo desaparecen al quitar lo que las empresas se venden y se deben entre ellas. Ese es el numero que justifica el consolidado."},
      {"titulo":"La foto queda congelada","detalle":"Al generar la corrida se guarda cuanto aporto cada empresa en cada cuenta, acumulado hasta la fecha de corte. Un asiento con fecha atrasada que entre manana no cambia un consolidado ya entregado, y desactivar una cuenta del catalogo tampoco."},
      {"titulo":"Cerrada es cerrada","detalle":"Una corrida cerrada no se edita ni se borra, igual que un asiento contabilizado. Si hay que corregir, se hace otra corrida -y las dos quedan."},
      {"titulo":"Eliminaciones que no pueden descuadrar","detalle":"Cada eliminacion es un par debito/credito con un solo monto, asi que el grupo sigue cuadrando por construccion. La base ademas exige que las dos empresas sean miembros del grupo."},
      {"titulo":"Cuenta los asientos sin empresa","detalle":"Los asientos que nadie etiqueto se leen como de la empresa principal: la pantalla dice cuantos son y por cuanto dinero, y avisa en rojo cuando la principal no es miembro del grupo y esos asientos se quedaron FUERA del consolidado."}
    ]'::jsonb,
    audience     = '{"Grupos con dos o mas razones sociales","Holdings familiares que reportan al banco","Empresas que se facturan entre si y necesitan un estado limpio del grupo"}',
    faq          = '[
      {"p":"¿Consolida empresas en monedas distintas?","r":"No. Todas las empresas del grupo tienen que llevar la misma moneda que el grupo presenta, y la base lo exige al agregarlas. Reexpresar estados a tasa de cierre, promedio e historica es otro trabajo, no un cambio de signo."},
      {"p":"¿Detecta solo las facturas entre mis empresas?","r":"No. Cada eliminacion se captura a mano. Emparejar por monto coincidente seria adivinar sobre la contabilidad de alguien; para automatizarlo hace falta marcar la contraparte en la linea del asiento, que hoy no existe."},
      {"p":"¿Maneja interes minoritario o consolidacion al 60%?","r":"No. Toda empresa del grupo entra al 100% (integracion global). Preferimos no tener la opcion antes que tener una casilla que no hace lo que dice."},
      {"p":"¿Los asientos de contabilidad ya saben a que empresa pertenecen?","r":"Se agrega la columna y se respeta, pero la pantalla de contabilidad todavia no la pide: mientras tanto, un asiento sin empresa cuenta como la empresa principal y la corrida te dice cuantos son, por cuanto, y si de verdad entraron al consolidado."},
      {"p":"¿La corrida es el movimiento del periodo o el acumulado?","r":"El acumulado hasta la fecha de corte, y esta dicho en la pantalla. Es lo unico honesto mientras el repo no tenga cierre anual: si la foto solo mirara el mes, una cuenta por cobrar entre dos empresas del grupo que nacio en marzo valdria cero en octubre y no habria nada que eliminar -el grupo publicaria como activo propio lo que una empresa le debe a la otra-."},
      {"p":"¿El consolidado se postea en los libros?","r":"No, y es a proposito: el consolidado es de presentacion. Las eliminaciones viven en la corrida, no en la contabilidad de ninguna empresa, para no ensuciar los libros individuales con asientos que la DGII no espera."}
    ]'::jsonb,
    setup_minutes = 25
where id = 'consolidation';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'consolidation'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'consolidation no tiene precio en los 3 tiers';
  end if;
end $$;

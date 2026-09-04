-- ═══════════════════════════════════════════════════════════════════════
--  0041 — Contabilidad general (modulo 16, F6/S28-29)
--
--  Catalogo de cuentas + asientos de partida doble + mayor y balanza. El
--  mayor y la balanza NO son tablas: se derivan de las lineas de asientos
--  ya contabilizados, mismo principio que invoice_balance() o
--  stock_levels — un saldo guardado se desincroniza el dia que algo se
--  corrija.
--
--  UN ASIENTO CONTABILIZADO ES INMUTABLE, igual que el kardex (0019): no
--  se edita ni se borra. Si esta mal, se corrige con un asiento inverso,
--  no tocando el original -es literalmente como funciona la contabilidad
--  de verdad, no una convencion de este sistema-. Solo un borrador (antes
--  de contabilizar) se puede editar o borrar.
--
--  Deliberadamente SIN e-CF, SIN 606/607/608 desde aqui: eso es `taxes`
--  (24) y `e-invoice` (25), necesitan certificado digital real de un
--  contribuyente y viven aislados por lo mismo que ya vale para AR.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Catalogo de cuentas ──────────────────────────────────────────────────
create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  -- El tipo decide el saldo normal: activo/gasto es deudor, el resto
  -- acreedor. Sin esto no se puede armar un balance que tenga sentido.
  type       text not null check (type in ('asset','liability','equity','revenue','expense')),
  parent_id  uuid references public.accounts(id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index on public.accounts (tenant_id, is_active, code);

comment on column public.accounts.type is
  'Decide el saldo normal: asset/expense es deudor, liability/equity/revenue es acreedor. Ver accountBalance() en @regb/operations.';

-- ── Asientos ─────────────────────────────────────────────────────────────
create table public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  number       text not null,
  entry_date   date not null default current_date,
  description  text not null,
  -- No hay 'void': un asiento contabilizado no se anula, se corrige con
  -- OTRO asiento (el inverso). 'draft' es lo unico que se puede borrar.
  status       text not null default 'draft' check (status in ('draft','posted')),
  -- Para cuando otro modulo postee aqui solo (futuro, no construido hoy):
  -- que el asiento sepa de donde vino sin que contabilidad conozca el id
  -- de ese modulo (§2.2).
  source_type  text not null default 'manual' check (source_type in ('manual')),
  source_id    uuid,
  created_by   uuid,
  posted_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, number)
);

create index on public.journal_entries (tenant_id, status, entry_date desc);

create table public.journal_entry_lines (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.journal_entries(id) on delete cascade,
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  debit      numeric(12,2) not null default 0 check (debit >= 0),
  credit     numeric(12,2) not null default 0 check (credit >= 0),
  memo       text,
  -- Una linea es debito O credito, nunca las dos ni ninguna: eso no es
  -- una linea de un asiento, es un error de captura.
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0)
);

create index on public.journal_entry_lines (tenant_id, entry_id);
create index on public.journal_entry_lines (tenant_id, account_id);

-- ── Numeracion por tenant y ano ──────────────────────────────────────────
create table public.journal_entry_counters (
  tenant_id uuid not null references regb.tenants(id) on delete cascade,
  year      smallint not null,
  last_n    integer not null default 0,
  primary key (tenant_id, year)
);

create function public.next_journal_entry_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes numerar asientos de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('accounting') then
    raise exception 'El modulo de contabilidad no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;

  insert into public.journal_entry_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('AS-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

revoke all on function public.next_journal_entry_number(uuid) from public;
grant execute on function public.next_journal_entry_number(uuid) to authenticated;

-- ── Contabilizar: valida la partida doble y bloquea el asiento ───────────
--  El servidor ya valida esto antes de llamar (packages/operations/src/
--  accounting.ts), pero la comprobacion vive TAMBIEN aqui: es la unica
--  forma de que sea imposible dejar descuadrada la contabilidad, hoy o el
--  dia que alguien mas inserte un asiento sin pasar por la accion.
create function public.post_journal_entry(p_entry uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_status  text;
  v_debitos numeric(14,2);
  v_creditos numeric(14,2);
  v_lineas  integer;
begin
  select tenant_id, status into v_tenant, v_status
  from public.journal_entries where id = p_entry for update;

  if not found then
    raise exception 'Ese asiento no existe.' using errcode = 'P0002';
  end if;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Ese asiento no es de este cliente.' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'Solo un borrador se puede contabilizar.' using errcode = '55000';
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_lineas, v_debitos, v_creditos
  from public.journal_entry_lines where entry_id = p_entry;

  if v_lineas < 2 then
    raise exception 'Un asiento necesita al menos dos lineas.' using errcode = '55000';
  end if;
  if v_debitos <> v_creditos then
    raise exception 'El asiento no cuadra: debito % vs credito %', v_debitos, v_creditos
      using errcode = '55000';
  end if;

  update public.journal_entries
  set status = 'posted', posted_at = now()
  where id = p_entry;
end;
$$;

revoke all on function public.post_journal_entry(uuid) from public;
grant execute on function public.post_journal_entry(uuid) to authenticated;

comment on function public.post_journal_entry(uuid) is
  'Contabiliza un borrador: exige >=2 lineas y debito=credito. Un asiento contabilizado queda inmutable.';

-- ── Un asiento contabilizado no se edita ni se borra ─────────────────────
--  Dos funciones, no una: `journal_entries` y `journal_entry_lines` no
--  tienen la misma forma de fila (una es dueña de `status`, la otra lo
--  mira en su padre), y NEW/OLD en PL/pgSQL son RECORD -el nombre de
--  columna se resuelve en tiempo de ejecucion contra la tabla real del
--  trigger, no antes-, asi que una sola funcion revienta en la mitad de
--  los casos con "record new has no field...".
create function public.impedir_editar_entry_contabilizado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'posted' then
    raise exception 'Un asiento contabilizado no se edita ni se borra: corrige con un asiento inverso.'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_contabilizado
  before update or delete on public.journal_entries
  for each row execute function public.impedir_editar_entry_contabilizado();

create function public.impedir_editar_linea_contabilizada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status       text;
  v_entry_tenant uuid;
  v_acct_tenant  uuid;
begin
  select status, tenant_id into v_status, v_entry_tenant from public.journal_entries
  where id = coalesce(new.entry_id, old.entry_id);

  if v_status = 'posted' then
    raise exception 'Un asiento contabilizado no se edita ni se borra: corrige con un asiento inverso.'
      using errcode = '55000';
  end if;

  -- El mismo agujero que la 0031/0040 ya tuvieron que tapar en otras
  -- tablas: la RLS de insert solo compara el tenant_id de la fila nueva
  -- contra el tenant que llama, no revisa a quien pertenecen las
  -- referencias (entry_id, account_id). Sin esto, alguien podia colar una
  -- linea con SU propio tenant_id -que pasa la RLS- mientras apunta a un
  -- asiento o una cuenta de otro cliente.
  if tg_op in ('INSERT', 'UPDATE') then
    if v_entry_tenant is distinct from new.tenant_id then
      raise exception 'Esa linea no pertenece a ese asiento.' using errcode = '42501';
    end if;
    select tenant_id into v_acct_tenant from public.accounts where id = new.account_id;
    if v_acct_tenant is distinct from new.tenant_id then
      raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger no_editar_lineas_contabilizado
  before insert or update or delete on public.journal_entry_lines
  for each row execute function public.impedir_editar_linea_contabilizada();

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('accounts',                'accounting'),
      ('journal_entries',         'accounting'),
      ('journal_entry_lines',     'accounting'),
      ('journal_entry_counters',  'accounting')
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

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.accounts
  for each row execute function audit.record('accounting');
create trigger audit_me after insert or update or delete on public.journal_entries
  for each row execute function audit.record('accounting');

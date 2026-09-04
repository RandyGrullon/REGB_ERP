-- ═══════════════════════════════════════════════════════════════════════
--  0045 — Conciliacion bancaria (modulo 20, F6/S30-31)
--
--  Import de un estado de cuenta (sus lineas, capturadas a mano o por
--  CSV -el CSV queda para una mejora, aqui se registra el resultado ya
--  parseado) y el emparejamiento contra los movimientos que `treasury`
--  (0044) ya tiene registrados.
--
--  "Emparejamiento asistido con IA" del catalogo (§5.2) se implementa
--  aqui como lo que de verdad es defendible sin inventar una promesa: un
--  heuristico determinista -mismo monto, mismo signo, fecha cercana,
--  resolviendo primero la linea con MENOS candidatos para no dejar sin
--  opcion a la que menos tenia-, nunca un modelo entrenado. Vive en
--  suggestMatches() (@regb/operations), y SIEMPRE es una sugerencia: la
--  persona confirma cada emparejamiento, el sistema nunca concilia solo.
--
--  Un movimiento bancario solo se puede conciliar con UNA linea del
--  estado -nunca dos-, impuesto con un indice unico parcial, no con
--  logica de aplicacion que se pueda saltar.
-- ═══════════════════════════════════════════════════════════════════════

create table public.bank_statement_imports (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references regb.tenants(id) on delete cascade,
  bank_account_id    uuid not null references public.bank_accounts(id),
  period_start       date not null,
  period_end         date not null,
  statement_balance  numeric(12,2) not null,
  imported_by        uuid,
  created_at         timestamptz not null default now(),
  check (period_end >= period_start)
);

create index on public.bank_statement_imports (tenant_id, bank_account_id, period_end desc);

create table public.bank_statement_lines (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references regb.tenants(id) on delete cascade,
  import_id               uuid not null references public.bank_statement_imports(id) on delete cascade,
  bank_account_id         uuid not null references public.bank_accounts(id),
  line_date               date not null,
  description             text not null,
  -- Signo del propio estado de cuenta: positivo entro, negativo salio. Nunca
  -- cero -una linea sin monto no es un movimiento, es ruido del import-.
  amount                  numeric(12,2) not null check (amount <> 0),
  match_status            text not null default 'pending'
                            check (match_status in ('pending', 'matched', 'ignored')),
  matched_transaction_id  uuid references public.bank_transactions(id),
  created_at              timestamptz not null default now(),
  check ((match_status = 'matched') = (matched_transaction_id is not null))
);

create index on public.bank_statement_lines (tenant_id, import_id);
create index on public.bank_statement_lines (tenant_id, bank_account_id, match_status);

-- Un movimiento bancario se concilia con una sola linea, nunca con dos: el
-- indice -no la aplicacion- es lo que de verdad no se puede saltar.
create unique index bank_statement_lines_un_match_por_movimiento
  on public.bank_statement_lines (matched_transaction_id)
  where matched_transaction_id is not null;

comment on column public.bank_statement_lines.amount is
  'Signo del estado de cuenta del banco: positivo = entro, negativo = salio. Se compara contra el TIPO del movimiento en bank_transactions, no contra su propio signo -alli deposito/retiro no llevan signo-.';

-- ── Conciliar: confirma UNA sugerencia, valida todo antes de aceptarla ───
create function public.match_statement_line(p_line uuid, p_transaction uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_linea  uuid;
  v_cuenta_linea  uuid;
  v_estado        text;
  v_tenant_mov    uuid;
  v_cuenta_mov    uuid;
begin
  select tenant_id, bank_account_id, match_status
    into v_tenant_linea, v_cuenta_linea, v_estado
    from public.bank_statement_lines where id = p_line for update;

  if not found then
    raise exception 'Esa linea del estado no existe.' using errcode = 'P0002';
  end if;
  if v_tenant_linea is distinct from rls.tenant_id() then
    raise exception 'Esa linea no es de este cliente.' using errcode = '42501';
  end if;
  if v_estado = 'matched' then
    raise exception 'Esa linea ya esta conciliada.' using errcode = '55000';
  end if;

  select tenant_id, bank_account_id into v_tenant_mov, v_cuenta_mov
    from public.bank_transactions where id = p_transaction;

  if not found then
    raise exception 'Ese movimiento no existe.' using errcode = 'P0002';
  end if;
  if v_tenant_mov is distinct from rls.tenant_id() then
    raise exception 'Ese movimiento no es de este cliente.' using errcode = '42501';
  end if;
  if v_cuenta_mov is distinct from v_cuenta_linea then
    raise exception 'Ese movimiento es de otra cuenta bancaria.' using errcode = '55000';
  end if;

  update public.bank_statement_lines
  set match_status = 'matched', matched_transaction_id = p_transaction
  where id = p_line;
end;
$$;

revoke all on function public.match_statement_line(uuid, uuid) from public;
grant execute on function public.match_statement_line(uuid, uuid) to authenticated;

comment on function public.match_statement_line(uuid, uuid) is
  'Confirma un emparejamiento. El indice unico parcial es la garantia real de que un movimiento no se concilia dos veces -esta funcion solo da un mensaje claro antes de llegar ahi-.';

create function public.unmatch_statement_line(p_line uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.bank_statement_lines where id = p_line for update;
  if v_tenant is distinct from rls.tenant_id() then
    raise exception 'Esa linea no es de este cliente.' using errcode = '42501';
  end if;

  update public.bank_statement_lines
  set match_status = 'pending', matched_transaction_id = null
  where id = p_line;
end;
$$;

revoke all on function public.unmatch_statement_line(uuid) from public;
grant execute on function public.unmatch_statement_line(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('bank_statement_imports', 'bank-rec'),
      ('bank_statement_lines',   'bank-rec')
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

-- El mismo agujero de siempre (0031/0040/accounting/treasury), tapado
-- desde el primer dia: la RLS de insert solo compara el tenant_id de la
-- fila nueva, no a quien pertenecen bank_account_id (aqui) ni, en el
-- update de conciliar, matched_transaction_id -esa parte ya la valida
-- match_statement_line(), pero la tabla no depende SOLO de que la app
-- llame siempre a esa funcion-.
create function public.impedir_import_cuenta_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.bank_accounts where id = new.bank_account_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_import_cuenta_ajena before insert on public.bank_statement_imports
  for each row execute function public.impedir_import_cuenta_ajena();

create function public.impedir_linea_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_import  uuid;
  v_cuenta_import  uuid;
  v_tenant_mov     uuid;
  v_cuenta_mov     uuid;
begin
  select tenant_id, bank_account_id into v_tenant_import, v_cuenta_import
    from public.bank_statement_imports where id = new.import_id;
  if v_tenant_import is distinct from new.tenant_id then
    raise exception 'Ese import no pertenece a ese cliente.' using errcode = '42501';
  end if;
  if v_cuenta_import is distinct from new.bank_account_id then
    raise exception 'Esa linea no es de la misma cuenta bancaria que su import.' using errcode = '55000';
  end if;

  if new.matched_transaction_id is not null then
    select tenant_id, bank_account_id into v_tenant_mov, v_cuenta_mov
      from public.bank_transactions where id = new.matched_transaction_id;
    if v_tenant_mov is distinct from new.tenant_id then
      raise exception 'Ese movimiento no pertenece a ese cliente.' using errcode = '42501';
    end if;
    if v_cuenta_mov is distinct from new.bank_account_id then
      raise exception 'Ese movimiento es de otra cuenta bancaria.' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_linea_ajena before insert or update on public.bank_statement_lines
  for each row execute function public.impedir_linea_ajena();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.bank_statement_imports
  for each row execute function audit.record('bank-rec');
create trigger audit_me after insert or update or delete on public.bank_statement_lines
  for each row execute function audit.record('bank-rec');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{treasury}',
    recommends   = '{accounting}',
    tagline      = 'Cuadra tu banco sin pelear columna por columna',
    problem      = 'El estado de cuenta del banco y lo que anotaste tu casi nunca coinciden a la primera -un cheque que no ha cobrado, una comision que el banco cobro sin avisar-. Cuadrarlo a mano, linea por linea, es la tarea que todo el mundo pospone hasta que ya no cuadra nada.',
    features     = '[
      {"titulo":"Sugerencia automatica, confirmacion humana","detalle":"El sistema propone el emparejamiento por monto, signo y fecha cercana -nunca concilia solo-. Cada sugerencia se acepta o se rechaza con un clic."},
      {"titulo":"Resuelve primero lo que tiene menos opciones","detalle":"Si dos lineas podrian coincidir con el mismo movimiento, se le asigna primero a la que no tenia otra alternativa, para no dejarla sin pareja por descuido."},
      {"titulo":"Un movimiento, una sola conciliacion","detalle":"Un movimiento bancario no se puede conciliar dos veces -esta impuesto por la base, no solo por la pantalla-."},
      {"titulo":"Partidas pendientes a la vista","detalle":"Lo que el banco registro y tu no -o al reves- queda listado como pendiente hasta que se investigue, nunca se pierde en el ruido."},
      {"titulo":"Ignorar sin perder el rastro","detalle":"Una linea que nunca va a tener pareja -una comision ya contabilizada distinto- se marca ignorada, no se borra: sigue en el historial del import."}
    ]'::jsonb,
    audience     = '{"Negocios con mas de una cuenta bancaria","Contadores externos","Cualquiera que ya usa tesoreria y quiere confiar en su saldo"}',
    faq          = '[
      {"p":"¿Es inteligencia artificial de verdad?","r":"Es un emparejamiento por reglas -mismo monto, mismo signo, fecha cercana, resolviendo primero lo mas dificil de emparejar-, no un modelo entrenado. Siempre es una sugerencia que una persona confirma."},
      {"p":"¿Puedo deshacer una conciliacion?","r":"Si, en cualquier momento: vuelve a quedar pendiente y el movimiento queda libre para conciliarse con la linea correcta."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'bank-rec';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'bank-rec'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'bank-rec no tiene precio en los 3 tiers';
  end if;
end $$;

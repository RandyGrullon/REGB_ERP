-- ═══════════════════════════════════════════════════════════════════════
--  0044 — Tesoreria & Bancos (modulo 19, F6/S30)
--
--  Cuentas bancarias propias del tenant, sus movimientos y las
--  transferencias entre ellas. El saldo NUNCA se guarda: se deriva de
--  saldo_inicial + depositos/entradas - retiros/salidas, mismo principio
--  que invoice_balance()/ap_invoice_balance()/stock_levels.
--
--  UN MOVIMIENTO REGISTRADO ES INMUTABLE -ni se edita ni se borra-, igual
--  que un asiento contabilizado (0041) o el kardex (0019): si algo esta
--  mal, se registra el movimiento contrario, nunca se toca el original.
--  Aqui no hay ni siquiera un estado "borrador": todo movimiento nace
--  definitivo, porque a diferencia de un asiento no hay nada que cuadrar
--  antes de aceptarlo.
--
--  Una transferencia entre DOS cuentas propias no es una tabla aparte de
--  movimientos: crea automaticamente sus dos movimientos ligados (salida
--  en el origen, entrada en el destino) via trigger, para que nunca pueda
--  existir una transferencia con solo un lado registrado.
--
--  El flujo de caja proyectado (la tercera promesa del catalogo) NO vive
--  aqui como funcion SQL: junta el saldo bancario real con las facturas
--  abiertas de ar/ap -que no son de este modulo-, y esa composicion es
--  logica de negocio, no una invariante de datos. Vive en
--  buildCashFlowProjection() (@regb/operations), igual que buildAging() ya
--  hace lo mismo para la cartera. Si ar o ap no estan activos para el
--  tenant, sus tablas simplemente no devuelven filas -su propia RLS ya lo
--  garantiza-, sin que tesoreria necesite saberlo.
-- ═══════════════════════════════════════════════════════════════════════

create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  bank_name       text not null,
  account_name    text not null,
  account_number  text not null,
  account_type    text not null default 'checking' check (account_type in ('checking','savings')),
  opening_balance numeric(12,2) not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, bank_name, account_number)
);

create index on public.bank_accounts (tenant_id, is_active);

create table public.bank_transactions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  bank_account_id  uuid not null references public.bank_accounts(id),
  type             text not null check (type in ('deposit','withdrawal','transfer_in','transfer_out')),
  amount           numeric(12,2) not null check (amount > 0),
  description      text not null,
  reference        text,
  transaction_date date not null default current_date,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index on public.bank_transactions (tenant_id, bank_account_id, transaction_date desc);

comment on table public.bank_transactions is
  'Ledger inmutable: ni se edita ni se borra una fila -corrige con el movimiento contrario-. transfer_in/transfer_out solo los crea el trigger de bank_transfers, nunca a mano.';

create table public.bank_transfers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  from_account_id  uuid not null references public.bank_accounts(id),
  to_account_id    uuid not null references public.bank_accounts(id),
  amount           numeric(12,2) not null check (amount > 0),
  transfer_date    date not null default current_date,
  description      text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

create index on public.bank_transfers (tenant_id, transfer_date desc);

-- ── Saldo: se DERIVA, nunca se guarda ────────────────────────────────────
create function public.bank_account_balance(p_account uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select opening_balance from public.bank_accounts where id = p_account), 0)
    + coalesce((
        select sum(amount) from public.bank_transactions
        where bank_account_id = p_account and type in ('deposit', 'transfer_in')
      ), 0)
    - coalesce((
        select sum(amount) from public.bank_transactions
        where bank_account_id = p_account and type in ('withdrawal', 'transfer_out')
      ), 0)
$$;

comment on function public.bank_account_balance(uuid) is
  'saldo_inicial + depositos/entradas - retiros/salidas. Derivado a proposito: un saldo guardado se desincroniza el dia que se corrija un movimiento con su contrario.';

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select * from (values
      ('bank_accounts',     'treasury'),
      ('bank_transactions', 'treasury'),
      ('bank_transfers',    'treasury')
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

-- ── El mismo agujero que 0031/0040/accounting, tapado desde el primer dia:
--  la RLS de insert solo compara el tenant_id de la fila nueva contra quien
--  llama, no revisa a quien pertenecen las cuentas referenciadas.
create function public.impedir_transaccion_cuenta_ajena() returns trigger
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

create trigger no_transaccion_cuenta_ajena before insert on public.bank_transactions
  for each row execute function public.impedir_transaccion_cuenta_ajena();

create function public.impedir_transferencia_cuenta_ajena() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origen  uuid;
  v_destino uuid;
begin
  select tenant_id into v_origen from public.bank_accounts where id = new.from_account_id;
  select tenant_id into v_destino from public.bank_accounts where id = new.to_account_id;
  if v_origen is distinct from new.tenant_id or v_destino is distinct from new.tenant_id then
    raise exception 'Esa cuenta no pertenece a ese cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_transferencia_cuenta_ajena before insert on public.bank_transfers
  for each row execute function public.impedir_transferencia_cuenta_ajena();

-- ── Una transferencia crea sus dos movimientos ligados, siempre los dos ──
create function public.crear_movimientos_de_transferencia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.bank_transactions
    (tenant_id, bank_account_id, type, amount, description, reference, transaction_date, created_by)
  values
    (new.tenant_id, new.from_account_id, 'transfer_out', new.amount,
     coalesce(new.description, 'Transferencia entre cuentas propias'), new.id::text,
     new.transfer_date, new.created_by);

  insert into public.bank_transactions
    (tenant_id, bank_account_id, type, amount, description, reference, transaction_date, created_by)
  values
    (new.tenant_id, new.to_account_id, 'transfer_in', new.amount,
     coalesce(new.description, 'Transferencia entre cuentas propias'), new.id::text,
     new.transfer_date, new.created_by);

  return new;
end;
$$;

create trigger generar_movimientos after insert on public.bank_transfers
  for each row execute function public.crear_movimientos_de_transferencia();

-- ── Inmutable: ni se edita ni se borra ───────────────────────────────────
create function public.impedir_editar_movimiento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un movimiento bancario no se edita ni se borra: registra el movimiento contrario para corregirlo.'
    using errcode = '55000';
end;
$$;

create trigger no_editar_movimiento before update or delete on public.bank_transactions
  for each row execute function public.impedir_editar_movimiento();

create function public.impedir_editar_transferencia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una transferencia no se edita ni se borra: registra la transferencia contraria para corregirla.'
    using errcode = '55000';
end;
$$;

create trigger no_editar_transferencia before update or delete on public.bank_transfers
  for each row execute function public.impedir_editar_transferencia();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update or delete on public.bank_accounts
  for each row execute function audit.record('treasury');
create trigger audit_me after insert or update or delete on public.bank_transfers
  for each row execute function audit.record('treasury');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia -no como correccion
--  posterior, que fue lo que hizo falta para accounting y ap (0043)-.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    requires     = '{}',
    recommends   = '{ar,ap,accounting}',
    tagline      = 'Sabe cuanto efectivo tienes hoy y cuanto vas a tener en ocho semanas',
    problem      = 'El saldo real vive en la cabeza de quien revisa la banca en linea, y nadie junta ese numero con lo que falta por cobrar y por pagar. La sorpresa de caja llega el mismo dia que hay que pagar la nomina.',
    features     = '[
      {"titulo":"Cuentas bancarias propias","detalle":"Cada cuenta con su banco, numero y saldo inicial. El saldo de hoy nunca se escribe a mano: se calcula solo de los movimientos."},
      {"titulo":"Transferencia entre cuentas propias, nunca a medias","detalle":"Mover dinero de una cuenta a otra genera las dos mitades del movimiento juntas -salida y entrada-, nunca una transferencia con un solo lado registrado."},
      {"titulo":"Un movimiento registrado no se borra","detalle":"Deposito, retiro o transferencia quedan fijos. Si algo estuvo mal, se registra el movimiento contrario -no se edita ni se elimina el original-."},
      {"titulo":"Flujo de caja proyectado a 8 semanas","detalle":"Junta el saldo real de tus cuentas con lo que cuentas por cobrar espera entrar y lo que cuentas por pagar tiene que salir, semana por semana, y avisa en cual semana el efectivo se pone en rojo."},
      {"titulo":"Funciona solo","detalle":"No necesita cuentas por cobrar ni por pagar activas -sin ellas, el flujo de caja simplemente no tiene esas dos columnas-."}
    ]'::jsonb,
    audience     = '{"Negocios con mas de una cuenta bancaria",Distribuidoras,"Negocios que pagan nomina","Cualquiera que quiera saber cuanto efectivo tiene de verdad"}',
    faq          = '[
      {"p":"¿Necesito contabilidad, cuentas por cobrar o por pagar para usarlo?","r":"No. Tesoreria funciona sola con tus cuentas bancarias y sus movimientos. Si activas cuentas por cobrar o por pagar, el flujo de caja proyectado automaticamente empieza a incluir lo que esperas cobrar y pagar."},
      {"p":"¿Puedo corregir un deposito que registre mal?","r":"No editandolo -esa es la garantia del modulo-. Se registra un retiro por el mismo monto, o el movimiento contrario que corresponda, y los dos quedan en el historial."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'treasury';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'treasury'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'treasury no tiene precio en los 3 tiers';
  end if;
end $$;

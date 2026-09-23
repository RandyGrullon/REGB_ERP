-- ═══════════════════════════════════════════════════════════════════════
--  0130 — Venta a credito de verdad (ar + sales-orders)
--
--  El Cliente #1 vende a credito a 15 y 30 dias. El analisis de flujo del
--  23 sep 2026 (flujo 3, hallazgos 2, 3, 16 y 18) encontro que el credito
--  funcionaba en papel:
--
--   · `customers.credit_limit` existia desde la 0020 y nadie lo leia. A un
--     cliente con una factura vencida hace 96 dias se le confirmaba,
--     entregaba y facturaba un pedido de RD$100,000.
--   · La mora no se podia cobrar: la accion validaba contra el total sin
--     mora, y cobrar el capital marcaba "pagada" una factura con mora.
--   · Un cobro mal digitado (5,000 en vez de 500) no tenia correccion.
--   · La factura no tenia lineas: no se podia imprimir ni devolver parte.
--   · No habia nota de credito (B04), y `anularFactura` remitia a ella.
--
--  Esta migracion pone la base de todo eso. La logica que decide (limite,
--  dias, B01/B02, montos) vive en @regb/operations y en las acciones; aqui
--  quedan los datos y las reglas que no se pueden saltar por otro camino.
--
--  Reversion: drop table public.customer_credit_note_lines,
--  public.customer_credit_notes, public.customer_credit_note_counters,
--  public.customer_invoice_lines, public.credit_overrides,
--  public.ar_credit_policy cascade; drop function
--  public.next_credit_note_number(uuid), public.impedir_limite_sin_permiso(),
--  public.cobro_se_reversa_no_se_edita(), public.impedir_nota_de_mas(),
--  public.impedir_devolver_de_mas() cascade; alter table
--  public.customer_payments drop column reversed_at, drop column
--  reversed_by, drop column reversal_reason; recrear invoice_balance() de
--  la 0040; renombrar regb.provision_system_roles_antes_0130 de vuelta.
--  No hay _down aparte: migrate.mjs aplica todo .sql de la carpeta.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  1. Politica de credito del negocio
--
--  Cuantos dias de atraso toleran antes de dejar de fiar. Una fila por
--  negocio; sin fila rige el valor por defecto de la app (30 dias,
--  DIAS_BLOQUEO_POR_DEFECTO en receivables.ts). Null = no bloquear por
--  vencidas (solo el limite, si el cliente tiene).
-- ═══════════════════════════════════════════════════════════════════════
create table public.ar_credit_policy (
  tenant_id          uuid primary key references regb.tenants(id) on delete cascade,
  overdue_block_days smallint default 30
                       check (overdue_block_days is null or overdue_block_days between 1 and 365),
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);

comment on table public.ar_credit_policy is
  'Politica de credito del negocio (0130). overdue_block_days: facturas con saldo vencidas hace MAS de estos dias bloquean pedidos y facturas nuevas. Null = no bloquear por vencidas.';

-- ═══════════════════════════════════════════════════════════════════════
--  2. El limite de credito lo fija quien puede, tambien por PostgREST
--
--  La accion ya exige `ar.credit.manage`. Pero `customers` se escribe con
--  `sales-orders.customers.manage` -el Vendedor lo tiene- y el movil
--  habla con PostgREST sin pasar por la accion: un vendedor podria
--  subirle el limite a su propio cliente. El trigger lo impide cuando el
--  token trae el rol (0109: si no lo trae, manda la app).
-- ═══════════════════════════════════════════════════════════════════════
create function public.impedir_limite_sin_permiso() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sin claims no hay usuario que juzgar: es el dueño de la base (seed,
  -- migraciones, pruebas). Se mira ANTES de llamar a has_perm porque
  -- rls.role_id() (0109) castea el claim sin nullif, y una conexion del
  -- pool que ya tuvo claims devuelve '' -no null- y el cast revienta.
  if nullif(current_setting('request.jwt.claims', true), '') is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.credit_limit is not null)
     or (tg_op = 'UPDATE' and new.credit_limit is distinct from old.credit_limit) then
    if not rls.has_perm('ar.credit.manage') then
      raise exception 'Tu rol no puede fijar limites de credito (ar.credit.manage).'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_limite_sin_permiso
  before insert or update of credit_limit on public.customers
  for each row execute function public.impedir_limite_sin_permiso();

comment on column public.customers.credit_limit is
  'Limite de credito (0130). Null = sin limite. Saldo pendiente (facturas + pedidos confirmados sin facturar) + el documento nuevo no puede pasarlo sin una excepcion autorizada (credit_overrides). Lo fija ar.credit.manage.';

-- ═══════════════════════════════════════════════════════════════════════
--  3. Excepciones de credito autorizadas
--
--  En un negocio real el dueno a veces dice "dale, que paga el viernes".
--  Eso no es un bug que haya que impedir: es una decision que tiene que
--  quedar escrita -quien, cuando, por que, y que se estaba saltando-.
--  Ledger de solo insercion, como invoice_late_fees: una excepcion
--  autorizada no se edita ni se borra.
-- ═══════════════════════════════════════════════════════════════════════
create table public.credit_overrides (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references regb.tenants(id) on delete cascade,
  customer_id         uuid not null references public.customers(id),
  order_id            uuid references public.sales_orders(id),
  -- Donde se autorizo: al confirmar el pedido o al facturarlo.
  stage               text not null check (stage in ('confirm', 'invoice')),
  -- Que reglas se saltaron. Las dos, si fallaban las dos.
  blocks              text[] not null
                        check (cardinality(blocks) > 0 and blocks <@ array['limit', 'overdue']),
  document_total      numeric(12,2) not null check (document_total >= 0),
  -- La foto del momento: saldo pendiente, limite y atraso con que se decidio.
  exposure            numeric(12,2) not null,
  credit_limit        numeric(12,2),
  oldest_overdue_days integer,
  overdue_block_days  integer,
  reason              text not null check (length(btrim(reason)) >= 4),
  authorized_by       uuid,
  authorized_at       timestamptz not null default now()
);

create index on public.credit_overrides (tenant_id, customer_id, authorized_at desc);
create index on public.credit_overrides (tenant_id, order_id);

comment on table public.credit_overrides is
  'Excepciones de credito autorizadas (0130): quien vendio a credito por encima del limite o con vencidas, por que y con que numeros. Solo insercion.';

-- ═══════════════════════════════════════════════════════════════════════
--  4. Un cobro mal registrado se reversa, no se borra ni se edita
--
--  Un cobro de 5,000 digitado en vez de 500 no tenia correccion: borrar
--  esta prohibido desde la 0108 (con razon) y editar el monto borra la
--  huella de lo que se registro. Se marca reversado con motivo, y el
--  saldo lo deja de contar. La fila queda, con el antes y el despues en
--  audit.log.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.customer_payments
  add column reversed_at     timestamptz,
  add column reversed_by     uuid,
  add column reversal_reason text,
  add constraint customer_payments_reverso_con_motivo
    check (reversed_at is null or length(btrim(coalesce(reversal_reason, ''))) >= 4);

create function public.cobro_se_reversa_no_se_edita() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.reversed_at is not null then
    raise exception 'Ese cobro ya fue reversado: un reverso no se deshace. Si el dinero si llego, registralo otra vez.'
      using errcode = '23514';
  end if;
  if new.tenant_id   is distinct from old.tenant_id
     or new.invoice_id  is distinct from old.invoice_id
     or new.amount      is distinct from old.amount
     or new.method      is distinct from old.method
     or new.reference   is distinct from old.reference
     or new.received_at is distinct from old.received_at
     or new.received_by is distinct from old.received_by
     or new.notes       is distinct from old.notes then
    raise exception 'Un cobro registrado no se edita: se reversa con motivo y se registra de nuevo.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- `no_editar_*` dispara antes que `no_referencia_a_otro_cliente` (orden
-- alfabetico): quien intenta editar recibe el mensaje que explica.
create trigger no_editar_cobro
  before update on public.customer_payments
  for each row execute function public.cobro_se_reversa_no_se_edita();

-- ═══════════════════════════════════════════════════════════════════════
--  5. La factura tiene lineas
--
--  La 0023 decidio guardar solo totales ("el detalle vive en el pedido").
--  Tres cosas lo desmintieron: la factura no se podia imprimir, se
--  facturaba lo PEDIDO y no lo ENTREGADO (un pedido entregado a medias se
--  cobraba entero), y una devolucion parcial no tenia contra que
--  compararse. La linea es la foto de lo facturado: si mañana cambia el
--  precio del producto o el pedido, la factura dice lo que dijo.
-- ═══════════════════════════════════════════════════════════════════════
create table public.customer_invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.customer_invoices(id) on delete cascade,
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  -- De que linea del pedido sale: es lo que dice cuanto de lo entregado
  -- ya se facturo.
  order_line_id uuid references public.sales_order_lines(id),
  product_id    uuid references public.products(id),
  description   text not null,
  unit          text,
  qty           numeric(14,3) not null check (qty > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate      numeric(5,4) not null default 0.18 check (tax_rate between 0 and 1),
  -- Misma convencion que documentTotals(): subtotal NETO de descuento.
  subtotal      numeric(12,2) not null,
  tax           numeric(12,2) not null,
  line_total    numeric(12,2) not null
);

create index on public.customer_invoice_lines (tenant_id, invoice_id);
create index on public.customer_invoice_lines (tenant_id, order_line_id)
  where order_line_id is not null;

comment on table public.customer_invoice_lines is
  'Lineas de la factura de credito (0130): lo que se facturo, congelado al emitir. order_line_id dice cuanto de lo entregado ya se facturo.';

-- ═══════════════════════════════════════════════════════════════════════
--  6. Nota de credito (B04)
--
--  Devolucion de mercancia o rebaja sobre una factura ya emitida. Lleva
--  su propio NCF B04 y el NCF de la factura que modifica, que es como la
--  DGII la enlaza. Resta del saldo de la factura; si es devolucion puede
--  reponer inventario.
--
--  Una nota emitida no se edita ni se borra: es un comprobante fiscal
--  igual que la factura.
-- ═══════════════════════════════════════════════════════════════════════
create table public.customer_credit_note_counters (
  tenant_id uuid not null references regb.tenants(id) on delete cascade,
  year      smallint not null,
  last_n    integer not null default 0,
  primary key (tenant_id, year)
);

create function public.next_credit_note_number(p_tenant uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  -- Las dos guardas de la 0031: solo el tenant que llama, solo con el
  -- modulo activo.
  if p_tenant is distinct from rls.tenant_id() then
    raise exception 'No puedes numerar notas de credito de otro cliente.' using errcode = '42501';
  end if;
  if not rls.module_active('ar') then
    raise exception 'El modulo de cuentas por cobrar no esta activo: no se entregan numeros.'
      using errcode = '42501';
  end if;

  insert into public.customer_credit_note_counters as c (tenant_id, year, last_n)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('NC-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

revoke all on function public.next_credit_note_number(uuid) from public;
grant execute on function public.next_credit_note_number(uuid) to authenticated;

create table public.customer_credit_notes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  number       text not null,
  invoice_id   uuid not null references public.customer_invoices(id),
  customer_id  uuid not null references public.customers(id),
  -- return = devolucion de mercancia (por lineas); adjustment = rebaja de monto.
  kind         text not null check (kind in ('return', 'adjustment')),
  -- El dia en Santo Domingo, no el del servidor en UTC (0129).
  issue_date   date not null default public.hoy_fiscal(),
  ncf          text,
  ncf_type     text check (ncf_type in ('B04', 'E34')),
  -- El NCF de la factura que esta nota modifica. Asi la enlaza la DGII.
  modified_ncf text,
  reason       text not null check (length(btrim(reason)) >= 4),
  subtotal     numeric(12,2) not null default 0 check (subtotal >= 0),
  tax          numeric(12,2) not null default 0 check (tax >= 0),
  total        numeric(12,2) not null check (total > 0),
  restocked    boolean not null default false,
  warehouse_id uuid references public.warehouses(id),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, number),
  check (ncf is null or ncf_type is not null),
  check (not restocked or warehouse_id is not null)
);

create unique index customer_credit_notes_ncf_idx
  on public.customer_credit_notes (tenant_id, ncf) where ncf is not null;
create index on public.customer_credit_notes (tenant_id, invoice_id);

create table public.customer_credit_note_lines (
  id              uuid primary key default gen_random_uuid(),
  credit_note_id  uuid not null references public.customer_credit_notes(id) on delete cascade,
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  invoice_line_id uuid references public.customer_invoice_lines(id),
  product_id      uuid references public.products(id),
  description     text not null,
  qty             numeric(14,3) not null check (qty > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0),
  discount_pct    numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate        numeric(5,4) not null default 0.18 check (tax_rate between 0 and 1),
  subtotal        numeric(12,2) not null,
  tax             numeric(12,2) not null,
  line_total      numeric(12,2) not null
);

create index on public.customer_credit_note_lines (tenant_id, credit_note_id);
create index on public.customer_credit_note_lines (tenant_id, invoice_line_id)
  where invoice_line_id is not null;

comment on table public.customer_credit_notes is
  'Notas de credito (B04) sobre facturas de credito (0130). Restan del saldo en invoice_balance(). La suma de notas de una factura nunca pasa su total. Comprobante fiscal: no se edita ni se borra.';

-- ── Una nota no puede devolver mas de lo que se facturo ─────────────────
--  La accion ya lo comprueba; aqui vive tambien para que sea imposible
--  por cualquier otro camino (movil, API, un segundo boton el dia de
--  mañana). El `for update` sobre la factura serializa dos notas que
--  llegan a la vez sobre la misma.
create function public.impedir_nota_de_mas() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv    public.customer_invoices;
  v_notas  numeric;
begin
  select * into v_inv from public.customer_invoices where id = new.invoice_id for update;

  if v_inv.tenant_id is distinct from new.tenant_id then
    raise exception 'La factura no pertenece a ese cliente.' using errcode = '42501';
  end if;
  if v_inv.status = 'void' then
    raise exception 'La factura % esta anulada: una nota de credito no modifica algo que ya no existe.',
      v_inv.number using errcode = '23514';
  end if;
  if new.customer_id is distinct from v_inv.customer_id then
    raise exception 'La nota de credito va a nombre del mismo cliente de la factura.'
      using errcode = '23514';
  end if;

  select coalesce(sum(total), 0) into v_notas
  from public.customer_credit_notes where invoice_id = new.invoice_id;

  if v_notas + new.total > v_inv.total then
    raise exception 'Las notas de credito de % sumarian % y la factura es de %.',
      v_inv.number, v_notas + new.total, v_inv.total using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger no_nota_de_mas
  before insert on public.customer_credit_notes
  for each row execute function public.impedir_nota_de_mas();

create function public.impedir_devolver_de_mas() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facturado numeric;
  v_devuelto  numeric;
begin
  if new.invoice_line_id is null then
    return new;
  end if;

  select qty into v_facturado from public.customer_invoice_lines where id = new.invoice_line_id;
  select coalesce(sum(qty), 0) into v_devuelto
  from public.customer_credit_note_lines where invoice_line_id = new.invoice_line_id;

  if v_devuelto + new.qty > v_facturado then
    raise exception 'Se devolverian % de una linea que se facturo por %.',
      v_devuelto + new.qty, v_facturado using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger no_devolver_de_mas
  before insert on public.customer_credit_note_lines
  for each row execute function public.impedir_devolver_de_mas();

-- ═══════════════════════════════════════════════════════════════════════
--  7. El saldo: capital + mora - cobros vigentes - notas de credito
--
--  Mismo principio que la 0023 y la 0040: se deriva, nunca se guarda. Un
--  cobro reversado deja de contar; una nota de credito resta.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.invoice_balance(p_invoice uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.total
    + coalesce((
        select sum(f.amount) from public.invoice_late_fees f where f.invoice_id = i.id
      ), 0)
    - coalesce((
        select sum(p.amount) from public.customer_payments p
        where p.invoice_id = i.id and p.reversed_at is null
      ), 0)
    - coalesce((
        select sum(n.total) from public.customer_credit_notes n where n.invoice_id = i.id
      ), 0)
  from public.customer_invoices i
  where i.id = p_invoice
$$;

comment on function public.invoice_balance(uuid) is
  'total + mora - cobros no reversados - notas de credito (0130). Derivado a proposito: un saldo guardado se desincroniza el dia que se reverse un cobro o se emita una nota.';

-- ═══════════════════════════════════════════════════════════════════════
--  8. RLS, bitacora, guardas de cliente e inmutabilidad
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'ar_credit_policy', 'credit_overrides', 'customer_invoice_lines',
    'customer_credit_note_counters', 'customer_credit_notes', 'customer_credit_note_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = rls.tenant_id() and rls.module_active(''ar''))
         with check (tenant_id = rls.tenant_id() and rls.module_active(''ar''))', t);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (rls.impersonating(tenant_id))', t);
  end loop;
end $$;

create trigger audit_me after insert or update or delete on public.ar_credit_policy
  for each row execute function audit.record('ar');
create trigger audit_me after insert or update or delete on public.credit_overrides
  for each row execute function audit.record('ar');
create trigger audit_me after insert or update or delete on public.customer_credit_notes
  for each row execute function audit.record('ar');

-- La regla de la 0121: toda FK entre tablas con tenant_id, guardada al
-- insertar y al editar.
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, customer_id, order_id on public.credit_overrides
  for each row execute function public.impedir_referencia_ajena(
    'customer_id', 'customers', 'order_id', 'sales_orders');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, invoice_id, order_line_id, product_id
  on public.customer_invoice_lines
  for each row execute function public.impedir_referencia_ajena(
    'invoice_id', 'customer_invoices', 'order_line_id', 'sales_order_lines',
    'product_id', 'products');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, invoice_id, customer_id, warehouse_id
  on public.customer_credit_notes
  for each row execute function public.impedir_referencia_ajena(
    'invoice_id', 'customer_invoices', 'customer_id', 'customers',
    'warehouse_id', 'warehouses');
create trigger no_referencia_a_otro_cliente
  before insert or update of tenant_id, credit_note_id, invoice_line_id, product_id
  on public.customer_credit_note_lines
  for each row execute function public.impedir_referencia_ajena(
    'credit_note_id', 'customer_credit_notes', 'invoice_line_id', 'customer_invoice_lines',
    'product_id', 'products');

-- Lo fiscal no se borra (0108) ni se reescribe. Las excepciones de
-- credito tampoco: son la firma de alguien.
revoke update, delete on public.credit_overrides              from authenticated;
revoke update, delete on public.customer_invoice_lines        from authenticated;
revoke update, delete on public.customer_credit_notes         from authenticated;
revoke update, delete on public.customer_credit_note_lines    from authenticated;
revoke delete         on public.customer_credit_note_counters from authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  9. La B04 llega a la DGII: 607 (y de ahi, el IT-1)
--
--  Una nota de credito que no sale en el 607 deja declaradas ventas que se
--  devolvieron. Se agrega a la vista de la 0129 tal cual estaba, con:
--
--   · origen 'nota_credito', fechada con su issue_date (ya en hora de RD);
--   · montos POSITIVOS, como los pide el formato: es el tipo (B04/E34) y
--     el NCF modificado lo que le dice a la DGII que resta; [norma]
--     confirmar con el instructivo vigente del 607;
--   · `ncf_modificado`: el NCF de la factura que la nota modifica (campo 4
--     del 607). Columna NUEVA al final -create or replace view solo deja
--     agregar al final-; es null en facturas y tickets.
--
--  El IT-1 (impuestos/liquidacion) resta las filas `nota_credito` de lo
--  facturado: suma la vista con signo por origen.
--  Una nota sobre una factura SIN NCF no va al 607 (no hay comprobante que
--  modificar); el IT-1 la resta aparte, igual que suma las ventas sin NCF.
-- ═══════════════════════════════════════════════════════════════════════
create or replace view public.dgii_607
with (security_invoker = true) as
with base as (
  select
    i.tenant_id,
    'factura'                                                    as origen,
    to_char(i.issue_date, 'YYYYMM')                              as periodo,
    regexp_replace(coalesce(i.buyer_tax_id, c.tax_id), '\D', '', 'g') as rnc,
    i.ncf,
    i.ncf_type,
    to_char(i.issue_date, 'YYYYMMDD')                            as fecha_comprobante,
    i.total - i.tax                                              as monto_facturado,
    i.tax                                                        as itbis_facturado,
    i.total,
    null::text                                                   as ncf_modificado
  from public.customer_invoices i
  left join public.customers c on c.id = i.customer_id
  where i.ncf is not null and i.status <> 'void'

  union all

  select
    s.tenant_id,
    'caja',
    to_char(public.fecha_fiscal(s.sold_at), 'YYYYMM'),
    regexp_replace(c.tax_id, '\D', '', 'g'),
    s.ncf,
    s.ncf_type,
    to_char(public.fecha_fiscal(s.sold_at), 'YYYYMMDD'),
    s.total - s.tax,
    s.tax,
    s.total,
    null::text
  from public.pos_sales s
  left join public.customers c on c.id = s.customer_id
  where s.ncf is not null and not s.voided

  union all

  -- El comprador de la nota es el de la factura: su RNC congelado al emitir.
  select
    n.tenant_id,
    'nota_credito',
    to_char(n.issue_date, 'YYYYMM'),
    regexp_replace(coalesce(i.buyer_tax_id, c.tax_id), '\D', '', 'g'),
    n.ncf,
    n.ncf_type,
    to_char(n.issue_date, 'YYYYMMDD'),
    n.total - n.tax,
    n.tax,
    n.total,
    n.modified_ncf
  from public.customer_credit_notes n
  join public.customer_invoices i on i.id = n.invoice_id
  left join public.customers c on c.id = n.customer_id
  where n.ncf is not null
)
select
  tenant_id, origen, periodo,
  nullif(rnc, '')                            as rnc_comprador,
  case when length(rnc) = 9  then '1'
       when length(rnc) = 11 then '2'
       else '3' end                          as tipo_identificacion,
  ncf, ncf_type, fecha_comprobante,
  monto_facturado, itbis_facturado, total,
  ncf_modificado
from base;

comment on view public.dgii_607 is
  'Ventas del periodo (607): facturas a credito, ventas de caja y notas de credito (B04/E34, con ncf_modificado = NCF de la factura), con NCF y sin las anuladas. monto_facturado = total - ITBIS, en positivo; la nota resta por su tipo. Caja fechada con sold_at en hora de RD (0129, 0130).';

-- ═══════════════════════════════════════════════════════════════════════
--  10. Quien autoriza excepciones, en los roles de fabrica
--
--  `ar.credit.override` es nuevo. Owner y Admin lo tienen por `*`. El
--  Contador tiene `ar.*` desde la 0006 y lo heredaria sin que nadie lo
--  decidiera: lleva la cartera y registra cobros, y autorizar credito es
--  decision del dueno o la gerencia -segregacion de funciones-. Se le
--  niega explicito; el dueno se lo devuelve en /roles si quiere.
--
--  Solo se toca el rol de sistema que no haya decidido ya sobre este
--  permiso: lo que un cliente configuro no cambia por una migracion.
-- ═══════════════════════════════════════════════════════════════════════
update public.roles
set permissions = permissions || '{"ar.credit.override": false}'::jsonb
where is_system and name = 'Contador' and not (permissions ? 'ar.credit.override');

-- Y para los clientes que vengan: se envuelve el aprovisionamiento como
-- en la 0032, sin copiar sus literales.
alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0130;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0130(p_tenant);

  update public.roles
  set permissions = permissions || '{"ar.credit.override": false}'::jsonb
  where tenant_id = p_tenant and is_system and name = 'Contador'
    and not (permissions ? 'ar.credit.override');
end;
$$;

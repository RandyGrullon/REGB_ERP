-- ═══════════════════════════════════════════════════════════════════════
--  0014 — Facturación (S16): numeración, idempotencia y cobros
--
--  Tres reglas del agente regb-billing hechas esquema:
--   3. Toda factura es reproducible — `lines` ya existe desde 0002.
--   7. Idempotencia total: una factura por tenant y período, y un cobro
--      externo nunca se aplica dos veces aunque el webhook llegue repetido.
--   8. Todo cobro fallido reintenta día 1, 3, 7 y 14 antes de escalar.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Una factura por tenant y período ────────────────────────────────────
--  Anuladas (`void`) quedan fuera: anular y reemitir el mismo período es
--  un flujo legítimo (nota de crédito manual). Generar dos veces, no.
create unique index invoices_one_per_period
  on regb.invoices (tenant_id, period_start)
  where status <> 'void';

-- ── Numeración secuencial por año ───────────────────────────────────────
--  REGB-2026-00001, REGB-2026-00002... El contador vive en su propia fila
--  con lock de update: dos generaciones concurrentes jamás comparten número.
create table regb.invoice_counters (
  year   smallint primary key,
  last_n integer not null default 0
);

create function regb.next_invoice_number() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from now())::smallint;
  v_n    integer;
begin
  insert into regb.invoice_counters as c (year, last_n)
  values (v_year, 1)
  on conflict (year) do update set last_n = c.last_n + 1
  returning last_n into v_n;

  return format('REGB-%s-%s', v_year, lpad(v_n::text, 5, '0'));
end;
$$;

-- Solo el proveedor factura. Nadie más toca el contador.
revoke all on function regb.next_invoice_number() from public;
alter table regb.invoice_counters enable row level security;
alter table regb.invoice_counters force row level security;
create policy provider_only on regb.invoice_counters
  for all using (rls.is_provider()) with check (rls.is_provider());

-- ── Intentos de cobro ───────────────────────────────────────────────────
--  Cada intento contra la pasarela queda registrado con su clave de
--  idempotencia. El calendario de reintentos (día 1, 3, 7, 14) lo decide
--  @regb/billing; aquí solo se persiste el estado.
create table regb.payment_attempts (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references regb.invoices(id) on delete restrict,
  attempt_no      smallint not null check (attempt_no >= 1),
  provider        text not null check (provider in ('stripe', 'azul', 'manual')),
  -- La clave que se manda a la pasarela. Única: reintentar el MISMO
  -- intento reutiliza la clave y la pasarela lo deduplica en su lado.
  idempotency_key text not null unique,
  status          text not null default 'pending'
                    check (status in ('pending', 'succeeded', 'failed')),
  -- Id del cobro en la pasarela. Único: un webhook repetido no aplica dos veces.
  external_id     text unique,
  failure_reason  text,
  scheduled_for   date not null,
  attempted_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (invoice_id, attempt_no)
);

create index payment_attempts_due_idx
  on regb.payment_attempts (scheduled_for)
  where status = 'pending';

alter table regb.payment_attempts enable row level security;
alter table regb.payment_attempts force row level security;
create policy provider_only on regb.payment_attempts
  for all using (rls.is_provider()) with check (rls.is_provider());

comment on table regb.payment_attempts is
  'Cada intento de cobro, con clave de idempotencia. Regla 7 del agente regb-billing.';

-- ── Aplicar un pago, idempotente ────────────────────────────────────────
--  El webhook de la pasarela puede llegar 1 vez o 5. `external_id` es
--  único: la primera llamada aplica, las demás devuelven la factura tal
--  cual quedó. NUNCA se cobra dos veces (regla 7).
create function regb.record_payment(
  p_invoice_id  uuid,
  p_external_id text,
  p_provider    text default 'manual'
) returns regb.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice regb.invoices;
  v_next_attempt smallint;
begin
  -- Lock de la factura: dos webhooks simultáneos se serializan aquí.
  select * into v_invoice from regb.invoices
  where id = p_invoice_id for update;

  if not found then
    raise exception 'Factura % no existe', p_invoice_id;
  end if;

  -- ¿Este cobro externo ya se aplicó? Entonces no hay nada que hacer.
  if exists (select 1 from regb.payment_attempts where external_id = p_external_id) then
    return v_invoice;
  end if;

  if v_invoice.status = 'paid' then
    return v_invoice;
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next_attempt
  from regb.payment_attempts where invoice_id = p_invoice_id;

  insert into regb.payment_attempts
    (invoice_id, attempt_no, provider, idempotency_key, status, external_id,
     scheduled_for, attempted_at)
  values
    (p_invoice_id, v_next_attempt, p_provider,
     'pay_' || p_external_id, 'succeeded', p_external_id,
     current_date, now());

  update regb.invoices
  set status = 'paid', paid_at = now()
  where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function regb.record_payment(uuid, text, text) from public;

-- ── Cobertura RLS ───────────────────────────────────────────────────────
--  La vista regb.rls_coverage (0005) detecta tablas sin RLS; estas dos ya
--  quedan protegidas arriba. Este comentario existe para quien audite.

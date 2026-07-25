-- ═══════════════════════════════════════════════════════════════════════
--  0007 — Despacho de eventos: backoff y dead-letter
--
--  La tabla event_outbox de 0003 sabia si un evento estaba pendiente o
--  procesado. Le faltaba lo que hace falta en produccion: CUANDO reintentar
--  y donde acaba un evento que no hay forma de entregar.
--
--  Ver @nexus/core/events.ts — la politica de reintentos vive alli, probada
--  sin base de datos. Esto es solo el almacenamiento.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.event_outbox
  add column next_attempt_at timestamptz not null default now(),
  add column dead_lettered_at timestamptz;

comment on column public.event_outbox.next_attempt_at is
  'Backoff exponencial: 30s, 2min, 8min, 32min, 2h. Calculado por retryDelaySeconds().';
comment on column public.event_outbox.dead_lettered_at is
  'Agoto los 5 intentos. No se borra: queda para diagnostico y reproceso manual.';

-- El indice de pendientes ahora debe respetar el backoff y excluir los
-- muertos, o el despachador reintentaria en bucle lo que ya se rindio.
drop index if exists public.event_outbox_pending_idx;

create index event_outbox_ready_idx
  on public.event_outbox (next_attempt_at)
  where processed_at is null and dead_lettered_at is null;

create index event_outbox_dead_idx
  on public.event_outbox (tenant_id, dead_lettered_at desc)
  where dead_lettered_at is not null;

-- ── Reclamo de lote ────────────────────────────────────────────────────
--  `for update skip locked` permite correr varios despachadores en paralelo
--  sin que dos tomen el mismo evento. Sin eso, un evento se entregaria dos
--  veces cada vez que escale el numero de workers.
create or replace function public.claim_events(p_limit integer default 50)
returns setof public.event_outbox
language sql
security definer
set search_path = ''
as $$
  update public.event_outbox
  set attempts = attempts + 1
  where id in (
    select id from public.event_outbox
    where processed_at is null
      and dead_lettered_at is null
      and next_attempt_at <= now()
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  returning *;
$$;

comment on function public.claim_events(integer) is
  'Reclama un lote de eventos para despachar. Seguro con varios workers en paralelo.';

revoke all on function public.claim_events(integer) from public, anon, authenticated;

-- ── Cierre de un evento ────────────────────────────────────────────────
create or replace function public.settle_event(
  p_id bigint,
  p_ok boolean,
  p_error text default null,
  p_delay_seconds integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.event_outbox
    set processed_at = now(), last_error = null
    where id = p_id;
  elsif p_delay_seconds is null then
    -- Sin delay = se agotaron los intentos.
    update public.event_outbox
    set dead_lettered_at = now(), last_error = p_error
    where id = p_id;
  else
    update public.event_outbox
    set next_attempt_at = now() + make_interval(secs => p_delay_seconds),
        last_error = p_error
    where id = p_id;
  end if;
end;
$$;

revoke all on function public.settle_event(bigint, boolean, text, integer) from public, anon, authenticated;

-- ── Emision desde un modulo ────────────────────────────────────────────
--  Se invoca DENTRO de la transaccion de negocio: si el cambio se revierte,
--  el evento tampoco existe. Esa es toda la gracia del patron outbox.
create or replace function public.emit_event(
  p_type text,
  p_payload jsonb,
  p_emitted_by text,
  p_correlation_id uuid default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if auth.tenant_id() is null then
    raise exception 'No se puede emitir un evento sin tenant en el JWT';
  end if;

  if p_type !~ '^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$' then
    raise exception 'Tipo invalido "%". Formato: <modulo>.<entidad>.<accion>', p_type;
  end if;

  insert into public.event_outbox (tenant_id, type, payload, emitted_by, correlation_id)
  values (
    auth.tenant_id(),
    p_type,
    p_payload,
    p_emitted_by,
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.emit_event(text, jsonb, text, uuid) is
  'Emite un evento en la transaccion actual. security invoker: la RLS del tenant aplica.';

grant execute on function public.emit_event(text, jsonb, text, uuid) to authenticated;

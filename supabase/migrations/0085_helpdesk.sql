-- ═══════════════════════════════════════════════════════════════════════
--  0085 — Mesa de ayuda (modulo 40, F9/S58)
--
--  El vencimiento del SLA reutiliza certificadoVigente() de
--  training.ts -septima vez esta fase-. Los dias que un ticket lleva
--  abierto reutilizan diasAbierto() de quality.ts tal cual. Un ticket
--  resuelto SI se puede reabrir -el cliente puede responder que el
--  problema sigue-, pero uno cerrado es terminal de verdad.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{customer-portal}'): un ticket puede venir de un
--  correo o una llamada, no necesita que el cliente tenga portal.
-- ═══════════════════════════════════════════════════════════════════════

create table public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references regb.tenants(id) on delete cascade,
  customer_id           uuid references public.customers(id),
  subject               text not null,
  description           text not null,
  priority              text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status                text not null default 'open'
                          check (status in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  sla_due_at            timestamptz,
  assigned_to           uuid,
  satisfaction_rating   integer check (satisfaction_rating between 1 and 5),
  created_by            uuid,
  resolved_at           timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index on public.tickets (tenant_id, status);
create index on public.tickets (tenant_id, customer_id);

-- Cada mensaje es un hecho historico: inmutable desde el insert, igual
-- que una actividad de lead en crm.
create table public.ticket_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  ticket_id     uuid not null references public.tickets(id) on delete cascade,
  author_type   text not null check (author_type in ('customer', 'agent')),
  body          text not null,
  created_at    timestamptz not null default now()
);

create index on public.ticket_messages (tenant_id, ticket_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.tickets enable row level security;
alter table public.tickets force row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_messages force row level security;

create policy tenant_module on public.tickets for all
  using (tenant_id = rls.tenant_id() and rls.module_active('helpdesk'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('helpdesk'));
create policy provider_impersonating on public.tickets for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.ticket_messages for all
  using (tenant_id = rls.tenant_id() and rls.module_active('helpdesk'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('helpdesk'));
create policy provider_impersonating on public.ticket_messages for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_cliente_ajeno_ticket() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.customer_id is not null then
    select tenant_id into v_tenant from public.customers where id = new.customer_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_cliente_ajeno_ticket
  before insert or update on public.tickets
  for each row execute function public.impedir_cliente_ajeno_ticket();

create function public.impedir_ticket_ajeno_mensaje() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.tickets where id = new.ticket_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese ticket no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_ticket_ajeno_mensaje
  before insert on public.ticket_messages
  for each row execute function public.impedir_ticket_ajeno_mensaje();

-- ── Inmutabilidad: cerrado es terminal de verdad; los mensajes siempre ──
create function public.impedir_editar_ticket_cerrado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'closed' then
    raise exception 'Ese ticket ya esta cerrado y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_ticket_cerrado
  before update or delete on public.tickets
  for each row execute function public.impedir_editar_ticket_cerrado();

create function public.impedir_editar_mensaje() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un mensaje de ticket ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_mensaje
  before update or delete on public.ticket_messages
  for each row execute function public.impedir_editar_mensaje();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.tickets
  for each row execute function audit.record('helpdesk');
create trigger audit_me after insert on public.ticket_messages
  for each row execute function audit.record('helpdesk');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Un ticket resuelto se puede reabrir; uno cerrado es terminal de verdad',
    problem      = 'Sin tickets formales, el soporte vive en el chat personal de quien atendio primero, y nadie sabe cuantos casos hay abiertos ni cuales llevan mas tiempo de lo que deberian.',
    features     = '[
      {"titulo":"Reabrir sin perder el historial","detalle":"Un ticket resuelto se puede reabrir si el cliente responde que el problema sigue -cerrado si es terminal, no hay marcha atras-."},
      {"titulo":"SLA calculado, no de memoria","detalle":"El vencimiento del SLA se calcula contra la fecha limite real, la misma logica que ya usa el vencimiento de un certificado o una cotizacion."},
      {"titulo":"Cada mensaje es un hecho historico","detalle":"Los mensajes de un ticket nunca se editan despues de enviados -es la conversacion real, no una que se pueda reescribir-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que reciba soporte por telefono, correo o WhatsApp y quiera un registro real de cada caso"}',
    faq          = '[
      {"p":"¿Necesito el portal de clientes para usar la mesa de ayuda?","r":"No -un ticket puede venir de una llamada o un correo, no necesita que el cliente tenga portal-."},
      {"p":"¿Se puede reabrir un ticket ya cerrado?","r":"No -cerrado es terminal de verdad; uno resuelto si se puede reabrir, pero cerrado no-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'helpdesk';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'helpdesk'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'helpdesk no tiene precio en los 3 tiers';
  end if;
end $$;

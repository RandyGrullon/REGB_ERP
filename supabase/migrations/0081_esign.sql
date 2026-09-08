-- ═══════════════════════════════════════════════════════════════════════
--  0081 — Firma electronica (modulo 91, F9/S56)
--
--  Deliberadamente NO es una firma criptografica con certificado ni
--  PKI: es un flujo de "clic para firmar" con rastro de auditoria
--  real -quien, cuando, desde que IP, sobre que version exacta del
--  documento (su hash)-. Le da trazabilidad real, no la validez legal
--  de una firma digital certificada -declarado honestamente en el
--  FAQ del marketplace, no escondido-.
--
--  SIN requires (regb.module_catalog: requires '{}', recommends
--  '{quotes,contracts}'): `contracts` (modulo 33) todavia no existe
--  en este catalogo construido, y `quotes` solo se recomienda, asi
--  que `document_id` es deliberadamente un uuid SIN FK -polimorfico
--  por `document_type`, no una referencia real a una tabla de otro
--  modulo que podria no estar activo-.
-- ═══════════════════════════════════════════════════════════════════════

create table public.signature_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references regb.tenants(id) on delete cascade,
  document_type    text not null check (document_type in ('quote', 'contract', 'other')),
  document_id      uuid not null,
  document_label   text not null,
  signer_name      text not null,
  signer_email     text not null,
  status           text not null default 'pending'
                     check (status in ('pending', 'sent', 'signed', 'declined', 'expired')),
  sent_at          timestamptz,
  signed_at        timestamptz,
  declined_reason  text,
  ip_address       text,
  signed_hash      text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index on public.signature_requests (tenant_id, status);
create index on public.signature_requests (tenant_id, document_type, document_id);

-- El rastro de auditoria: cada paso del flujo, inmutable desde el
-- insert, igual que audit.log.
create table public.signature_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  request_id    uuid not null references public.signature_requests(id) on delete cascade,
  event_type    text not null check (event_type in ('created', 'sent', 'viewed', 'signed', 'declined', 'expired')),
  ip_address    text,
  occurred_at   timestamptz not null default now()
);

create index on public.signature_events (tenant_id, request_id, occurred_at);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.signature_requests enable row level security;
alter table public.signature_requests force row level security;
alter table public.signature_events enable row level security;
alter table public.signature_events force row level security;

create policy tenant_module on public.signature_requests for all
  using (tenant_id = rls.tenant_id() and rls.module_active('e-sign'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('e-sign'));
create policy provider_impersonating on public.signature_requests for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.signature_events for all
  using (tenant_id = rls.tenant_id() and rls.module_active('e-sign'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('e-sign'));
create policy provider_impersonating on public.signature_events for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_solicitud_ajena_evento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.signature_requests where id = new.request_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa solicitud de firma no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_solicitud_ajena_evento
  before insert on public.signature_events
  for each row execute function public.impedir_solicitud_ajena_evento();

-- ── Inmutabilidad ─────────────────────────────────────────────────────
create function public.impedir_editar_solicitud_firma_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('signed', 'declined', 'expired') then
    raise exception 'Esa solicitud de firma ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_solicitud_resuelta
  before update or delete on public.signature_requests
  for each row execute function public.impedir_editar_solicitud_firma_resuelta();

create function public.impedir_editar_evento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un evento de firma ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_evento
  before update or delete on public.signature_events
  for each row execute function public.impedir_editar_evento();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.signature_requests
  for each row execute function audit.record('e-sign');
create trigger audit_me after insert on public.signature_events
  for each row execute function audit.record('e-sign');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Trazabilidad real de quien firmo, cuando y sobre que version exacta -no una firma certificada con PKI-',
    problem      = 'Sin un rastro de auditoria real, "el cliente firmo" es la palabra de quien vendio contra la palabra de quien compro -nadie puede probar cuando, desde donde, ni sobre cual version exacta del documento-.',
    features     = '[
      {"titulo":"Rastro de auditoria completo","detalle":"Cada paso -creada, enviada, vista, firmada o rechazada- queda registrado con fecha e IP, inmutable desde el momento que ocurre."},
      {"titulo":"Hash del documento firmado","detalle":"Se guarda una huella de la version exacta que se firmo, para poder demostrar despues que no se alteró."},
      {"titulo":"Funciona con o sin otro modulo","detalle":"No exige quotes ni contracts -firma cualquier documento identificado por tipo y folio, aunque esos modulos no esten activos-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio que hoy imprime, firma a mano y escanea, o que confia en un simple correo de \"aprobado\" sin rastro real"}',
    faq          = '[
      {"p":"¿Es una firma digital certificada legalmente equivalente a la firma autografa?","r":"No -es un flujo de clic para firmar con rastro de auditoria real (quien, cuando, desde que IP, sobre que version), no una firma criptografica con certificado ni PKI-. Da trazabilidad, no certificacion legal."},
      {"p":"¿Necesito el modulo de cotizaciones o de contratos para usarlo?","r":"No -firma cualquier documento identificado por tipo y folio, funciona por su cuenta-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'e-sign';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'e-sign'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'e-sign no tiene precio en los 3 tiers';
  end if;
end $$;

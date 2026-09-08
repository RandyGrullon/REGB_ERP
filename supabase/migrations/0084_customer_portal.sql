-- ═══════════════════════════════════════════════════════════════════════
--  0084 — Portal de clientes (modulo 39, F9/S58)
--
--  El acceso es por invitacion con token -no un sistema de
--  autenticacion completo, mas parecido a un enlace magico-. La
--  pagina publica que el cliente visita (`/portal-cliente/[token]`)
--  NO pasa por sesion de tenant: busca el token exacto con la
--  conexion de servicio (`db()`, ya usada para el selector de
--  tenants en modo demo) y filtra TODO lo demas por el tenant_id y
--  customer_id que ese mismo token devolvio -nunca por un parametro
--  que el cliente pudiera manipular-.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{ar}'): el portal es util aunque el cliente todavia
--  no tenga facturas formales que ver.
-- ═══════════════════════════════════════════════════════════════════════

create table public.portal_invites (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  customer_id       uuid not null references public.customers(id),
  email             text not null,
  token             text not null unique,
  status            text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_by        uuid,
  activated_at      timestamptz,
  revoked_at        timestamptz,
  last_accessed_at  timestamptz,
  created_at        timestamptz not null default now()
);

create index on public.portal_invites (tenant_id, customer_id);
create index on public.portal_invites (token);

-- El rastro de cada visita del cliente: inmutable desde el insert,
-- igual que signature_events de e-sign.
create table public.portal_access_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  invite_id     uuid not null references public.portal_invites(id) on delete cascade,
  ip_address    text,
  accessed_at   timestamptz not null default now()
);

create index on public.portal_access_log (tenant_id, invite_id, accessed_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS -para la administracion del lado del tenant (Shell adentro).
--  La pagina publica del cliente usa la conexion de servicio, no
--  estas politicas: no hay sesion de tenant que satisfacerlas.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.portal_invites enable row level security;
alter table public.portal_invites force row level security;
alter table public.portal_access_log enable row level security;
alter table public.portal_access_log force row level security;

create policy tenant_module on public.portal_invites for all
  using (tenant_id = rls.tenant_id() and rls.module_active('customer-portal'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('customer-portal'));
create policy provider_impersonating on public.portal_invites for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.portal_access_log for all
  using (tenant_id = rls.tenant_id() and rls.module_active('customer-portal'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('customer-portal'));
create policy provider_impersonating on public.portal_access_log for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_cliente_ajeno_invitacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.customers where id = new.customer_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese cliente no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_cliente_ajeno_invitacion
  before insert on public.portal_invites
  for each row execute function public.impedir_cliente_ajeno_invitacion();

create function public.impedir_invitacion_ajena_acceso() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.portal_invites where id = new.invite_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Esa invitacion no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_invitacion_ajena_acceso
  before insert on public.portal_access_log
  for each row execute function public.impedir_invitacion_ajena_acceso();

-- ── Inmutabilidad: revocada es terminal; el acceso siempre es historico ─
create function public.impedir_editar_invitacion_revocada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'revoked' then
    raise exception 'Esa invitacion ya se revoco y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_invitacion_revocada
  before update or delete on public.portal_invites
  for each row execute function public.impedir_editar_invitacion_revocada();

create function public.impedir_editar_acceso() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un acceso al portal ya registrado no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_acceso
  before update or delete on public.portal_access_log
  for each row execute function public.impedir_editar_acceso();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.portal_invites
  for each row execute function audit.record('customer-portal');
create trigger audit_me after insert on public.portal_access_log
  for each row execute function audit.record('customer-portal');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'El cliente entra con un enlace, no con una contraseña que administrar',
    problem      = 'Sin un portal propio, cada vez que un cliente pregunta "cuanto debo" o "me llego eso" alguien del equipo tiene que buscarlo a mano y responder por telefono o WhatsApp.',
    features     = '[
      {"titulo":"Acceso por invitacion, sin contraseñas","detalle":"Un enlace unico por cliente -revocable en cualquier momento- en vez de una cuenta y contraseña que administrar."},
      {"titulo":"Rastro de cada visita","detalle":"Cada vez que el cliente entra queda registrado -fecha e IP-, igual que el rastro de auditoria de una firma electronica."},
      {"titulo":"Honesto sobre lo que es","detalle":"No es un sistema de autenticacion con contraseña -quien tenga el enlace entra-, por eso revocar una invitacion la desactiva de inmediato."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio con clientes recurrentes que hoy responde por telefono cuanto deben o si su pedido ya salio"}',
    faq          = '[
      {"p":"¿El cliente crea una cuenta con contraseña?","r":"No -recibe un enlace unico; revocarlo lo desactiva de inmediato, sin necesidad de cambiar contraseñas-."},
      {"p":"¿Necesito el modulo de cuentas por cobrar para usar el portal?","r":"No -el portal funciona aunque el cliente todavia no tenga facturas formales que ver-."}
    ]'::jsonb,
    setup_minutes = 10
where id = 'customer-portal';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'customer-portal'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'customer-portal no tiene precio en los 3 tiers';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  0087 — Marketing & Campanas (modulo 37, F9/S59)
--
--  Deliberadamente NO envia correos ni WhatsApp de verdad -no hay
--  integracion con un proveedor externo todavia-: "enviar" una
--  campana toma una foto de los leads que hoy cumplen el filtro de
--  segmento y crea un destinatario por cada uno, con su fecha de
--  envio real. Abrir y hacer clic se registran como eventos
--  separados porque en la vida real llegan en momentos distintos -no
--  son el mismo hecho-.
--
--  Requiere `crm` de verdad (regb.module_catalog: requires '{crm}'):
--  el filtro de segmento y la atribucion de conversion se apoyan en
--  una FK real hacia public.leads, no en un conteo suelto.
-- ═══════════════════════════════════════════════════════════════════════

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references regb.tenants(id) on delete cascade,
  name          text not null,
  channel       text not null check (channel in ('email', 'whatsapp')),
  subject       text,
  message       text not null,
  status        text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'cancelled')),
  target_status text check (target_status in ('new', 'contacted', 'qualified', 'disqualified', 'converted')),
  target_source text check (target_source in ('referral', 'event', 'web', 'cold')),
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.campaigns (tenant_id, status);

-- Un destinatario es la foto de a quien se le envio: inmutable en
-- quien y cuando se envio, pero abrir/clic si se pueden registrar
-- despues -son eventos que llegan mas tarde en la vida real-.
create table public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  lead_id      uuid not null references public.leads(id),
  sent_at      timestamptz not null default now(),
  opened_at    timestamptz,
  clicked_at   timestamptz,
  check (clicked_at is null or opened_at is not null)
);

create index on public.campaign_recipients (tenant_id, campaign_id);
create unique index on public.campaign_recipients (campaign_id, lead_id);

-- Atribucion: de que campana vino un lead -primer toque, nunca se
-- reescribe si el lead ya llego atribuido a otra-.
alter table public.leads add column campaign_id uuid references public.campaigns(id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;
alter table public.campaign_recipients enable row level security;
alter table public.campaign_recipients force row level security;

create policy tenant_module on public.campaigns for all
  using (tenant_id = rls.tenant_id() and rls.module_active('marketing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('marketing'));
create policy provider_impersonating on public.campaigns for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.campaign_recipients for all
  using (tenant_id = rls.tenant_id() and rls.module_active('marketing'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('marketing'));
create policy provider_impersonating on public.campaign_recipients for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_lead_ajeno_destinatario() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_campana uuid;
  v_tenant_lead uuid;
begin
  select tenant_id into v_tenant_campana from public.campaigns where id = new.campaign_id;
  select tenant_id into v_tenant_lead from public.leads where id = new.lead_id;
  if v_tenant_campana is distinct from new.tenant_id or v_tenant_lead is distinct from new.tenant_id then
    raise exception 'Ese lead o esa campana no pertenecen a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_lead_ajeno_destinatario
  before insert on public.campaign_recipients
  for each row execute function public.impedir_lead_ajeno_destinatario();

-- ── Inmutabilidad: enviada/cancelada es terminal para la campana ───────
create function public.impedir_editar_campana_resuelta() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('sent', 'cancelled') then
    raise exception 'Esa campana ya se resolvio y no se edita.' using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger no_editar_campana_resuelta
  before update or delete on public.campaigns
  for each row execute function public.impedir_editar_campana_resuelta();

-- El destinatario es inmutable en QUIEN y CUANDO se envio; abrir/clic
-- se pueden rellenar despues, pero nunca retroceder ni cambiar a quien.
create function public.impedir_editar_destinatario() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.campaign_id is distinct from old.campaign_id
     or new.lead_id is distinct from old.lead_id
     or new.sent_at is distinct from old.sent_at then
    raise exception 'Un destinatario ya enviado no cambia de campana, lead ni fecha de envio.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger no_editar_destinatario
  before update on public.campaign_recipients
  for each row execute function public.impedir_editar_destinatario();

create function public.impedir_borrar_destinatario() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Un destinatario ya enviado no se borra.' using errcode = '55000';
end;
$$;

create trigger no_borrar_destinatario
  before delete on public.campaign_recipients
  for each row execute function public.impedir_borrar_destinatario();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.campaigns
  for each row execute function audit.record('marketing');
create trigger audit_me after insert or update on public.campaign_recipients
  for each row execute function audit.record('marketing');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Honesto sobre lo que es: toma la foto de a quien se le envio, no manda el correo por ti',
    problem      = 'Sin un registro formal de campanas, nadie puede decir con certeza cuantos leads llegaron de verdad de una promocion en particular ni si vale la pena repetirla.',
    features     = '[
      {"titulo":"Segmento simple, sin caja negra","detalle":"Filtrar por estado o fuente del lead antes de enviar -la misma tabla de leads de CRM, no un segmento inventado aparte-."},
      {"titulo":"Atribucion de primer toque","detalle":"El lead que llega desde una campana queda atribuido a ella para siempre -nunca se reescribe si ya tenia otra atribucion-."},
      {"titulo":"Abrir y hacer clic son eventos distintos","detalle":"Se registran por separado porque en la vida real llegan en momentos distintos, nunca al mismo tiempo que el envio."}
    ]'::jsonb,
    audience     = '{"Cualquier equipo de ventas que hoy manda promociones por WhatsApp sin saber cuantos leads reales generaron"}',
    faq          = '[
      {"p":"¿Envia el correo o el WhatsApp de verdad?","r":"No todavia -registra a quien se le envio y cuando, pero la integracion con un proveedor externo de correo o WhatsApp no esta conectada-."},
      {"p":"¿Necesito CRM para usar marketing?","r":"Si -el segmento y la atribucion se apoyan en los leads reales de CRM, no en una lista suelta-."}
    ]'::jsonb,
    setup_minutes = 20
where id = 'marketing';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'marketing'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'marketing no tiene precio en los 3 tiers';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  0078 — CRM / Leads (modulo 29, F9/S55)
--
--  Primer modulo de F9: Ventas avanzado, BI e inteligencia. El
--  puntaje de un lead (puntuarLead() en @regb/operations) es una
--  regla explicita -email, telefono, calidad de la fuente-, no un
--  modelo de IA: cualquiera puede explicar por que un lead saco 70 y
--  no 50. La asignacion automatica (asignarRoundRobin()) reparte
--  leads nuevos entre vendedores activos recordando donde se quedo la
--  ultima vuelta.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{pipeline}'): un CRM de leads es util por su cuenta,
--  aunque todavia no se conviertan en oportunidades formales.
-- ═══════════════════════════════════════════════════════════════════════

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  name         text not null,
  company      text,
  email        text,
  phone        text,
  source       text not null check (source in ('referral', 'event', 'web', 'cold')),
  score        integer not null default 0 check (score between 0 and 100),
  status       text not null default 'new'
                 check (status in ('new', 'contacted', 'qualified', 'disqualified', 'converted')),
  assigned_to  uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on public.leads (tenant_id, status);
create index on public.leads (tenant_id, assigned_to);

-- Cada interaccion es un hecho historico: inmutable desde el insert,
-- igual que un reporte de avance de manufacturing.
create table public.lead_activities (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  lead_id      uuid not null references public.leads(id),
  type         text not null check (type in ('call', 'email', 'meeting', 'note')),
  notes        text not null,
  occurred_at  timestamptz not null default now(),
  created_by   uuid
);

create index on public.lead_activities (tenant_id, lead_id, occurred_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.leads enable row level security;
alter table public.leads force row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_activities force row level security;

create policy tenant_module on public.leads for all
  using (tenant_id = rls.tenant_id() and rls.module_active('crm'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('crm'));
create policy provider_impersonating on public.leads for select
  using (rls.impersonating(tenant_id));

create policy tenant_module on public.lead_activities for all
  using (tenant_id = rls.tenant_id() and rls.module_active('crm'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('crm'));
create policy provider_impersonating on public.lead_activities for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_lead_ajeno_actividad() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.leads where id = new.lead_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'Ese lead no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_lead_ajeno_actividad
  before insert on public.lead_activities
  for each row execute function public.impedir_lead_ajeno_actividad();

-- ── Inmutabilidad: la actividad es un hecho historico ──────────────────
create function public.impedir_editar_actividad() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Una actividad de lead ya registrada no se edita ni se borra.' using errcode = '55000';
end;
$$;

create trigger no_editar_actividad
  before update or delete on public.lead_activities
  for each row execute function public.impedir_editar_actividad();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.leads
  for each row execute function audit.record('crm');
create trigger audit_me after insert on public.lead_activities
  for each row execute function audit.record('crm');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Un puntaje explicable -email, telefono, fuente-, no una caja negra de IA',
    problem      = 'Sin un puntaje explicito y una asignacion consistente, los leads se atienden por orden de llegada al buzon de quien los vio primero, y los mas prometedores esperan lo mismo que los frios.',
    features     = '[
      {"titulo":"Puntaje explicable","detalle":"Email, telefono y la calidad de la fuente suman puntos fijos -cualquiera puede explicar por que un lead saco 70 y no 50-."},
      {"titulo":"Asignacion automatica en round-robin","detalle":"Los leads nuevos se reparten entre vendedores activos recordando donde se quedo la ultima vuelta, no siempre por el mismo orden."},
      {"titulo":"Linea de tiempo de interacciones","detalle":"Cada llamada, correo o reunion queda registrada como un hecho historico, nunca se edita despues."}
    ]'::jsonb,
    audience     = '{"Cualquier equipo de ventas que hoy reparta leads por correo o por quien llego primero"}',
    faq          = '[
      {"p":"¿El puntaje usa inteligencia artificial?","r":"No -es una regla explicita y fija, para que el equipo de ventas siempre pueda explicar el numero-."},
      {"p":"¿Necesito el modulo de oportunidades para usar CRM?","r":"No -CRM funciona por su cuenta, aunque se complementa con pipeline si formalizas las oportunidades-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'crm';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'crm'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'crm no tiene precio en los 3 tiers';
  end if;
end $$;

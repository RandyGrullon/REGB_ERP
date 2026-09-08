-- ═══════════════════════════════════════════════════════════════════════
--  0082 — Contratos & Suscripciones (modulo 33, F9/S57)
--
--  La vigencia reutiliza certificadoVigente() de training.ts -sexta
--  vez que se resuelve la misma pregunta ("esto ya vencio?")-.
--  calcularEscalamiento() aplica la clausula de precio al renovar.
--  Renovar NO reabre el contrato -crea uno NUEVO con renewed_from_id
--  apuntando al anterior, que se marca 'renewed'-, mismo criterio de
--  versionado que quotes con supersedes_id.
--
--  Deliberadamente SIN requires (regb.module_catalog: requires '{}',
--  recommends '{ar}'): un contrato es util por su cuenta, aunque se
--  complementa con ar si ya facturas la recurrencia formalmente.
-- ═══════════════════════════════════════════════════════════════════════

create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references regb.tenants(id) on delete cascade,
  contract_number   text not null,
  customer_id       uuid not null references public.customers(id),
  renewed_from_id   uuid references public.contracts(id),
  status            text not null default 'draft'
                      check (status in ('draft', 'active', 'renewed', 'cancelled', 'expired')),
  billing_frequency text not null check (billing_frequency in ('monthly', 'quarterly', 'annual')),
  start_date        date not null,
  end_date          date not null,
  base_amount       numeric(12,2) not null check (base_amount > 0),
  escalation_pct    numeric(5,4) not null default 0 check (escalation_pct >= 0),
  auto_renew        boolean not null default false,
  created_by        uuid,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, contract_number),
  check (end_date > start_date)
);

create index on public.contracts (tenant_id, status);
create index on public.contracts (tenant_id, customer_id);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.contracts enable row level security;
alter table public.contracts force row level security;

create policy tenant_module on public.contracts for all
  using (tenant_id = rls.tenant_id() and rls.module_active('contracts'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('contracts'));
create policy provider_impersonating on public.contracts for select
  using (rls.impersonating(tenant_id));

-- ── El agujero de siempre (0031) ────────────────────────────────────────
create function public.impedir_referencia_ajena_contrato() returns trigger
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

  if new.renewed_from_id is not null then
    select tenant_id into v_tenant from public.contracts where id = new.renewed_from_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'Ese contrato anterior no pertenece a esta cuenta.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger no_referencia_ajena_contrato
  before insert or update on public.contracts
  for each row execute function public.impedir_referencia_ajena_contrato();

-- ── Inmutabilidad: terminos congelados fuera de draft ──────────────────
create function public.impedir_editar_contrato_activo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status != 'draft' then
    if new.customer_id is distinct from old.customer_id
       or new.billing_frequency is distinct from old.billing_frequency
       or new.start_date is distinct from old.start_date
       or new.end_date is distinct from old.end_date
       or new.base_amount is distinct from old.base_amount
       or new.escalation_pct is distinct from old.escalation_pct then
      raise exception 'Ese contrato ya no esta en borrador; sus terminos no se pueden cambiar.' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger no_editar_contrato_activo
  before update on public.contracts
  for each row execute function public.impedir_editar_contrato_activo();

-- ── Bitacora ────────────────────────────────────────────────────────────
create trigger audit_me after insert or update on public.contracts
  for each row execute function audit.record('contracts');

-- ═══════════════════════════════════════════════════════════════════════
--  Publicar en el marketplace desde el primer dia.
-- ═══════════════════════════════════════════════════════════════════════
update regb.module_catalog
set is_published = true,
    released_at  = current_date,
    tagline      = 'Renovar nunca sobrescribe el contrato original -crea uno nuevo, con la escalacion de precio aplicada-',
    problem      = 'Sin contratos formales, la recurrencia se controla con recordatorios sueltos, y nadie tiene claro cuando toca renovar ni cuanto deberia subir el precio segun lo pactado.',
    features     = '[
      {"titulo":"Renovacion que no sobrescribe","detalle":"Renovar un contrato crea uno NUEVO -el anterior queda marcado renewed, su historial completo intacto-."},
      {"titulo":"Escalamiento de precio real","detalle":"El monto de la renovacion aplica automaticamente el porcentaje de escalamiento pactado, no un numero puesto a mano."},
      {"titulo":"Terminos congelados una vez activo","detalle":"Un contrato activo no puede cambiar sus fechas ni su monto -corregir algo significa una renovacion o cancelarlo, no editarlo-."}
    ]'::jsonb,
    audience     = '{"Cualquier negocio con clientes recurrentes -mantenimiento, suscripcion, servicio- que hoy controla la renovacion de memoria"}',
    faq          = '[
      {"p":"¿Necesito el modulo de cuentas por cobrar?","r":"No -contracts funciona por su cuenta, aunque se complementa con ar si ya facturas la recurrencia formalmente-."},
      {"p":"¿Puedo editar un contrato ya activo?","r":"No sus terminos -fechas, monto, frecuencia- se congelan; para cambiarlos se renueva o se cancela-."}
    ]'::jsonb,
    setup_minutes = 15
where id = 'contracts';

do $$
declare v_faltan integer;
begin
  select count(*) into v_faltan
  from regb.module_catalog mc
  where mc.id = 'contracts'
    and (select count(*) from regb.module_pricing mp where mp.module_id = mc.id) < 3;

  if v_faltan > 0 then
    raise exception 'contracts no tiene precio en los 3 tiers';
  end if;
end $$;

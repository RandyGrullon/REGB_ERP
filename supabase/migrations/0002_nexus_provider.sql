-- ═══════════════════════════════════════════════════════════════════════
--  0002 — Esquema `nexus`: el negocio del proveedor
--
--  Aqui viven tus clientes, sus suscripciones y sus facturas.
--  NINGUN cliente puede leer nada de este esquema.
--  Documento maestro §7 y §9.2.
-- ═══════════════════════════════════════════════════════════════════════

create type nexus.tenant_tier   as enum ('pyme', 'mediano', 'grande');
create type nexus.tenant_status as enum ('trial', 'active', 'past_due', 'readonly', 'suspended', 'archived');
create type nexus.module_status as enum ('trial', 'active', 'suspended', 'archived');
create type nexus.invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'void');

-- ── Clientes ───────────────────────────────────────────────────────────
create table nexus.tenants (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  legal_name     text not null,
  trade_name     text,
  tax_id         text,                                   -- RNC / RFC / NIT
  country        char(2) not null default 'DO',
  tier           nexus.tenant_tier not null,
  status         nexus.tenant_status not null default 'trial',
  timezone       text not null default 'America/Santo_Domingo',
  currency       char(3) not null default 'DOP',
  logo_url       text,
  primary_color  text default '#5865F2',
  installed_at   timestamptz,
  go_live_at     timestamptz,
  health_score   smallint not null default 100 check (health_score between 0 and 100),
  csm_user_id    uuid,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on nexus.tenants (status, tier);
create index on nexus.tenants (health_score) where status = 'active';

comment on table nexus.tenants is 'Cada fila es un cliente que paga Nexus ERP.';

-- ── Suscripciones ──────────────────────────────────────────────────────
create table nexus.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references nexus.tenants(id) on delete cascade,
  tier                nexus.tenant_tier not null,
  billing_cycle       text not null default 'monthly'
                        check (billing_cycle in ('monthly', 'annual', 'biennial', 'triennial')),
  base_price          numeric(12,2) not null check (base_price >= 0),
  install_price       numeric(12,2) not null check (install_price >= 0),
  install_paid        boolean not null default false,
  included_users      integer not null check (included_users >= 0),
  included_branches   integer not null check (included_branches >= 0),
  included_companies  integer not null check (included_companies >= 0),
  included_storage_gb integer not null check (included_storage_gb >= 0),
  included_modules    smallint not null default 0,
  discount_pct        numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  discount_reason     text,
  started_at          date not null,
  renews_at           date not null,
  cancel_at           date,
  payment_method      jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index on nexus.subscriptions (tenant_id) where cancel_at is null;

-- ── Catalogo de modulos ────────────────────────────────────────────────
create table nexus.module_catalog (
  id           text primary key,                          -- 'inventory'
  name         text not null,
  category     text not null
                 check (category in ('core', 'standard', 'advanced', 'vertical', 'enterprise')),
  description  text,
  icon         text,
  version      text not null default '0.1.0',
  requires     text[] not null default '{}',
  recommends   text[] not null default '{}',
  conflicts    text[] not null default '{}',
  platforms    jsonb not null default '{"web":true,"desktop":true,"mobile":true}',
  permissions  text[] not null default '{}',
  is_published boolean not null default false,
  released_at  date,
  created_at   timestamptz not null default now()
);

comment on table nexus.module_catalog is
  'Los 92 modulos de §5. Un modulo sin precio en los 3 tiers no se publica.';

-- ── Precios por tier ───────────────────────────────────────────────────
create table nexus.module_pricing (
  module_id     text not null references nexus.module_catalog(id) on delete cascade,
  tier          nexus.tenant_tier not null,
  install_price numeric(12,2) not null check (install_price >= 0),
  monthly_price numeric(12,2) not null check (monthly_price >= 0),
  per_user      numeric(12,2) not null default 0 check (per_user >= 0),
  primary key (module_id, tier)
);

-- ── Modulos activos por cliente ────────────────────────────────────────
--  Esta tabla es el corazon del producto: define que ve cada cliente.
create table nexus.tenant_modules (
  tenant_id      uuid not null references nexus.tenants(id) on delete cascade,
  module_id      text not null references nexus.module_catalog(id),
  status         nexus.module_status not null default 'active',
  enabled        boolean not null default true,           -- el cliente puede apagarlo sin perderlo
  trial_ends_at  date,
  activated_at   timestamptz not null default now(),
  archived_at    timestamptz,
  price_override numeric(12,2) check (price_override >= 0),  -- precio negociado
  primary key (tenant_id, module_id)
);

-- El helper auth.module_active() consulta por (tenant, modulo, status, enabled)
-- en cada evaluacion de politica RLS. Sin este indice, cada query paga un scan.
create index tenant_modules_active_idx
  on nexus.tenant_modules (tenant_id, module_id)
  where status in ('trial', 'active') and enabled;

comment on column nexus.tenant_modules.enabled is
  'Apagado por el cliente. Los datos permanecen intactos; desinstalar nunca borra (§4.3).';

-- ── Consumo medido ─────────────────────────────────────────────────────
create table nexus.usage_meters (
  tenant_id uuid not null references nexus.tenants(id) on delete cascade,
  period    date not null,                                -- primer dia del mes
  metric    text not null
              check (metric in ('users','storage_gb','transactions','ecf','sms','whatsapp','api_calls','sku')),
  quantity  numeric(14,2) not null default 0 check (quantity >= 0),
  primary key (tenant_id, period, metric)
);

-- ── Facturas ───────────────────────────────────────────────────────────
create table nexus.invoices (
  id           uuid primary key default gen_random_uuid(),
  -- `restrict` a proposito, no `cascade`: una factura es un registro
  -- contable y fiscal. Un tenant con facturas emitidas no se borra —
  -- se archiva (status = 'archived'). Ver §6.6 y la regla "nunca borrar".
  tenant_id    uuid not null references nexus.tenants(id) on delete restrict,
  number       text not null unique,
  period_start date not null,
  period_end   date not null,
  subtotal     numeric(12,2) not null,
  discount     numeric(12,2) not null default 0,
  tax          numeric(12,2) not null default 0,
  total        numeric(12,2) not null,
  currency     char(3) not null default 'USD',
  fx_rate      numeric(12,4),
  status       nexus.invoice_status not null default 'draft',
  due_at       date not null,
  paid_at      timestamptz,
  -- Desglose completo: que modulo, que precio, que descuento.
  -- Permite reconstruir la factura anos despues aunque los precios cambien (§6 grandfathering).
  lines        jsonb not null,
  created_at   timestamptz not null default now(),
  check (period_end >= period_start)
);

create index on nexus.invoices (tenant_id, period_start desc);
create index on nexus.invoices (status, due_at) where status in ('sent', 'overdue');

-- ── Onboarding ─────────────────────────────────────────────────────────
create table nexus.onboarding (
  tenant_id      uuid primary key references nexus.tenants(id) on delete cascade,
  stage          text not null default 'sold'
                   check (stage in ('sold','migration','config','training','live')),
  owner_user_id  uuid,
  checklist      jsonb not null default '[]',
  target_go_live date,
  blockers       text,
  updated_at     timestamptz not null default now()
);

-- ── Impersonacion ──────────────────────────────────────────────────────
--  Documento maestro §7.4: MFA + razon + ticket + 60 min + banner + doble auditoria.
create table nexus.impersonation_log (
  id            uuid primary key default gen_random_uuid(),
  provider_user uuid not null,
  -- `restrict`, igual que las facturas: este log es la evidencia de cada vez
  -- que el proveedor entro a los datos de un cliente. Debe sobrevivir al
  -- cliente, o la auditoria no vale nada.
  tenant_id     uuid not null references nexus.tenants(id) on delete restrict,
  reason        text not null check (length(trim(reason)) >= 10),
  ticket_ref    text,
  write_mode    boolean not null default false,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

-- Solo una sesion de impersonacion abierta por usuario del proveedor.
create unique index on nexus.impersonation_log (provider_user) where ended_at is null;
create index on nexus.impersonation_log (tenant_id, started_at desc);

comment on column nexus.impersonation_log.reason is
  'Obligatoria y de minimo 10 caracteres. Sin razon escrita no hay impersonacion.';

-- ── updated_at automatico ──────────────────────────────────────────────
create trigger touch before update on nexus.tenants
  for each row execute function public.touch_updated_at();
create trigger touch before update on nexus.subscriptions
  for each row execute function public.touch_updated_at();
create trigger touch before update on nexus.onboarding
  for each row execute function public.touch_updated_at();

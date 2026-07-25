-- ═══════════════════════════════════════════════════════════════════════
--  0003 — Esquema `public`: el nucleo de cada cliente
--
--  TODA tabla de este esquema lleva tenant_id y RLS. Sin excepciones.
--  Documento maestro §9.3.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Empresas (razones sociales dentro de un mismo cliente) ─────────────
create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  legal_name text not null,
  trade_name text,
  tax_id     text,
  currency   char(3) not null default 'DOP',
  address    text,
  phone      text,
  email      text,
  logo_url   text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index on public.companies (tenant_id) where deleted_at is null;
create unique index on public.companies (tenant_id) where is_default and deleted_at is null;

-- ── Sucursales ─────────────────────────────────────────────────────────
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  company_id  uuid not null references public.companies(id),
  name        text not null,
  code        text,
  address     text,
  lat         numeric(10,7),
  lng         numeric(10,7),
  geofence_m  integer not null default 150 check (geofence_m > 0),
  timezone    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index on public.branches (tenant_id, company_id) where deleted_at is null;
create unique index on public.branches (tenant_id, code) where code is not null and deleted_at is null;

-- ── Roles ──────────────────────────────────────────────────────────────
--  Documento maestro §8. Tres niveles de ocultamiento:
--   1. licencia   → regb.tenant_modules  (lo controlas tu)
--   2. config     → tenant_modules.enabled (lo controla el cliente)
--   3. rol        → roles.visible_modules  (lo controla el admin del cliente)
create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references regb.tenants(id) on delete cascade,
  name            text not null,
  description     text,
  is_system       boolean not null default false,   -- roles predefinidos, no borrables
  -- Modulos visibles en el sidebar para este rol.
  -- OJO: esto es ergonomia, NO seguridad. La seguridad vive en RLS y en
  -- la validacion de permisos en servidor. Ver §8.3.
  visible_modules text[] not null default '{}',
  -- { "quotes.create": true, "quotes.approve": false }
  permissions     jsonb not null default '{}',
  -- { "branches": [...], "max_amount": 50000, "own_only": true, "hours": "07:00-19:00" }
  scope           jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, name)
);

create index on public.roles (tenant_id);

-- ── Membresias (usuario ↔ tenant ↔ rol) ────────────────────────────────
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  user_id     uuid not null,
  role_id     uuid not null references public.roles(id),
  branch_ids  uuid[] not null default '{}',
  company_ids uuid[] not null default '{}',
  is_active   boolean not null default true,
  invited_at  timestamptz,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index on public.memberships (tenant_id, role_id) where is_active;
create index on public.memberships (user_id);

-- ── Progreso del tutorial ──────────────────────────────────────────────
--  Por USUARIO, no por tenant: cada persona aprende a su ritmo (§14).
create table public.tour_progress (
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  user_id    uuid not null,
  tour_id    text not null,                          -- 'inventory.intro'
  step       smallint not null default 0,
  completed  boolean not null default false,
  skipped    boolean not null default false,
  xp_awarded integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, tour_id)
);

create index on public.tour_progress (tenant_id, user_id) where not completed;

-- ── Bus de eventos entre modulos ───────────────────────────────────────
--  Documento maestro §4.4. Entrega at-least-once con trazabilidad.
create table public.event_outbox (
  id             bigserial primary key,
  tenant_id      uuid not null references regb.tenants(id) on delete cascade,
  type           text not null,                      -- 'sales.order.confirmed'
  payload        jsonb not null,
  emitted_by     text not null,                      -- module id
  correlation_id uuid not null default gen_random_uuid(),
  emitted_at     timestamptz not null default now(),
  processed_at   timestamptz,
  attempts       smallint not null default 0,
  last_error     text
);

create index event_outbox_pending_idx
  on public.event_outbox (emitted_at)
  where processed_at is null;
create index on public.event_outbox (tenant_id, type, emitted_at desc);

-- ── updated_at automatico ──────────────────────────────────────────────
create trigger touch before update on public.companies
  for each row execute function public.touch_updated_at();
create trigger touch before update on public.branches
  for each row execute function public.touch_updated_at();
create trigger touch before update on public.roles
  for each row execute function public.touch_updated_at();
create trigger touch before update on public.memberships
  for each row execute function public.touch_updated_at();

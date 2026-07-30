-- ═══════════════════════════════════════════════════════════════════════
--  0016 — Tablas de los modulos core (F2: S8-S13)
--
--  users · settings · notifications · files · products · imports · backup
--
--  Patron RLS (§10): tenant + modulo activo. Los core estan siempre
--  provisionados (0011), pero la politica es uniforme igual: si un dia un
--  modulo core se suspende, sus datos desaparecen de la vista, no del disco.
-- ═══════════════════════════════════════════════════════════════════════

-- ── users: perfil visible de cada miembro ───────────────────────────────
--  La identidad (password, MFA) vive en auth.users de Supabase; esto es lo
--  que el tenant VE de su gente: nombre, correo, telefono.
create table public.user_profiles (
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  user_id      uuid not null,
  display_name text not null,
  email        text not null,
  phone        text,
  job_title    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- ── settings: configuracion del tenant, editable por el propio tenant ──
--  regb.tenants es del proveedor; esto es lo que el cliente decide solo.
create table public.tenant_settings (
  tenant_id   uuid primary key references regb.tenants(id) on delete cascade,
  trade_name  text,
  timezone    text not null default 'America/Santo_Domingo',
  currency    char(3) not null default 'DOP',
  locale      text not null default 'es-DO',
  date_format text not null default 'DD/MM/YYYY',
  prefs       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- ── notifications ───────────────────────────────────────────────────────
--  user_id null = para todo el tenant (anuncio).
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  user_id    uuid,
  module_id  text not null default 'core',
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index on public.notifications (tenant_id, user_id, created_at desc)
  where read_at is null;

-- ── files: gestor documental ────────────────────────────────────────────
--  En produccion el binario vive en Supabase Storage y aqui la metadata;
--  en desarrollo se admite contenido pequeno inline para que el modulo
--  funcione completo sin depender de un bucket.
create table public.files (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references regb.tenants(id) on delete cascade,
  name        text not null,
  mime        text not null default 'application/octet-stream',
  size_bytes  integer not null default 0 check (size_bytes >= 0),
  storage_key text,                        -- Supabase Storage (produccion)
  content     bytea,                       -- inline (desarrollo, <=512 KB)
  module_id   text not null default 'files',
  uploaded_by uuid,
  deleted_at  timestamptz,                 -- papelera: nunca borrado fisico
  created_at  timestamptz not null default now(),
  check (content is null or size_bytes <= 524288)
);

create index on public.files (tenant_id, created_at desc) where deleted_at is null;

-- ── products: el catalogo minimo ────────────────────────────────────────
--  Modulo 47. La version completa (variantes, kits) llega en F4; esta base
--  ya da destino real a imports y datos reales al dashboard.
create table public.products (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  sku        text not null,
  name       text not null,
  category   text,
  unit       text not null default 'unidad',
  price      numeric(12,2) not null default 0 check (price >= 0),
  cost       numeric(12,2) check (cost >= 0),
  active     boolean not null default true,
  import_batch_id uuid,                    -- de que importacion vino, si aplica
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

create index on public.products (tenant_id, active, name);

-- ── imports: lotes con deshacer ─────────────────────────────────────────
create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  target       text not null check (target in ('products')),
  file_name    text not null,
  total_rows   integer not null default 0,
  inserted     integer not null default 0,
  rejected     integer not null default 0,
  errors       jsonb not null default '[]',
  created_by   uuid,
  undone_at    timestamptz,
  created_at   timestamptz not null default now()
);

-- ── backup: respaldos del tenant ────────────────────────────────────────
create table public.backups (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references regb.tenants(id) on delete cascade,
  kind       text not null default 'manual' check (kind in ('manual','scheduled')),
  payload    jsonb not null,
  size_bytes integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('user_profiles',  'users'),
      ('tenant_settings','settings'),
      ('notifications',  'notifications'),
      ('files',          'files'),
      ('products',       'products'),
      ('import_batches', 'imports'),
      ('backups',        'backup')
    ) as t(tabla, modulo)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);
    execute format('alter table public.%I force row level security', r.tabla);
    execute format(
      'create policy tenant_module on public.%I for all
         using (tenant_id = auth.tenant_id() and auth.module_active(%L))
         with check (tenant_id = auth.tenant_id() and auth.module_active(%L))',
      r.tabla, r.modulo, r.modulo);
    execute format(
      'create policy provider_impersonating on public.%I for select
         using (auth.impersonating(tenant_id))', r.tabla);
  end loop;
end $$;

-- ── Bitacora automatica donde importa ───────────────────────────────────
create trigger audit_me after insert or update or delete on public.companies
  for each row execute function audit.record('orgs');
create trigger audit_me after insert or update or delete on public.branches
  for each row execute function audit.record('branches');
create trigger audit_me after insert or update or delete on public.memberships
  for each row execute function audit.record('users');
create trigger audit_me after insert or update or delete on public.user_profiles
  for each row execute function audit.record('users');
create trigger audit_me after insert or update or delete on public.products
  for each row execute function audit.record('products');
create trigger audit_me after insert or update or delete on public.files
  for each row execute function audit.record('files');

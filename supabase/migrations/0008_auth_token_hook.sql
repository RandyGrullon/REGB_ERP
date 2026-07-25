-- ═══════════════════════════════════════════════════════════════════════
--  0008 — Custom Access Token Hook
--
--  LA PIEZA QUE CIERRA EL CIRCULO DE SEGURIDAD.
--
--  Todo el aislamiento de REGB descansa en que `auth.tenant_id()` lea un
--  tenant del JWT. Hasta ahora ese claim lo poniamos a mano. Aqui lo pone
--  Postgres, en el momento exacto en que Supabase emite el token, leyendo
--  de `public.memberships`.
--
--  Consecuencia: el tenant_id de un usuario NO es un dato que viaje por la
--  aplicacion y pueda manipularse. Es una consecuencia de una fila en la
--  base. Para cambiar de tenant hay que cambiar esa fila.
--
--  Documento maestro §10.1.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Usuarios del proveedor (REGB Control) ──────────────────────────────
--  Tabla aparte y no una columna en memberships: un usuario del proveedor
--  no pertenece a ningun tenant. Son poblaciones distintas.
create table regb.provider_users (
  user_id    uuid primary key,
  full_name  text not null,
  role       text not null default 'support'
               check (role in ('owner', 'admin', 'csm', 'support', 'finance')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table regb.provider_users enable row level security;
alter table regb.provider_users force row level security;
create policy provider_only on regb.provider_users
  for all using (auth.is_provider()) with check (auth.is_provider());

-- Defensa en profundidad: ademas de la politica RLS, `authenticated` no
-- tiene NINGUN grant sobre esta tabla. Un cliente no recibe una lista
-- vacia: recibe "permission denied", sin llegar a evaluar la politica.
-- Es deliberado. Si un dia el grant apareciera por error, la RLS sigue
-- cubriendo; si la RLS fallara, el grant sigue cubriendo.
revoke all on regb.provider_users from anon, authenticated;

comment on table regb.provider_users is
  'Quien puede entrar a REGB Control. Ser proveedor es pertenecer a esta tabla, nada mas. Sin grant para clientes: doble barrera.';

-- ═══════════════════════════════════════════════════════════════════════
--  El hook
--
--  Supabase lo invoca al emitir cada access token. Recibe el evento con
--  el user_id y los claims, y devuelve los claims enriquecidos.
--
--  Si algo falla aqui, el usuario recibe un token SIN tenant_id, y con RLS
--  eso significa que no ve absolutamente nada. Fallar cerrado es correcto:
--  un error de este hook nunca puede traducirse en ver datos de mas.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function auth.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid;
  v_claims   jsonb;
  v_app_meta jsonb;
  v_m        record;
  v_provider record;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := event -> 'claims';
  v_app_meta := coalesce(v_claims -> 'app_metadata', '{}'::jsonb);

  -- ── ¿Es un usuario de REGB Control? ─────────────────────────────────
  select * into v_provider
  from regb.provider_users
  where user_id = v_user_id and is_active;

  if found then
    v_app_meta := v_app_meta
      || jsonb_build_object(
           'is_provider', true,
           'provider_role', v_provider.role,
           'tenant_id', null
         );
    return jsonb_set(event, '{claims,app_metadata}', v_app_meta);
  end if;

  -- ── Usuario de un cliente ───────────────────────────────────────────
  --  `is_active` en la membresia: dar de baja a un empleado le corta el
  --  acceso en el siguiente refresh, sin borrar su historial.
  select m.tenant_id, m.role_id, m.branch_ids, m.company_ids, t.status
  into v_m
  from public.memberships m
  join regb.tenants t on t.id = m.tenant_id
  where m.user_id = v_user_id
    and m.is_active
    and m.accepted_at is not null
  limit 1;

  if not found then
    -- Sin membresia aceptada no hay tenant. El usuario entra pero no ve
    -- nada: la app le muestra "esperando invitacion", no un error.
    return jsonb_set(
      event, '{claims,app_metadata}',
      v_app_meta || jsonb_build_object('is_provider', false, 'tenant_id', null)
    );
  end if;

  -- Un tenant archivado o suspendido no emite tenant_id: el usuario deja
  -- de ver datos aunque su sesion siguiera viva.
  if v_m.status in ('suspended', 'archived') then
    return jsonb_set(
      event, '{claims,app_metadata}',
      v_app_meta || jsonb_build_object(
        'is_provider', false, 'tenant_id', null, 'tenant_status', v_m.status
      )
    );
  end if;

  return jsonb_set(
    event, '{claims,app_metadata}',
    v_app_meta || jsonb_build_object(
      'is_provider',   false,
      'tenant_id',     v_m.tenant_id,
      'role_id',       v_m.role_id,
      'tenant_status', v_m.status,
      'branches',      to_jsonb(v_m.branch_ids),
      'companies',     to_jsonb(v_m.company_ids)
    )
  );
end;
$$;

comment on function auth.custom_access_token_hook(jsonb) is
  'Inyecta tenant_id, role_id e is_provider en el JWT desde public.memberships. Falla cerrado.';

-- ── Permisos del hook ──────────────────────────────────────────────────
--  Solo el servicio de auth de Supabase puede invocarlo. Si un cliente
--  pudiera llamarlo, podria fabricarse claims.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema auth to supabase_auth_admin;
    grant execute on function auth.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant select on public.memberships to supabase_auth_admin;
    grant select on regb.tenants to supabase_auth_admin;
    grant select on regb.provider_users to supabase_auth_admin;
  end if;
end $$;

revoke execute on function auth.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Invitaciones
--
--  Nadie se registra solo en REGB (§ config.toml: enable_signup = false).
--  Un admin invita, y esta funcion crea la membresia pendiente.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.invite_member(
  p_email   text,
  p_role_id uuid,
  p_branch_ids uuid[] default '{}',
  p_company_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := auth.tenant_id();
  v_user   uuid;
  v_id     uuid;
begin
  if v_tenant is null then
    raise exception 'No se puede invitar sin un tenant en el JWT';
  end if;

  -- El rol tiene que ser del mismo tenant: si no, un admin podria asignar
  -- un rol de otro cliente y colarse por ahi.
  if not exists (
    select 1 from public.roles where id = p_role_id and tenant_id = v_tenant
  ) then
    raise exception 'El rol no pertenece a este cliente';
  end if;

  -- `auth.users` existe en Supabase pero no en un Postgres limpio (CI).
  -- Se consulta dinamicamente para que la funcion sea portable: si la
  -- tabla no esta, la membresia se crea con un id provisional y se
  -- reconcilia cuando la persona acepta la invitacion.
  if to_regclass('auth.users') is not null then
    execute 'select id from auth.users where email = $1'
      into v_user using lower(trim(p_email));
  end if;

  insert into public.memberships
    (tenant_id, user_id, role_id, branch_ids, company_ids, is_active, invited_at)
  values
    (v_tenant, coalesce(v_user, gen_random_uuid()), p_role_id,
     p_branch_ids, p_company_ids, true, now())
  on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id,
        branch_ids = excluded.branch_ids,
        company_ids = excluded.company_ids,
        is_active = true
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.invite_member(text, uuid, uuid[], uuid[]) to authenticated;

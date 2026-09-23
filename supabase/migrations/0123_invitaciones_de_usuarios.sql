-- ═══════════════════════════════════════════════════════════════════════
--  0123 — Invitar a alguien sin inventarlo
--
--  ── El defecto ────────────────────────────────────────────────────────
--
--  Invitar desde /usuarios insertaba un perfil y una membresia con un
--  `user_id` fabricado (`crypto.randomUUID()`) y no mandaba nada. Con
--  Supabase real esa fila jamas se enlaza con la persona: su `auth.users`
--  tendra OTRO id, el hook no encuentra membresia y la persona entra a
--  "esperando invitacion" para siempre. Invitar, en la practica, no
--  funcionaba.
--
--  `public.invite_member()` (0008) hacia lo mismo desde PostgREST -si el
--  correo no estaba en auth.users, `gen_random_uuid()`-, sin mirar el
--  permiso `users.create`, y con un `on conflict ... do update set
--  role_id` que dejaba a cualquiera del cliente cambiarle el rol a una
--  membresia existente -incluida la suya- "invitandola" de nuevo.
--
--  ── El arreglo ────────────────────────────────────────────────────────
--
--  1. `public.user_invitations`: lo pendiente vive aqui, NO en
--     `memberships`. Correo normalizado, rol con guarda de cliente, token
--     guardado como sha256 -el token en claro sale una sola vez de
--     `crear_invitacion()` y nunca se guarda-, vencimiento, estado y quien
--     invito.
--  2. La membresia nace SOLO en `aceptar_invitacion(token)`, con el `sub`
--     del token de quien acepta -una persona real de auth.users- y solo si
--     su correo es el invitado.
--  3. Nadie escribe la tabla directo: authenticated no tiene INSERT,
--     UPDATE ni DELETE, y ni siquiera puede LEER la columna del hash. Se
--     entra por funciones que miran cliente, modulo y PERMISO -PostgREST
--     no pasa por `exigir()` de la app, asi que la base lo mira tambien-.
--  4. `invite_member()` se elimina: era la otra puerta que inventaba ids.
-- ═══════════════════════════════════════════════════════════════════════

create table public.user_invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references regb.tenants(id) on delete cascade,
  -- Normalizado en la entrada: '  Juana@X.DO ' y 'juana@x.do' son la
  -- misma persona, y el unico indice de "una pendiente por correo" lo
  -- necesita asi.
  email        text not null
                 check (email = lower(btrim(email))
                        and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name text not null check (char_length(btrim(display_name)) between 3 and 120),
  role_id      uuid not null references public.roles(id),
  -- sha256 en hex del token. El token en claro NO existe en la base.
  token_hash   text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at   timestamptz not null,
  invited_by   uuid,
  -- Cuando salio el ULTIMO correo de verdad. Null = nunca se envio un
  -- correo (modo demostracion, o fallo el envio): la pantalla no puede
  -- decir "enviada" si esto esta vacio.
  sent_at      timestamptz,
  send_count   integer not null default 0 check (send_count >= 0),
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz,
  revoked_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((status = 'accepted') = (accepted_at is not null and accepted_by is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

comment on table public.user_invitations is
  'Invitaciones pendientes del modulo users. La membresia NO existe hasta aceptar_invitacion(). Token solo como sha256 (0123).';
comment on column public.user_invitations.token_hash is
  'sha256 hex del token del enlace. authenticated no puede leer esta columna. Se compara en aceptar_invitacion().';

-- La lista de la pantalla: cliente primero, como toda tabla de negocio.
create index user_invitations_lista
  on public.user_invitations (tenant_id, status, created_at desc);

-- Una sola pendiente por correo y cliente. Si hay otra vencida por fecha,
-- crear_invitacion() la cierra antes de abrir la nueva.
create unique index user_invitations_una_pendiente
  on public.user_invitations (tenant_id, email) where status = 'pending';

-- El UNICO acceso sin cliente al frente, a proposito: quien acepta todavia
-- no tiene tenant en su token -por eso esta aceptando-. La llave es el
-- propio hash, 256 bits: no se enumera.
create unique index user_invitations_token on public.user_invitations (token_hash);

create trigger touch before update on public.user_invitations
  for each row execute function public.touch_updated_at();

-- ── El agujero de siempre: una FK a una tabla con tenant_id ────────────
--  Una FK se valida sin pasar por la RLS: sin esto, un role_id de otro
--  cliente se guarda. Guarda PROPIA de esta tabla (la de memberships la
--  cierra otra migracion).
create function public.impedir_rol_ajeno_invitacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.roles where id = new.role_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'El rol no pertenece a este cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_rol_ajeno
  before insert or update of tenant_id, role_id on public.user_invitations
  for each row execute function public.impedir_rol_ajeno_invitacion();

-- ── Aceptada, revocada o vencida es terminal ───────────────────────────
create function public.impedir_editar_invitacion_cerrada() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'Esa invitacion ya no esta pendiente (%). No se modifica.', old.status
      using errcode = '55000';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.email is distinct from old.email then
    raise exception 'Una invitacion no cambia de cliente ni de correo.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger no_editar_cerrada
  before update on public.user_invitations
  for each row execute function public.impedir_editar_invitacion_cerrada();

-- ── Bitacora, con el hash oculto (mecanismo de 0103) ────────────────────
create trigger audit_me after insert or update on public.user_invitations
  for each row execute function audit.record('users', 'token_hash');

-- ═══════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.user_invitations enable row level security;
alter table public.user_invitations force row level security;

-- Solo lectura. Correos de gente que todavia no es del equipo: ademas de
-- cliente y modulo, el permiso de ver usuarios (patron de 0109).
create policy tenant_module on public.user_invitations for select
  using (tenant_id = rls.tenant_id()
         and rls.module_active('users')
         and rls.has_perm('users.view'));

create policy provider_impersonating on public.user_invitations for select
  using (rls.impersonating(tenant_id));

-- Sin politica de escritura Y sin grant de escritura: doble barrera. Las
-- funciones de abajo son la unica puerta.
--
-- El grant de lectura va columna por columna para dejar fuera
-- `token_hash` (en Postgres un revoke de columna no le resta nada a un
-- grant de tabla entera; hay que revocar la tabla y conceder columnas).
revoke all on public.user_invitations from public, anon, authenticated;
grant select (id, tenant_id, email, display_name, role_id, status, expires_at, invited_by,
              sent_at, send_count, accepted_at, accepted_by, revoked_at, revoked_by,
              created_at, updated_at)
  on public.user_invitations to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Utilidades internas (no se exponen)
-- ═══════════════════════════════════════════════════════════════════════

-- Cliente del token + modulo users activo + permiso. Devuelve el tenant.
create function public.usuarios_exigir(p_accion text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sesion sin cliente.' using errcode = '28000';
  end if;
  if not rls.module_active('users') then
    raise exception 'El modulo de usuarios no esta activo.' using errcode = '42501';
  end if;
  if not rls.has_perm(p_accion) then
    raise exception 'Tu rol no permite gestionar invitaciones (%).', p_accion
      using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;

-- 256 bits de azar. gen_random_uuid() sale del generador fuerte de
-- Postgres; dos juntos pasados por sha256 dan un token uniforme en hex.
create function public.invitacion_token_nuevo()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex')
$$;

create function public.invitacion_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

revoke all on function public.usuarios_exigir(text) from public, anon, authenticated;
revoke all on function public.invitacion_token_nuevo() from public, anon, authenticated;
revoke all on function public.invitacion_hash(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Invitar
-- ═══════════════════════════════════════════════════════════════════════
create function public.crear_invitacion(
  p_email        text,
  p_display_name text,
  p_role_id      uuid,
  p_dias         integer default 7
)
returns table (invitacion uuid, token text, vence timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.usuarios_exigir('users.create');
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_nombre text := btrim(coalesce(p_display_name, ''));
  v_token  text := public.invitacion_token_nuevo();
  v_id     uuid;
  v_vence  timestamptz;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Ese correo no es valido. Revisalo: debe verse como juana@tuempresa.do.'
      using errcode = '22023';
  end if;
  if char_length(v_nombre) < 3 then
    raise exception 'El nombre necesita al menos 3 letras.' using errcode = '22023';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 30 then
    raise exception 'La invitacion vence entre 1 y 30 dias.' using errcode = '22023';
  end if;

  -- El rol, del mismo cliente. El trigger lo vuelve a mirar; aqui se
  -- mira primero para dar el mensaje antes de gastar un token.
  if not exists (select 1 from public.roles where id = p_role_id and tenant_id = v_tenant) then
    raise exception 'El rol no pertenece a este cliente.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.user_profiles p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = p.user_id
    where p.tenant_id = v_tenant and lower(p.email) = v_email
      and m.is_active and m.accepted_at is not null
  ) then
    raise exception 'Esa persona ya esta en el equipo. Cambiale el rol desde la lista.'
      using errcode = '23505';
  end if;

  -- Una pendiente que ya vencio por fecha se cierra como vencida: queda en
  -- la historia y deja sitio a la nueva.
  update public.user_invitations
  set status = 'expired'
  where tenant_id = v_tenant and email = v_email
    and status = 'pending' and expires_at <= now();

  if exists (
    select 1 from public.user_invitations
    where tenant_id = v_tenant and email = v_email and status = 'pending'
  ) then
    raise exception 'Ya hay una invitacion pendiente para ese correo. Reenviala o revocala.'
      using errcode = '23505';
  end if;

  v_vence := now() + make_interval(days => p_dias);

  insert into public.user_invitations
    (tenant_id, email, display_name, role_id, token_hash, expires_at, invited_by)
  values
    (v_tenant, v_email, v_nombre, p_role_id, public.invitacion_hash(v_token), v_vence,
     rls.regb_uid())
  returning id into v_id;

  -- En la misma transaccion: si algo revierte, el evento tampoco existe.
  -- SOLO ids: los eventos pueden salir a webhooks de terceros
  -- (api-webhooks), asi que ni el correo -dato personal- ni, desde luego,
  -- el token. Quien necesite el correo lo lee con su permiso, bajo RLS.
  perform public.emit_event(
    'users.member.invited',
    jsonb_build_object('invitation_id', v_id, 'role_id', p_role_id),
    'users'
  );

  invitacion := v_id;
  token := v_token;
  vence := v_vence;
  return next;
end;
$$;

comment on function public.crear_invitacion(text, text, uuid, integer) is
  'Crea una invitacion pendiente y devuelve el token en claro UNA sola vez (se guarda solo su sha256). No crea membresia ni perfil. Exige users.create (0123).';

-- ═══════════════════════════════════════════════════════════════════════
--  Reenviar: token NUEVO. El enlace anterior deja de servir.
--
--  No hay forma de "reenviar el mismo enlace": el token en claro no se
--  guardo nunca. Y esta bien asi: si el correo anterior se perdio o cayo en
--  otras manos, el reenvio lo invalida.
-- ═══════════════════════════════════════════════════════════════════════
create function public.reenviar_invitacion(p_id uuid, p_dias integer default 7)
returns table (invitacion uuid, token text, vence timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.usuarios_exigir('users.create');
  v_token  text := public.invitacion_token_nuevo();
  v_estado text;
  v_vence  timestamptz;
begin
  if p_dias is null or p_dias < 1 or p_dias > 30 then
    raise exception 'La invitacion vence entre 1 y 30 dias.' using errcode = '22023';
  end if;

  select status into v_estado
  from public.user_invitations
  where id = p_id and tenant_id = v_tenant
  for update;

  if v_estado is null then
    raise exception 'Esa invitacion no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_estado <> 'pending' then
    raise exception 'Esa invitacion ya no esta pendiente (%). Crea una nueva.', v_estado
      using errcode = '55000';
  end if;

  v_vence := now() + make_interval(days => p_dias);

  update public.user_invitations
  set token_hash = public.invitacion_hash(v_token),
      expires_at = v_vence
  where id = p_id and tenant_id = v_tenant;

  invitacion := p_id;
  token := v_token;
  vence := v_vence;
  return next;
end;
$$;

comment on function public.reenviar_invitacion(uuid, integer) is
  'Rota el token de una invitacion pendiente y renueva el vencimiento. El enlace anterior deja de servir. Exige users.create (0123).';

-- ═══════════════════════════════════════════════════════════════════════
--  Revocar
-- ═══════════════════════════════════════════════════════════════════════
create function public.revocar_invitacion(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.usuarios_exigir('users.create');
  v_estado text;
begin
  select status into v_estado
  from public.user_invitations
  where id = p_id and tenant_id = v_tenant
  for update;

  if v_estado is null then
    raise exception 'Esa invitacion no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_estado <> 'pending' then
    raise exception 'Esa invitacion ya no esta pendiente (%).', v_estado using errcode = '55000';
  end if;

  update public.user_invitations
  set status = 'revoked', revoked_at = now(), revoked_by = rls.regb_uid()
  where id = p_id and tenant_id = v_tenant;

  return p_id;
end;
$$;

comment on function public.revocar_invitacion(uuid) is
  'Revoca una invitacion pendiente: su enlace deja de servir. Terminal. Exige users.create (0123).';

-- ═══════════════════════════════════════════════════════════════════════
--  Para la Edge Function `invitar-usuario`
--
--  La funcion corre con el token de QUIEN INVITA, asi que aqui aplican su
--  cliente, su modulo y su permiso. Devuelve a quien escribirle solo si el
--  token del enlace corresponde a esa invitacion: sin eso la Edge Function
--  seria un relevo para mandar correos de Supabase a cualquier direccion.
--  El service_role de la Edge Function se usa SOLO para enviar, nunca para
--  leer la base.
-- ═══════════════════════════════════════════════════════════════════════
create function public.invitacion_para_enviar(p_id uuid, p_token text)
returns table (email text, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.usuarios_exigir('users.create');
  v_inv    record;
begin
  select i.email, i.display_name, i.status, i.expires_at, i.token_hash into v_inv
  from public.user_invitations i
  where i.id = p_id and i.tenant_id = v_tenant;

  if not found then
    raise exception 'Esa invitacion no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Esa invitacion ya no esta pendiente (%).', v_inv.status using errcode = '55000';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Esa invitacion vencio. Reenviala para generar un enlace nuevo.'
      using errcode = '55000';
  end if;
  if v_inv.token_hash <> public.invitacion_hash(p_token) then
    raise exception 'El enlace no corresponde a esa invitacion.' using errcode = '42501';
  end if;

  email := v_inv.email;
  nombre := v_inv.display_name;
  return next;
end;
$$;

create function public.marcar_invitacion_enviada(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.usuarios_exigir('users.create');
begin
  update public.user_invitations
  set sent_at = now(), send_count = send_count + 1
  where id = p_id and tenant_id = v_tenant and status = 'pending';

  if not found then
    raise exception 'Esa invitacion no es de esta cuenta o ya no esta pendiente.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.marcar_invitacion_enviada(uuid) is
  'Deja constancia de que el correo de invitacion SALIO (lo llama la app tras la respuesta 200 de la Edge Function). Sin esto la pantalla no dice "enviada" (0123).';

-- ═══════════════════════════════════════════════════════════════════════
--  Aceptar
--
--  La llama quien abrio el enlace, YA con sesion de Supabase (el enlace
--  del correo la abre; o inicio sesion a mano). Su token todavia no trae
--  cliente: por eso existe esta funcion y por eso es security definer.
--
--  De quien acepta se usa SOLO lo que Supabase firmo:
--   · `sub` del token -> el user_id de la membresia. Nunca uno inventado.
--   · su correo -> de auth.users (confirmado) si la tabla existe; en un
--     Postgres sin Supabase (CI) del claim `email`, que en Supabase sale
--     de esa misma fila y va firmado.
--
--  Devuelve un resultado en vez de lanzar error para poder GUARDAR el
--  vencimiento: un raise revertiria el `status = 'expired'`.
--
--  El evento se escribe directo en el outbox y no con emit_event(): esa
--  funcion toma el cliente del JWT, y quien acepta aun no lo tiene. El
--  cliente sale de la invitacion, que es la fuente correcta.
-- ═══════════════════════════════════════════════════════════════════════
create function public.aceptar_invitacion(p_token text)
returns table (resultado text, cliente uuid, membresia uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := rls.regb_uid();
  v_claims     jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_email      text;
  v_confirmado timestamptz;
  v_inv        record;
  v_m          record;
begin
  resultado := null;
  cliente := null;
  membresia := null;

  if v_uid is null then
    resultado := 'sin_sesion';
    return next;
    return;
  end if;

  if to_regclass('auth.users') is not null then
    execute 'select email, email_confirmed_at from auth.users where id = $1'
      into v_email, v_confirmado using v_uid;
    if v_email is null then
      resultado := 'sin_sesion';
      return next;
      return;
    end if;
    if v_confirmado is null then
      resultado := 'correo_sin_confirmar';
      return next;
      return;
    end if;
  else
    v_email := v_claims ->> 'email';
  end if;
  v_email := lower(btrim(coalesce(v_email, '')));
  if v_email = '' then
    resultado := 'sin_sesion';
    return next;
    return;
  end if;

  select * into v_inv
  from public.user_invitations
  where token_hash = public.invitacion_hash(p_token)
  for update;

  if not found then
    resultado := 'invalida';
    return next;
    return;
  end if;

  if v_inv.status = 'accepted' then
    if v_inv.accepted_by = v_uid then
      resultado := 'ya_aceptada';
      cliente := v_inv.tenant_id;
      select id into membresia from public.memberships
      where tenant_id = v_inv.tenant_id and user_id = v_uid;
    else
      resultado := 'invalida';
    end if;
    return next;
    return;
  end if;
  if v_inv.status = 'revoked' then
    resultado := 'revocada';
    return next;
    return;
  end if;
  if v_inv.status = 'expired' then
    resultado := 'vencida';
    return next;
    return;
  end if;
  if v_inv.expires_at <= now() then
    update public.user_invitations set status = 'expired' where id = v_inv.id;
    resultado := 'vencida';
    return next;
    return;
  end if;

  if v_inv.email <> v_email then
    -- El enlace llego a otra persona, o entro con otra cuenta. No se
    -- toca la invitacion: la dueña del correo todavia puede aceptarla.
    resultado := 'otro_correo';
    return next;
    return;
  end if;

  -- El hook toma UNA membresia activa con `limit 1` y sin orden: con dos
  -- clientes, a cual entra no esta definido. Hasta que exista un selector
  -- de empresa, una cuenta pertenece a un solo cliente.
  if exists (
    select 1 from public.memberships
    where user_id = v_uid and tenant_id <> v_inv.tenant_id
      and is_active and accepted_at is not null
  ) then
    resultado := 'otro_cliente';
    return next;
    return;
  end if;

  select id, is_active, accepted_at into v_m
  from public.memberships
  where tenant_id = v_inv.tenant_id and user_id = v_uid;

  if found and v_m.is_active and v_m.accepted_at is not null then
    -- Ya esta dentro. Aceptar no puede servir para cambiarse el rol.
    resultado := 'ya_miembro';
    cliente := v_inv.tenant_id;
    membresia := v_m.id;
    return next;
    return;
  end if;

  -- Nueva, o alguien que estuvo y fue desactivado: invitarlo de nuevo es
  -- devolverle el acceso con el rol de ESTA invitacion.
  insert into public.memberships as m
    (tenant_id, user_id, role_id, is_active, invited_at, accepted_at)
  values
    (v_inv.tenant_id, v_uid, v_inv.role_id, true, v_inv.created_at, now())
  on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id,
        is_active = true,
        invited_at = excluded.invited_at,
        accepted_at = now()
  returning m.id into membresia;

  insert into public.user_profiles (tenant_id, user_id, display_name, email)
  values (v_inv.tenant_id, v_uid, v_inv.display_name, v_inv.email)
  on conflict (tenant_id, user_id) do update set email = excluded.email;

  update public.user_invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  -- Solo ids, igual que invited: puede salir a un webhook de terceros.
  insert into public.event_outbox (tenant_id, type, payload, emitted_by)
  values (
    v_inv.tenant_id,
    'users.member.joined',
    jsonb_build_object(
      'invitation_id', v_inv.id,
      'membership_id', membresia,
      'user_id', v_uid,
      'role_id', v_inv.role_id
    ),
    'users'
  );

  resultado := 'aceptada';
  cliente := v_inv.tenant_id;
  return next;
end;
$$;

comment on function public.aceptar_invitacion(text) is
  'Canjea el token de una invitacion por una membresia del usuario de la sesion (sub del JWT). Valida hash, vencimiento, estado y que el correo sea el invitado. Resultados: aceptada, ya_aceptada, ya_miembro, invalida, vencida, revocada, otro_correo, otro_cliente, sin_sesion, correo_sin_confirmar (0123).';

-- ── Grants: authenticated entra por aqui; anon por ningun lado ─────────
revoke all on function public.crear_invitacion(text, text, uuid, integer) from public, anon;
revoke all on function public.reenviar_invitacion(uuid, integer) from public, anon;
revoke all on function public.revocar_invitacion(uuid) from public, anon;
revoke all on function public.invitacion_para_enviar(uuid, text) from public, anon;
revoke all on function public.marcar_invitacion_enviada(uuid) from public, anon;
revoke all on function public.aceptar_invitacion(text) from public, anon;

grant execute on function public.crear_invitacion(text, text, uuid, integer) to authenticated;
grant execute on function public.reenviar_invitacion(uuid, integer) to authenticated;
grant execute on function public.revocar_invitacion(uuid) to authenticated;
grant execute on function public.invitacion_para_enviar(uuid, text) to authenticated;
grant execute on function public.marcar_invitacion_enviada(uuid) to authenticated;
grant execute on function public.aceptar_invitacion(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  La puerta vieja se cierra
--
--  Ninguna pantalla la llamaba (grep), pero estaba concedida a
--  authenticated: cualquiera con token podia invocarla por PostgREST.
-- ═══════════════════════════════════════════════════════════════════════
drop function if exists public.invite_member(text, uuid, uuid[], uuid[]);

-- ═══════════════════════════════════════════════════════════════════════
--  Vuelta atras (down), en este orden:
--    drop function public.aceptar_invitacion(text);
--    drop function public.marcar_invitacion_enviada(uuid);
--    drop function public.invitacion_para_enviar(uuid, text);
--    drop function public.revocar_invitacion(uuid);
--    drop function public.reenviar_invitacion(uuid, integer);
--    drop function public.crear_invitacion(text, text, uuid, integer);
--    drop function public.invitacion_hash(text);
--    drop function public.invitacion_token_nuevo();
--    drop function public.usuarios_exigir(text);
--    drop table public.user_invitations;
--    drop function public.impedir_editar_invitacion_cerrada();
--    drop function public.impedir_rol_ajeno_invitacion();
--  invite_member() NO se restaura: inventaba identidades. Si hiciera
--  falta, su cuerpo esta en 0008.
-- ═══════════════════════════════════════════════════════════════════════

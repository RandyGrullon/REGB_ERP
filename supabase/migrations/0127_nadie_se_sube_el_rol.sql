-- ═══════════════════════════════════════════════════════════════════════
--  0127 — Nadie se sube el rol dentro de su propio cliente
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  Lo encontro 0121 al cerrar las FK y se verifico contra la base: la RLS
--  de public.memberships y public.roles era, desde 0005, solo
--  `tenant_id = rls.tenant_id()` para TODO -select, insert, update,
--  delete-. Por la pantalla no se notaba: las acciones de /usuarios y
--  /roles exigen el permiso en servidor. Pero por PostgREST -la puerta del
--  movil y de cualquier integracion-, un Cajero con su JWT de verdad podia:
--
--    · darse `"*": true` en su propio rol, y con eso rls.has_perm() le
--      abria costos, expedientes, nomina, llaves de API y e-CF;
--    · pasar su propia membresia al rol Owner;
--    · crear un rol con todo y asignarselo.
--
--  supabase/tests/escalada-rol.test.ts lo reproduce: 21 de 26 en rojo sin
--  esta migracion.
--
--  ── Que cambia ────────────────────────────────────────────────────────
--
--   1. La escritura pide el permiso. Las politicas FOR ALL se parten: la
--      lectura sigue igual (tenant) y la escritura exige ademas
--      rls.has_perm() con los MISMOS ids que ya exigen las acciones:
--      users.create/edit/delete (manifiesto de users, /usuarios) y
--      rbac.role.create/edit/delete (/roles). En insert y update el permiso
--      va en WITH CHECK y no en USING: asi el intento no pasa en silencio
--      como "0 filas", sale 42501. Delete no tiene WITH CHECK, y un
--      has_perm en su USING lo convertiria en "0 filas" -y ademas el
--      respaldo (0122) exige que todo has_perm de un USING sea el .view de
--      un modulo-: su permiso lo mira el trigger de abajo, tambien 42501.
--
--   2. Lo propio no se toca, ni con permiso. Un Gerente de Sucursal trae
--      `*.edit` (0006): users.edit y rbac.role.edit le salen por comodin.
--      La politica lo deja pasar, y por eso hacen falta reglas sobre QUIEN:
--        · nadie cambia el rol, las sucursales, las empresas ni el dueño de
--          SU PROPIA membresia, ni se da de alta a si mismo;
--        · nadie cambia los permisos, modulos visibles o alcance del rol
--          que tiene asignado.
--      Lo pide otra persona con permiso. Vale tambien para el Owner.
--
--   3. El Owner es la llave maestra y el cliente nunca se queda sin ella:
--        · una membresia con rol Owner -antes o despues del cambio- solo la
--          toca un Owner (dar, quitar, desactivar, borrar); una invitacion
--          como Owner, igual;
--        · el rol Owner de sistema no se recorta, no se renombra y no se
--          borra desde una sesion de cliente;
--        · no se desactiva, degrada ni borra la ULTIMA membresia Owner
--          activa. Con un candado por cliente: dos Owners degradandose a la
--          vez no pueden dejarlo en cero.
--
--   4. rls.has_perm() falla CERRADO cuando el rol del token no es del
--      cliente (no existe, o es de otro). Antes concedia todo: la salida
--      que 0121 cerro por la membresia seguia abierta para cualquier token
--      viejo o mal armado. Sin role_id en el token sigue sin decidir aqui
--      (decision de 0109), pero la web ya no cae en ese caso: asUser()
--      pone ahora el role_id real de la membresia (apps/web/src/lib/db.ts).
--
--  ── Cuando aplican las reglas 2 y 3 (y el permiso de borrar) ─────────
--
--  Solo en una sesion de MIEMBRO sobre su propio cliente: hay `sub` y el
--  tenant del token es el de la fila. Fuera de eso no hay "propio" que
--  proteger ni cliente que se equivoque:
--    · migraciones, siembra y limpieza de pruebas (sin claims);
--    · aceptar_invitacion() (0123): la persona todavia no tiene cliente en
--      su token, y reactivar su membresia desactivada es justo cambiar SU
--      rol; la invitacion ya paso por la regla del Owner al crearse;
--    · el proveedor (sin tenant en el token; ademas solo lee).
--  Una sesion de cliente no puede escribir filas de otro cliente (RLS), y
--  una funcion security definer llamada por un cliente conserva sus claims:
--  las reglas la alcanzan igual.
--
--  ── Lo que NO hace ────────────────────────────────────────────────────
--
--   · No impide dar a OTRO lo que uno no tiene. Un Admin (o un Gerente de
--     Sucursal, por `*.create`/`*.edit`) puede crear un rol con `*` y
--     asignarselo a otra cuenta del mismo cliente. El Owner esta protegido
--     por la regla 3; el resto es el principio "ningun rol otorga lo que no
--     tiene" de §10, que pide comparar conjuntos de permisos con comodines
--     y queda como deuda, dicha en la ficha de users.
--   · No revisa filas ya escritas: un Cajero que se dio `*` antes de esta
--     migracion lo sigue teniendo. Consulta para buscarlo en la ficha.
--
--  Reversion: drop de los triggers no_escalar_* y no_invitar_como_owner y
--  de sus funciones, de rls.rol_es_owner/rls.es_owner y de las politicas
--  alta_/cambio_/baja_con_permiso; volver a crear tenant_isolation FOR ALL
--  de 0005 en memberships y roles, y has_perm como en 0109. No hay _down
--  aparte: migrate.mjs aplica todo .sql de la carpeta en orden.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Quien es Owner ──────────────────────────────────────────────────────
--  El rol Owner es el de sistema con ese nombre (0006): el unico con
--  `{"*": true}` sin ninguna denegacion, el que "incluye la suscripcion".
--  Una sola definicion, para que las tres reglas digan lo mismo.
--
--  SECURITY DEFINER: se preguntan desde triggers sobre filas que la RLS del
--  que escribe puede no dejarle ver. Sin grant a nadie: saber si alguien
--  es Owner de un cliente no es algo que un cliente pueda preguntar por
--  otro.
create function rls.rol_es_owner(p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roles
    where id = p_role and is_system and name = 'Owner'
  )
$$;

create function rls.es_owner(p_tenant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.tenant_id = p_tenant and m.user_id = p_user and m.is_active
      and r.tenant_id = p_tenant and r.is_system and r.name = 'Owner'
  )
$$;

revoke all on function rls.rol_es_owner(uuid) from public;
revoke all on function rls.es_owner(uuid, uuid) from public;

comment on function rls.rol_es_owner(uuid) is
  'Si ese rol es el Owner de sistema (0006). Solo para las reglas de 0127; sin grant.';
comment on function rls.es_owner(uuid, uuid) is
  'Si esa persona tiene hoy una membresia activa con el rol Owner en ese cliente. Solo para las reglas de 0127; sin grant.';

-- ═══════════════════════════════════════════════════════════════════════
--  1. has_perm falla cerrado
-- ═══════════════════════════════════════════════════════════════════════
--  Igual que 0109 salvo una linea: el rol del token que no aparece en el
--  cliente ya no concede nada. Las demas ramas se quedan, en el mismo
--  orden: sin rol en el token (web antigua, proveedor) no decide aqui.
create or replace function rls.has_perm(p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select permissions
    from public.roles
    where id = rls.role_id() and tenant_id = rls.tenant_id()
  ),
  pat as (select unnest(rls.patrones_de(p_accion)) as p)
  select case
    when rls.role_id() is null then true
    when rls.is_provider() then true
    -- 0127: un rol que no es de este cliente -no existe, lo borraron, o es
    -- de otro- es un token que no deberia existir. Falla cerrado.
    when not exists (select 1 from r) then false
    when exists (
      select 1 from pat, r where (r.permissions -> pat.p) = 'false'::jsonb
    ) then false
    else exists (
      select 1 from pat, r where (r.permissions -> pat.p) = 'true'::jsonb
    )
  end
$$;

comment on function rls.has_perm(text) is
  'Si el rol del token concede la accion. Replica can() de @regb/permissions: comodines del mas especifico al mas general y la denegacion gana siempre. Sin role_id en el token devuelve true (0109); con un role_id que no es del cliente, false (0127).';

-- ═══════════════════════════════════════════════════════════════════════
--  2. Politicas: leer igual, escribir con permiso
-- ═══════════════════════════════════════════════════════════════════════
--  La lectura conserva nombre y forma (`tenant_isolation`, solo tenant):
--  el respaldo (0122) deriva que tablas entran leyendo las politicas de
--  select, y para el esto no cambia nada.
drop policy tenant_isolation on public.memberships;

create policy tenant_isolation on public.memberships for select
  using (tenant_id = rls.tenant_id());

create policy alta_con_permiso on public.memberships for insert
  with check (tenant_id = rls.tenant_id() and rls.has_perm('users.create'));

create policy cambio_con_permiso on public.memberships for update
  using (tenant_id = rls.tenant_id())
  with check (tenant_id = rls.tenant_id() and rls.has_perm('users.edit'));

-- El permiso de borrar lo mira no_escalar_membresia (ver la cabecera).
create policy baja_con_permiso on public.memberships for delete
  using (tenant_id = rls.tenant_id());

drop policy tenant_isolation on public.roles;

create policy tenant_isolation on public.roles for select
  using (tenant_id = rls.tenant_id());

create policy alta_con_permiso on public.roles for insert
  with check (tenant_id = rls.tenant_id() and rls.has_perm('rbac.role.create'));

create policy cambio_con_permiso on public.roles for update
  using (tenant_id = rls.tenant_id())
  with check (tenant_id = rls.tenant_id() and rls.has_perm('rbac.role.edit'));

-- El permiso de borrar lo mira no_escalar_rol (ver la cabecera).
create policy baja_con_permiso on public.roles for delete
  using (tenant_id = rls.tenant_id());

-- ═══════════════════════════════════════════════════════════════════════
--  3. Membresias: lo propio no se toca, el Owner lo toca un Owner, y
--     siempre queda uno
-- ═══════════════════════════════════════════════════════════════════════
create function public.impedir_escalada_en_membresia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := rls.regb_uid();
  v_tenant     uuid;
  v_era_owner  boolean := false;
  v_sera_owner boolean := false;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
  else
    v_tenant := new.tenant_id;
  end if;

  -- Solo una sesion de miembro sobre su propio cliente. Ver la cabecera.
  if v_actor is null or rls.tenant_id() is distinct from v_tenant then
    return coalesce(new, old);
  end if;

  -- El permiso de borrar, que la politica de delete no puede decir con
  -- un error (ver la cabecera).
  if tg_op = 'DELETE' and not rls.has_perm('users.delete') then
    raise exception 'Tu rol no permite quitar a nadie del equipo (users.delete).'
      using errcode = '42501';
  end if;

  -- ── Lo propio ─────────────────────────────────────────────────────────
  --  is_active queda fuera a proposito: desactivarse no sube a nadie (la
  --  pantalla ya lo impide por ergonomia) y, si es el ultimo Owner, lo
  --  frena la regla de abajo.
  if tg_op = 'INSERT' and new.user_id = v_actor then
    raise exception 'Tu propio acceso no lo das tu: pideselo a otro administrador.'
      using errcode = '42501';
  end if;
  --  `new.user_id = v_actor` tambien: pasarse a uno mismo la membresia de
  --  otro (cambiandole el user_id) es quedarse con su rol.
  if tg_op = 'UPDATE' and v_actor in (old.user_id, new.user_id)
     and (new.role_id, new.branch_ids, new.company_ids, new.user_id, new.tenant_id)
         is distinct from
         (old.role_id, old.branch_ids, old.company_ids, old.user_id, old.tenant_id) then
    raise exception 'Tu propio acceso no lo cambias tu: pideselo a otro administrador.'
      using errcode = '42501';
  end if;

  -- ── El Owner lo toca un Owner ─────────────────────────────────────────
  if tg_op <> 'INSERT' then
    v_era_owner := rls.rol_es_owner(old.role_id);
  end if;
  if tg_op <> 'DELETE' then
    v_sera_owner := rls.rol_es_owner(new.role_id);
  end if;
  if (v_era_owner or v_sera_owner) and not rls.es_owner(v_tenant, v_actor) then
    raise exception 'Solo un Owner da, cambia o quita el acceso de un Owner.'
      using errcode = '42501';
  end if;

  -- ── Siempre queda un Owner ────────────────────────────────────────────
  --  Aplica cuando una membresia Owner ACTIVA deja de serlo: se borra, se
  --  desactiva o cambia de rol. El candado serializa por cliente: sin el,
  --  dos Owners que se degradan a la vez ven cada uno al otro todavia
  --  Owner y el cliente queda en cero.
  if v_era_owner and old.is_active
     and (tg_op = 'DELETE' or not (v_sera_owner and new.is_active)) then
    perform pg_advisory_xact_lock(hashtextextended('regb.owners:' || v_tenant::text, 0));
    if not exists (
      select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
      where m.tenant_id = v_tenant and m.id <> old.id and m.is_active
        and r.is_system and r.name = 'Owner'
    ) then
      raise exception 'El cliente se quedaria sin ningun Owner. Nombra otro Owner antes de quitar este.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- `no_escalar_*` dispara antes que `no_rol_ajeno` (0121): quien intenta
-- tocar lo suyo recibe el mensaje que explica eso. `update of` para no
-- pagar nada en lo que no importa -updated_at, accepted_at-.
create trigger no_escalar_membresia
  before insert or delete or update of tenant_id, user_id, role_id, branch_ids, company_ids, is_active
  on public.memberships
  for each row execute function public.impedir_escalada_en_membresia();

-- ═══════════════════════════════════════════════════════════════════════
--  4. Roles: el tuyo no lo amplias tu, y el Owner no se toca
-- ═══════════════════════════════════════════════════════════════════════
create function public.impedir_escalada_en_rol() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := rls.regb_uid();
begin
  if v_actor is null or rls.tenant_id() is distinct from old.tenant_id then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' and not rls.has_perm('rbac.role.delete') then
    raise exception 'Tu rol no permite borrar roles (rbac.role.delete).' using errcode = '42501';
  end if;

  -- El Owner de sistema es la llave maestra: recortarlo o renombrarlo deja
  -- al cliente sin Owner por definicion, aunque las membresias sigan ahi.
  if old.is_system and old.name = 'Owner'
     and (tg_op = 'DELETE'
          or (new.name, new.is_system, new.permissions, new.visible_modules, new.scope, new.tenant_id)
             is distinct from
             (old.name, old.is_system, old.permissions, old.visible_modules, old.scope, old.tenant_id)) then
    raise exception 'El rol Owner es la llave maestra del cliente: no se recorta, no se renombra y no se borra.'
      using errcode = '42501';
  end if;

  -- Nombre y descripcion no dan poder; permisos, modulos y alcance si.
  if tg_op = 'UPDATE'
     and (new.permissions, new.visible_modules, new.scope)
         is distinct from (old.permissions, old.visible_modules, old.scope)
     and exists (select 1 from public.memberships m
                 where m.tenant_id = old.tenant_id and m.user_id = v_actor
                   and m.role_id = old.id and m.is_active) then
    raise exception 'No puedes cambiar el rol que tienes asignado: pideselo a otro administrador.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger no_escalar_rol
  before delete or update of tenant_id, name, is_system, permissions, visible_modules, scope
  on public.roles
  for each row execute function public.impedir_escalada_en_rol();

-- ═══════════════════════════════════════════════════════════════════════
--  5. Invitar como Owner, solo un Owner
-- ═══════════════════════════════════════════════════════════════════════
--  Sin esto, la regla 3 se esquivaba por la puerta de al lado: un Admin
--  invita a su segunda cuenta como Owner y la acepta. La guarda del rol
--  ajeno de la invitacion es de 0123 (no_rol_ajeno); esta es otra cosa.
create function public.impedir_invitar_como_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := rls.regb_uid();
begin
  if v_actor is null or rls.tenant_id() is distinct from new.tenant_id then
    return new;
  end if;
  if rls.rol_es_owner(new.role_id) and not rls.es_owner(new.tenant_id, v_actor) then
    raise exception 'Solo un Owner invita a alguien como Owner.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger no_invitar_como_owner
  before insert or update of tenant_id, role_id on public.user_invitations
  for each row execute function public.impedir_invitar_como_owner();

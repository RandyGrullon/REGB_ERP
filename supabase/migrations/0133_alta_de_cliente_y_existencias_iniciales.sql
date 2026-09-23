-- ═══════════════════════════════════════════════════════════════════════
--  0133 — Un cliente real arranca sin SQL
--
--  ── El defecto ────────────────────────────────────────────────────────
--
--  Dar de alta a un cliente era un `insert into regb.tenants` a mano
--  (PRIMER-CLIENTE.md §3): /control/onboarding solo movia etapas. El
--  trigger de 0011 crea roles, modulos core y la fila de onboarding, pero
--  NO la empresa principal -sin ella el ticket sale sin RNC del emisor y el
--  607 dice "Tu empresa no tiene RNC cargado"-, ni una sucursal, ni un
--  almacen -sin el la caja no abre turno-, ni al dueño. Y el RNC del
--  tenant no se validaba: un digito mal escrito rebota el 607 entero.
--
--  Y la carga inicial de existencias solo se podia hacer producto por
--  producto, pegando el UUID en el "Ajuste manual".
--
--  ── El arreglo ────────────────────────────────────────────────────────
--
--  1. `regb.alta_de_cliente(...)`: el asistente de REGB Control llama a
--     UNA funcion que hace todo en la transaccion de quien la llama:
--     cliente con RNC validado, modulos comprados + sus dependencias
--     (`requires` del catalogo, en cierre transitivo), empresa principal
--     (`is_default`), sucursal, almacen predeterminado, roles de sistema
--     comprobados y la invitacion al dueño con el rol Owner POR
--     `public.crear_invitacion()` de 0123 -no con un insert a mano-.
--       · Solo el proveedor: `rls.is_provider()`, o 42501.
--       · Idempotente: la llave es el RNC. Repetir el alta con el mismo
--         RNC e identificador no duplica nada; completa lo que falte
--         (sirve tambien para un cliente creado a mano por SQL) y, si ya
--         estaba todo, dice `ya_existia`. El mismo RNC con otro
--         identificador, o el identificador de otro RNC, se niegan.
--       · Auditada: una fila en audit.log con lo que se hizo, ademas de
--         las que dejan los triggers de cada tabla.
--  2. `regb.alta_enlace_nuevo_para_dueno(cliente)`: el token de la
--     invitacion sale UNA vez. Si el proveedor lo pierde antes de
--     compartirlo, esto lo rota con `public.reenviar_invitacion()` (0123).
--  3. `import_batches.target` admite 'stock': el CSV de existencias
--     iniciales deja su lote igual que el de productos, y sus movimientos
--     llevan `reference_type = 'import_batch'` para deshacerlo exacto con
--     el movimiento contrario (el kardex no se borra).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 3. El lote de importacion tambien es de existencias ────────────────
alter table public.import_batches drop constraint import_batches_target_check;
alter table public.import_batches add constraint import_batches_target_check
  check (target in ('products', 'stock'));

comment on column public.import_batches.target is
  'products: crea productos (deshacer los borra). stock: carga existencias iniciales como adjustment_in con reference_type import_batch (deshacer inserta el movimiento contrario) (0133).';

-- ═══════════════════════════════════════════════════════════════════════
--  RNC (9 digitos) o cedula (11): digito verificador
--
--  Replica `isValidTaxId()` de packages/operations/src/dgii.ts, que es lo
--  que valida la pantalla. Se repite aqui porque la funcion de alta se
--  puede llamar por PostgREST y no pasa por la pantalla.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function regb.documento_fiscal_valido(p_documento text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d      text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  pesos  int[] := array[7, 9, 8, 6, 5, 4, 3, 2];
  suma   int := 0;
  resto  int;
  verif  int;
  prod   int;
  i      int;
begin
  if length(d) = 9 then
    for i in 1 .. 8 loop
      suma := suma + substr(d, i, 1)::int * pesos[i];
    end loop;
    resto := suma % 11;
    verif := case when resto = 0 then 2 when resto = 1 then 1 else 11 - resto end;
    return verif = substr(d, 9, 1)::int;
  elsif length(d) = 11 then
    for i in 1 .. 10 loop
      prod := substr(d, i, 1)::int * (case when i % 2 = 1 then 1 else 2 end);
      suma := suma + case when prod > 9 then prod / 10 + prod % 10 else prod end;
    end loop;
    return (10 - suma % 10) % 10 = substr(d, 11, 1)::int;
  end if;
  return false;
end;
$$;

comment on function regb.documento_fiscal_valido(text) is
  'RNC (9) o cedula (11) con su digito verificador. Replica isValidTaxId de @regb/operations (0133).';

-- 130111111 -> 130-11111-1 ; 00100000017 -> 001-0000001-7
create or replace function regb.documento_fiscal_formateado(p_documento text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case length(d)
           when 9 then substr(d, 1, 3) || '-' || substr(d, 4, 5) || '-' || substr(d, 9, 1)
           when 11 then substr(d, 1, 3) || '-' || substr(d, 4, 7) || '-' || substr(d, 11, 1)
           else d
         end
  from (select regexp_replace(coalesce(p_documento, ''), '\D', '', 'g') as d) x
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  1. El alta
-- ═══════════════════════════════════════════════════════════════════════
create or replace function regb.alta_de_cliente(
  p_slug             text,
  p_razon_social     text,
  p_nombre_comercial text,
  p_rnc              text,
  p_tier             regb.tenant_tier,
  p_modulos          text[],
  p_sucursal         text,
  p_almacen          text,
  p_dueno_nombre     text,
  p_dueno_correo     text
)
returns table (
  resultado         text,        -- creado | completado | ya_existia
  cliente           uuid,
  identificador     text,
  modulos_activados text[],      -- los que se encendieron en ESTA llamada
  piezas            text[],      -- lo que se creo o se marco en ESTA llamada
  estado_dueno      text,        -- invitado | pendiente | ya_miembro
  invitacion        uuid,
  enlace_token      text,        -- solo si se creo la invitacion ahora
  vence             timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := rls.regb_uid();
  v_claims     text := current_setting('request.jwt.claims', true);
  v_slug       text := lower(btrim(coalesce(p_slug, '')));
  v_razon      text := btrim(coalesce(p_razon_social, ''));
  v_comercial  text := nullif(btrim(coalesce(p_nombre_comercial, '')), '');
  v_rnc        text := regexp_replace(coalesce(p_rnc, ''), '\D', '', 'g');
  v_rnc_fmt    text;
  v_sucursal   text := coalesce(nullif(btrim(coalesce(p_sucursal, '')), ''), 'Principal');
  v_almacen    text := coalesce(nullif(btrim(coalesce(p_almacen, '')), ''), 'Almacen principal');
  v_nombre     text := btrim(coalesce(p_dueno_nombre, ''));
  v_correo     text := lower(btrim(coalesce(p_dueno_correo, '')));
  v_pedidos    text[];
  v_cierre     text[];
  v_malo       text;
  v_otro       record;
  v_tenant     uuid;
  v_existia    boolean := false;
  v_encendidos text[] := '{}';
  v_hizo       text[] := '{}';
  v_empresa    uuid;
  v_sucursal_id uuid;
  v_almacen_id uuid;
  v_owner      uuid;
  v_inv_id     uuid;
  v_token      text;
  v_vence      timestamptz;
  v_dueno      text;
begin
  if not rls.is_provider() then
    raise exception 'Solo REGB Control da de alta clientes.' using errcode = '42501';
  end if;

  -- ── Lo que se valida antes de tocar nada ─────────────────────────────
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) not between 3 and 40 then
    raise exception 'El identificador "%" no sirve: solo minusculas, numeros y guiones, de 3 a 40 letras (ej. colmado-la-esperanza).', coalesce(p_slug, '')
      using errcode = '22023';
  end if;
  -- /control/<slug> es la ficha del cliente: un cliente "salud" quedaria
  -- tapado por el panel de salud. Las rutas fijas de REGB Control y de la
  -- app no se pueden usar como identificador.
  if v_slug in ('onboarding', 'salud', 'datos', 'actividad', 'facturacion', 'nuevo',
                'control', 'api', 'auth', 'login', 'demo') then
    raise exception 'El identificador "%" esta reservado para una pantalla de REGB. Elige otro.', v_slug
      using errcode = '22023';
  end if;
  if char_length(v_razon) < 3 then
    raise exception 'La razon social necesita al menos 3 letras.' using errcode = '22023';
  end if;
  if not regb.documento_fiscal_valido(v_rnc) then
    raise exception 'El RNC "%" no es valido: revisa el digito verificador (9 digitos para empresa, 11 si es una cedula). Un RNC malo hace rebotar el 607 entero.', coalesce(p_rnc, '')
      using errcode = '22023';
  end if;
  v_rnc_fmt := regb.documento_fiscal_formateado(v_rnc);
  if p_tier is null then
    raise exception 'Elige el plan: pyme, mediano o grande.' using errcode = '22023';
  end if;
  if char_length(v_nombre) < 3 then
    raise exception 'El nombre del dueño necesita al menos 3 letras.' using errcode = '22023';
  end if;
  if v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'El correo del dueño no es valido: debe verse como dueno@suempresa.do.'
      using errcode = '22023';
  end if;

  -- ── Modulos: lo pedido + lo que eso requiere, en cierre ──────────────
  v_pedidos := array(
    select distinct lower(btrim(m)) from unnest(coalesce(p_modulos, '{}'::text[])) m
    where btrim(m) <> '');

  with recursive cierre(id) as (
    select unnest(v_pedidos)
    union
    select unnest(mc.requires)
    from regb.module_catalog mc
    join cierre c on c.id = mc.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_cierre from cierre;

  select string_agg(m, ', ' order by m) into v_malo
  from unnest(v_cierre) m
  where not exists (select 1 from regb.module_catalog mc where mc.id = m and mc.is_published);
  if v_malo is not null then
    raise exception 'Estos modulos no existen o todavia no se venden: %.', v_malo using errcode = '22023';
  end if;

  -- Enterprise solo en el plan grande: su precio no existe en los otros
  -- (moduleCategoryPricing lanza, y con el se cae todo /control).
  if p_tier <> 'grande' then
    select string_agg(mc.name, ', ' order by mc.name) into v_malo
    from regb.module_catalog mc
    where mc.id = any(v_cierre) and mc.category = 'enterprise';
    if v_malo is not null then
      raise exception 'Los modulos enterprise (%) solo se venden en el plan grande.', v_malo
        using errcode = '22023';
    end if;
  end if;

  -- ── Idempotencia: la llave es el RNC ─────────────────────────────────
  -- Dos altas del mismo cliente a la vez (doble clic, dos pestañas) se
  -- ponen en fila aqui en vez de crear dos clientes.
  perform pg_advisory_xact_lock(hashtext('regb.alta_de_cliente:' || v_rnc));
  perform pg_advisory_xact_lock(hashtext('regb.alta_de_cliente:' || v_slug));

  select t.id, t.slug, t.legal_name, t.tier into v_otro
  from regb.tenants t
  where regexp_replace(coalesce(t.tax_id, ''), '\D', '', 'g') = v_rnc
    and t.status <> 'archived'
  order by t.created_at
  limit 1;

  if found then
    if v_otro.slug <> v_slug then
      raise exception 'Ya hay un cliente con el RNC %: % (%). No se crea otro.',
        v_rnc_fmt, v_otro.legal_name, v_otro.slug using errcode = '23505';
    end if;
    if v_otro.tier <> p_tier then
      raise exception 'Ese cliente ya existe en el plan %. El plan se cambia desde su ficha, no repitiendo el alta.',
        v_otro.tier using errcode = '23505';
    end if;
    v_tenant := v_otro.id;
    v_existia := true;
  else
    if exists (select 1 from regb.tenants t where t.slug = v_slug) then
      raise exception 'El identificador "%" ya es de otro cliente. Elige otro.', v_slug
        using errcode = '23505';
    end if;
    -- El trigger de 0011 crea aqui los roles de sistema, los modulos core
    -- y la fila de onboarding en 'sold'.
    insert into regb.tenants (slug, legal_name, trade_name, tax_id, tier, status, installed_at)
    values (v_slug, v_razon, v_comercial, v_rnc_fmt, p_tier, 'active', now())
    returning id into v_tenant;
    v_hizo := v_hizo || 'cliente'::text;
  end if;

  -- ── Modulos ──────────────────────────────────────────────────────────
  -- Los comprados entran activos: esto es la venta, no una prueba (la
  -- prueba de 14 dias es la del marketplace). Nunca se apaga nada.
  with puestos as (
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled, activated_at)
    select v_tenant, m, 'active', true, now() from unnest(v_cierre) m
    on conflict (tenant_id, module_id) do update
      set status = 'active', enabled = true, trial_ends_at = null
      where regb.tenant_modules.status <> 'active' or not regb.tenant_modules.enabled
    returning module_id
  )
  select coalesce(array_agg(module_id order by module_id), '{}') into v_encendidos from puestos;

  -- ── Roles de sistema: se comprueban, no se suponen ───────────────────
  perform regb.provision_system_roles(v_tenant);
  select r.id into v_owner from public.roles r where r.tenant_id = v_tenant and r.name = 'Owner';
  if v_owner is null then
    raise exception 'El cliente quedo sin rol Owner: revisa regb.provision_system_roles.';
  end if;

  -- ── Empresa principal ────────────────────────────────────────────────
  select c.id into v_empresa
  from public.companies c
  where c.tenant_id = v_tenant and c.is_default and c.deleted_at is null;
  if v_empresa is null then
    select c.id into v_empresa
    from public.companies c
    where c.tenant_id = v_tenant and c.deleted_at is null
      and regexp_replace(coalesce(c.tax_id, ''), '\D', '', 'g') = v_rnc
    order by c.created_at
    limit 1;
    if v_empresa is not null then
      update public.companies set is_default = true where id = v_empresa;
      v_hizo := v_hizo || 'empresa_principal'::text;
    else
      insert into public.companies (tenant_id, legal_name, trade_name, tax_id, is_default)
      values (v_tenant, v_razon, v_comercial, v_rnc_fmt, true)
      returning id into v_empresa;
      v_hizo := v_hizo || 'empresa'::text;
    end if;
  end if;

  -- ── Sucursal (de la empresa principal) ───────────────────────────────
  select b.id into v_sucursal_id
  from public.branches b
  where b.tenant_id = v_tenant and b.company_id = v_empresa and b.deleted_at is null
  order by (lower(b.name) = lower(v_sucursal)) desc, b.created_at
  limit 1;
  if v_sucursal_id is null then
    insert into public.branches (tenant_id, company_id, name)
    values (v_tenant, v_empresa, v_sucursal)
    returning id into v_sucursal_id;
    v_hizo := v_hizo || 'sucursal'::text;
  end if;

  -- ── Almacen predeterminado (sin el, la caja no abre turno) ───────────
  select w.id into v_almacen_id from public.warehouses w where w.tenant_id = v_tenant and w.is_default;
  if v_almacen_id is null then
    select w.id into v_almacen_id
    from public.warehouses w
    where w.tenant_id = v_tenant and w.is_active
    order by w.created_at
    limit 1;
    if v_almacen_id is not null then
      update public.warehouses set is_default = true where id = v_almacen_id;
      v_hizo := v_hizo || 'almacen_principal'::text;
    else
      insert into public.warehouses (tenant_id, branch_id, name, is_default)
      values (v_tenant, v_sucursal_id, v_almacen, true)
      returning id into v_almacen_id;
      v_hizo := v_hizo || 'almacen'::text;
    end if;
  end if;

  -- ── El dueño ─────────────────────────────────────────────────────────
  if exists (
    select 1
    from public.user_profiles p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = p.user_id
    where p.tenant_id = v_tenant and lower(p.email) = v_correo
      and m.is_active and m.accepted_at is not null
  ) then
    v_dueno := 'ya_miembro';
  else
    select i.id, i.expires_at into v_inv_id, v_vence
    from public.user_invitations i
    where i.tenant_id = v_tenant and i.email = v_correo
      and i.status = 'pending' and i.expires_at > now();

    if v_inv_id is not null then
      -- Ya se invito y sigue vigente. El token no se guardo nunca (solo
      -- su hash): para otro enlace esta alta_enlace_nuevo_para_dueno().
      v_dueno := 'pendiente';
    else
      -- Por la puerta de 0123, no con un insert: crear_invitacion() mira
      -- cliente, modulo y permiso con los claims del TOKEN. El alta se le
      -- presenta con el rol Owner de ESTE cliente y SIN `sub`: el primer
      -- Owner lo invita la plataforma, no una persona del cliente. Es el
      -- camino de sistema que la guarda de 0127 (`no_invitar_como_owner`,
      -- "solo un Owner invita a un Owner") deja pasar a proposito; con el
      -- `sub` del proveedor -que no es miembro- la guarda lo rechazaria.
      -- Quien fue queda escrito enseguida en `invited_by` (y en la
      -- bitacora de ese update, ya con los claims del proveedor).
      perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
          'app_metadata', jsonb_build_object(
            'tenant_id', v_tenant, 'role_id', v_owner, 'is_provider', false)
        )::text,
        true);
      select ci.invitacion, ci.token, ci.vence into v_inv_id, v_token, v_vence
      from public.crear_invitacion(v_correo, v_nombre, v_owner, 7) ci;
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      update public.user_invitations set invited_by = v_uid where id = v_inv_id;
      v_dueno := 'invitado';
      v_hizo := v_hizo || 'invitacion'::text;
    end if;
  end if;

  -- ── Onboarding: quien lo lleva ───────────────────────────────────────
  insert into regb.onboarding (tenant_id, stage, owner_user_id)
  values (v_tenant, 'sold', v_uid)
  on conflict (tenant_id) do update
    set owner_user_id = coalesce(regb.onboarding.owner_user_id, excluded.owner_user_id);

  -- ── Bitacora ─────────────────────────────────────────────────────────
  -- Solo si algo cambio: repetir un alta ya completa no ensucia el log.
  if cardinality(v_hizo) > 0 or cardinality(v_encendidos) > 0 then
    insert into audit.log (tenant_id, user_id, module_id, entity, entity_id, action, after, platform)
    values (
      v_tenant, v_uid, 'control', 'tenants', v_tenant,
      case when v_existia then 'update' else 'create' end,
      jsonb_build_object(
        'alta_de_cliente', true,
        'slug', v_slug,
        'tier', p_tier,
        'rnc', v_rnc_fmt,
        'modulos_pedidos', v_pedidos,
        'modulos_activados', v_encendidos,
        'piezas', v_hizo,
        'empresa', v_empresa,
        'sucursal', v_sucursal_id,
        'almacen', v_almacen_id,
        'invitacion', v_inv_id
      ),
      'web');
  end if;

  resultado := case
    when not v_existia then 'creado'
    when cardinality(v_hizo) > 0 or cardinality(v_encendidos) > 0 then 'completado'
    else 'ya_existia'
  end;
  cliente := v_tenant;
  identificador := v_slug;
  modulos_activados := v_encendidos;
  piezas := v_hizo;
  estado_dueno := v_dueno;
  invitacion := v_inv_id;
  enlace_token := v_token;
  vence := v_vence;
  return next;
end;
$$;

comment on function regb.alta_de_cliente(text, text, text, text, regb.tenant_tier, text[], text, text, text, text) is
  'Alta de un cliente real desde REGB Control, en una transaccion: RNC validado, modulos + dependencias, empresa principal, sucursal, almacen predeterminado, roles de sistema e invitacion Owner por crear_invitacion() (0123). Solo is_provider. Idempotente por RNC. Auditada (0133).';

-- ═══════════════════════════════════════════════════════════════════════
--  2. Enlace nuevo para el dueño
-- ═══════════════════════════════════════════════════════════════════════
create or replace function regb.alta_enlace_nuevo_para_dueno(p_cliente uuid)
returns table (invitacion uuid, enlace_token text, vence timestamptz, correo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := rls.regb_uid();
  v_claims text := current_setting('request.jwt.claims', true);
  v_owner  uuid;
  v_inv    uuid;
  v_correo text;
begin
  if not rls.is_provider() then
    raise exception 'Solo REGB Control genera enlaces para el dueño de un cliente.' using errcode = '42501';
  end if;

  select r.id into v_owner from public.roles r where r.tenant_id = p_cliente and r.name = 'Owner';
  select i.id, i.email into v_inv, v_correo
  from public.user_invitations i
  where i.tenant_id = p_cliente and i.role_id = v_owner and i.status = 'pending'
  order by i.created_at desc
  limit 1;

  if v_inv is null then
    raise exception 'Ese cliente no tiene una invitacion pendiente para su dueño. Si ya entro, sus usuarios se gestionan desde su propia pantalla de Usuarios.'
      using errcode = '55000';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_uid,
      'app_metadata', jsonb_build_object('tenant_id', p_cliente, 'role_id', v_owner, 'is_provider', false)
    )::text,
    true);
  select ri.invitacion, ri.token, ri.vence into invitacion, enlace_token, vence
  from public.reenviar_invitacion(v_inv, 7) ri;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  correo := v_correo;
  return next;
end;
$$;

comment on function regb.alta_enlace_nuevo_para_dueno(uuid) is
  'Rota el token de la invitacion Owner pendiente de un cliente (reenviar_invitacion de 0123) y lo devuelve una vez. Solo is_provider (0133).';

-- ── Grants: el proveedor entra con su token (is_provider); nadie mas ───
revoke all on function regb.documento_fiscal_valido(text) from public, anon;
revoke all on function regb.documento_fiscal_formateado(text) from public, anon;
revoke all on function regb.alta_de_cliente(text, text, text, text, regb.tenant_tier, text[], text, text, text, text) from public, anon;
revoke all on function regb.alta_enlace_nuevo_para_dueno(uuid) from public, anon;

grant execute on function regb.documento_fiscal_valido(text) to authenticated;
grant execute on function regb.alta_de_cliente(text, text, text, text, regb.tenant_tier, text[], text, text, text, text) to authenticated;
grant execute on function regb.alta_enlace_nuevo_para_dueno(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Vuelta atras (down), en este orden:
--    drop function regb.alta_enlace_nuevo_para_dueno(uuid);
--    drop function regb.alta_de_cliente(text, text, text, text, regb.tenant_tier, text[], text, text, text, text);
--    drop function regb.documento_fiscal_formateado(text);
--    drop function regb.documento_fiscal_valido(text);
--    delete from public.import_batches where target = 'stock';  -- sus movimientos quedan en el kardex, que es inmutable
--    alter table public.import_batches drop constraint import_batches_target_check;
--    alter table public.import_batches add constraint import_batches_target_check check (target = 'products');
--  No hay archivo _down aparte: el aplicador corre TODO .sql de la carpeta
--  en orden (ver 0118).
-- ═══════════════════════════════════════════════════════════════════════

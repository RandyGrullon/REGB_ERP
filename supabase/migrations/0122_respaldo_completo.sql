-- ═══════════════════════════════════════════════════════════════════════
--  0122 — El respaldo del cliente trae TODO su negocio
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  Hasta aqui el respaldo de /respaldos era una lista de seis tablas
--  escrita a mano en la accion: empresas, sucursales, roles, equipo,
--  productos y configuracion. Ni una venta, ni una factura, ni un
--  movimiento de inventario, ni un asiento. Y el aviso de la pantalla le
--  decia al cliente "eso es lo que perderias: mas de una semana de
--  ventas, compras y cobros". Con un respaldo de hoy descargado, el
--  cliente perdia igual todas sus ventas creyendo que las tenia.
--
--  ── Lo que cambia ─────────────────────────────────────────────────────
--
--  1. La lista de tablas ya no se escribe: se DERIVA del catalogo. Entra
--     toda tabla de `public` con `tenant_id`. Un modulo nuevo entra solo,
--     el dia que existe su tabla. Lo que queda fuera queda fuera por
--     NOMBRE y con motivo, y el archivo lo dice.
--
--  2. El archivo se guarda POR PARTES (`backup_parts`): una fila por
--     trozo de hasta N filas de una tabla. Un solo jsonb con todo el
--     negocio de un cliente grande revienta el limite de jsonb (~255 MB)
--     y obliga a la descarga a tenerlo entero en memoria. Por partes, la
--     descarga va trozo a trozo.
--
--  3. Todas las partes se escriben en UNA sentencia. `respaldo_tabla()`
--     es STABLE, y una funcion STABLE usa la foto de la sentencia que la
--     llama: las ventas y sus lineas, las facturas y sus cobros, salen de
--     la misma foto. Con una sentencia por tabla, una venta cobrada a
--     mitad del respaldo quedaba con cabecera y sin lineas.
--
--  ── Bajo la RLS de quien lo pide, siempre ─────────────────────────────
--
--  Todo es `security invoker`. El respaldo no puede traer nada que ese
--  usuario no vea: lo filtra la RLS, y ademas cada consulta repite
--  `tenant_id = rls.tenant_id()` para que la politica del proveedor que
--  impersona tampoco pueda colar otro cliente.
--
--  Pero la RLS del camino web no mira el ROL (asUser no pone role_id en
--  los claims: has_perm() devuelve true). Por eso la funcion recibe
--  `p_modulos`: los modulos que la accion ya verifico que el rol VE
--  completos. Un modulo activo que el rol no ve sale como 'sin-permiso',
--  no como una tabla vacia.
--
--  Sin archivo de reversa, como las 121 anteriores: el repo no los usa.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. La cabecera del respaldo ─────────────────────────────────────────
alter table public.backups
  add column formato smallint not null default 1 check (formato in (1, 2)),
  alter column size_bytes type bigint;

comment on column public.backups.formato is
  '1 = el respaldo viejo: seis tablas maestras dentro de payload, SIN ventas, facturas, inventario ni contabilidad. 2 = completo (0122): payload es el indice y los datos viven en backup_parts.';

comment on column public.backups.payload is
  'Formato 1: los datos. Formato 2: el indice del archivo -tablas y filas, lo que queda fuera y por que, columnas omitidas-, que es tambien la cabecera del JSON que se descarga.';

-- Para la llave foranea compuesta de las partes: la guarda de tenant va
-- en la propia llave, no en un trigger.
alter table public.backups
  add constraint backups_tenant_id_id_key unique (tenant_id, id);

-- ── 2. Las partes ───────────────────────────────────────────────────────
--  Sin bitacora a proposito: son copias de filas que YA estan en la
--  bitacora de su modulo. Auditarlas duplicaria el negocio entero del
--  cliente en audit.log con cada respaldo.
create table public.backup_parts (
  tenant_id  uuid    not null references regb.tenants(id) on delete cascade,
  backup_id  uuid    not null,
  tabla      text    not null,
  parte      integer not null check (parte >= 0),
  filas      integer not null check (filas > 0),
  datos      jsonb   not null check (jsonb_typeof(datos) = 'array'),
  size_bytes integer not null check (size_bytes >= 0),
  primary key (tenant_id, backup_id, tabla, parte),
  -- (tenant_id, backup_id) y no solo backup_id: con la llave simple, un
  -- cliente podia colgar una parte SUYA -que pasa la RLS- del respaldo
  -- de otro. El agujero de siempre, cerrado en la llave.
  foreign key (tenant_id, backup_id)
    references public.backups (tenant_id, id) on delete cascade
);

comment on table public.backup_parts is
  'Un trozo de hasta N filas de una tabla dentro de un respaldo (0122). La descarga los junta en un solo JSON, trozo a trozo.';

alter table public.backup_parts enable row level security;
alter table public.backup_parts force row level security;

create policy tenant_module on public.backup_parts for all
  using (tenant_id = rls.tenant_id() and rls.module_active('backup'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('backup'));

create policy provider_impersonating on public.backup_parts for select
  using (rls.impersonating(tenant_id));

-- ── 3. Columnas que no salen nunca ──────────────────────────────────────
--  Credenciales vivas. Un respaldo se guarda en una memoria USB, en un
--  correo, en una nube personal: el dia que se pierde, los datos se
--  pierden -malo- pero con un token dentro, ademas, alguien ENTRA -peor-.
--  Al restaurar se generan de nuevo.
--
--  Tres fuentes, una sola lista (gana la primera que la nombra):
--
--   1. Las que se declaran aqui, con su motivo propio.
--   2. Las que la bitacora YA declara secretas (argumentos 2..n de
--      audit.record(), p. ej. ecf_config.endpoint_token). Quien marca una
--      columna como secreta para la bitacora la esconde tambien del
--      respaldo sin saberlo.
--   3. Las que el usuario que pide el respaldo NO PUEDE LEER: el repo
--      protege algunas columna por columna -`stock_levels.avg_cost` (0109),
--      `user_invitations.token_hash` (0123)-. El respaldo corre bajo esos
--      mismos permisos, asi que no las ve; lo honesto es decirlo.
--
--  supabase/tests/backup.test.ts falla si aparece una columna con cara de
--  credencial -secret, token, hash, password...- que no este aqui.
create function public.respaldo_columnas_omitidas()
returns table (tabla text, columna text, motivo text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (x.tabla, x.columna) x.tabla, x.columna, x.motivo
  from (
    select v.tabla, v.columna, v.motivo, 1 as prioridad
    from (values
      ('webhook_endpoints', 'secret',
       'Firma de tus webhooks. Con ella cualquiera se hace pasar por REGB ante tu sistema. Al restaurar se genera otra.'),
      ('api_keys', 'key_hash',
       'Huella de tus llaves de API. No sirve para restaurar una llave -la llave completa solo se mostro al crearla-. Al restaurar se emiten llaves nuevas.'),
      ('portal_invites', 'token',
       'Enlace de acceso de tus clientes al portal. Quien lo tenga entra sin clave. Al restaurar se reenvian las invitaciones.'),
      ('stock_levels', 'avg_cost',
       'Costo promedio de la existencia. Se protege columna por columna y tu usuario no la lee. No se pierde: las existencias se recalculan del kardex (inventory_movements), que viene con el costo de cada entrada.')
    ) as v(tabla, columna, motivo)

    union all
    select c.relname::text, a.arg,
           'Marcada como secreta en la bitacora: no sale en claro en ningun sitio.', 2
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c      on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n  on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_proc p       on p.oid = t.tgfoid and p.proname = 'record'
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace and pn.nspname = 'audit'
    cross join lateral unnest(
      (pg_catalog.string_to_array(pg_catalog.encode(t.tgargs, 'escape'), '\000'))[2:]
    ) as a(arg)
    where t.tgnargs > 1 and a.arg <> ''

    union all
    select c.relname::text, a.attname::text,
           'Se protege columna por columna y tu usuario no la puede leer.', 3
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'p')
      and exists (select 1 from pg_catalog.pg_attribute t
                  where t.attrelid = c.oid and t.attname = 'tenant_id' and not t.attisdropped)
      and not pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
  ) x
  order by x.tabla, x.columna, x.prioridad
$$;

comment on function public.respaldo_columnas_omitidas() is
  'Columnas que el respaldo del cliente NO exporta: credenciales (lista propia + secretas de la bitacora) y las que quien lo pide no puede leer.';

-- ── 4. Que tablas hay y de que modulo es cada una ───────────────────────
--  DERIVADO, no escrito. Toda tabla de public con tenant_id.
--
--  El modulo sale de las politicas: module_active('x') de cada politica
--  permisiva que deja leer (ALL o SELECT), sin contar la del proveedor.
--  Varias politicas se suman con OR, igual que en la RLS: `customers` es
--  de ar, pos o sales-orders -basta cualquiera-.
--
--  Cinco tablas de plataforma no dicen modulo en su politica (solo
--  tenant_id): se mapean a mano al modulo que las muestra. La prueba de
--  backup falla si aparece otra sin modulo -no se puede saber quien la
--  puede ver-.
--
--  Tres quedan fuera POR DISENO, con el motivo que el archivo repite.
--
--  `personal`: TODAS sus politicas de lectura filtran por el usuario
--  (`user_id = rls.regb_uid()`, p. ej. notifications desde 0125). Entra,
--  pero solo con las filas de quien pide el respaldo, y el indice lo dice
--  en `personales`: sin eso el archivo diria "3 notificaciones" de una
--  empresa que tiene trescientas.
create function public.respaldo_tablas()
returns table (tabla text, modulos text[], motivo_fuera text, personal boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidatas as (
    select c.oid, c.relname::text as tabla
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'tenant_id'
                    and a.attnum > 0 and not a.attisdropped)
  ),
  por_politica as (
    select c.tabla, array_agg(distinct m[1] order by m[1]) as modulos
    from candidatas c
    join pg_catalog.pg_policy p on p.polrelid = c.oid
    cross join lateral pg_catalog.regexp_matches(
      pg_catalog.pg_get_expr(p.polqual, p.polrelid),
      'module_active\(''([a-z0-9-]+)''', 'g') as m
    where p.polpermissive
      and p.polcmd in ('*', 'r')
      and p.polname !~ '^provider_'
    group by c.tabla
  ),
  personales as (
    select c.tabla
    from candidatas c
    join pg_catalog.pg_policy p on p.polrelid = c.oid
    where p.polpermissive
      and p.polcmd in ('*', 'r')
      and p.polname !~ '^provider_'
    group by c.tabla
    having bool_and(pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%rls.regb_uid()%')
  ),
  sin_modulo(tabla, modulo) as (values
    ('companies',     'orgs'),
    ('branches',      'branches'),
    ('roles',         'users'),
    ('memberships',   'users'),
    ('tour_progress', 'tour')
  ),
  por_diseno(tabla, motivo) as (values
    ('backups',
     'Son los respaldos mismos: meterlos haria que cada uno cargue con todos los anteriores.'),
    ('backup_parts',
     'Son los respaldos mismos: meterlos haria que cada uno cargue con todos los anteriores.'),
    ('event_outbox',
     'Cola interna de avisos entre modulos, con sus reintentos de entrega. No es un dato de tu negocio: lo que anuncia ya esta en sus tablas.')
  )
  select c.tabla,
         coalesce(pp.modulos,
                  case when s.modulo is null then '{}'::text[] else array[s.modulo] end),
         d.motivo,
         pe.tabla is not null
  from candidatas c
  left join por_politica pp on pp.tabla = c.tabla
  left join sin_modulo s    on s.tabla  = c.tabla
  left join por_diseno d    on d.tabla  = c.tabla
  left join personales pe   on pe.tabla = c.tabla
  order by c.tabla
$$;

comment on function public.respaldo_tablas() is
  'Las tablas del cliente que puede llevar un respaldo, el modulo de cada una (leido de sus politicas), si no entra nunca y por que, y si solo trae las filas de quien lo pide (personal).';

-- ── 5. Una tabla, en trozos ─────────────────────────────────────────────
--  STABLE a proposito, y no por pureza: una funcion STABLE usa la foto de
--  la sentencia que la llama. Asi crear_respaldo() saca todas las tablas
--  de UNA foto (ver la cabecera, punto 3).
--
--  `p_tabla` va con %I y solo en `public`; la RLS la aplica quien llama.
--  `tenant_id` se repite en el where: la politica del proveedor que
--  impersona se suma por OR y, sin esto, un respaldo pedido durante una
--  impersonacion podia traer al cliente impersonado.
--
--  Las columnas van UNA POR UNA y solo las que quien llama puede leer, no
--  `to_jsonb(t)`: con una sola columna protegida (stock_levels.avg_cost)
--  el `t` entero da "permission denied" y el respaldo completo se cae.
create function public.respaldo_tabla(p_tabla text, p_sin text[], p_por_parte integer)
returns table (parte integer, filas integer, datos jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_cols text;
begin
  select string_agg(format('t.%I', a.attname), ', ' order by a.attnum)
  into v_cols
  from pg_catalog.pg_attribute a
  where a.attrelid = format('public.%I', p_tabla)::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname::text <> all (coalesce(p_sin, '{}'::text[]))
    and pg_catalog.has_column_privilege(a.attrelid, a.attnum, 'SELECT');

  if v_cols is null then
    return;
  end if;

  return query execute format(
    'select ((s.n - 1) / $1)::integer, count(*)::integer, jsonb_agg(to_jsonb(s.r) order by s.n)
       from (select r, row_number() over () as n
               from (select %s from public.%I t
                      where t.tenant_id = rls.tenant_id()) r) s
      group by 1
      order by 1', v_cols, p_tabla)
  using p_por_parte;
end;
$$;

comment on function public.respaldo_tabla(text, text[], integer) is
  'Las filas del cliente en una tabla, sin las columnas p_sin, en trozos de p_por_parte. STABLE: comparte la foto de quien la llama.';

-- ── 6. El respaldo ──────────────────────────────────────────────────────
create function public.crear_respaldo(
  p_modulos        text[],
  p_kind           text    default 'manual',
  p_filas_por_parte integer default 1000
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_tenant    uuid := rls.tenant_id();
  v_id        uuid;
  v_alcance   jsonb;
  v_filas     bigint;
  v_bytes     bigint;
  v_tablas    integer;
  v_indice    jsonb;
begin
  if v_tenant is null then
    raise exception 'Sin tenant en la sesion: no hay de quien sacar el respaldo.'
      using errcode = '42501';
  end if;
  if p_filas_por_parte is null or p_filas_por_parte < 1 then
    raise exception 'p_filas_por_parte tiene que ser mayor que cero.' using errcode = '22023';
  end if;

  -- Que entra y que no, calculado UNA vez: las partes y el indice leen
  -- de aqui, asi el archivo no puede decir una cosa y traer otra. Las
  -- columnas omitidas tambien van aqui: consultarlas tabla por tabla
  -- costaba ~24 ms x 190 tablas, cuatro segundos de catalogo por respaldo.
  with omitidas as materialized (
    select o.tabla, array_agg(o.columna order by o.columna) as columnas
    from public.respaldo_columnas_omitidas() o
    group by o.tabla
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tabla', x.tabla, 'modulos', to_jsonb(x.modulos),
           'motivo', x.motivo, 'detalle', x.detalle, 'personal', x.personal,
           'sin', to_jsonb(array['tenant_id'] || coalesce(x.omitidas, '{}'::text[])))
         order by x.tabla), '[]'::jsonb)
  into v_alcance
  from (
    select r.tabla, r.modulos, r.motivo_fuera as detalle, r.personal, om.columnas as omitidas,
      case
        when r.motivo_fuera is not null then 'por-diseno'
        when cardinality(r.modulos) = 0 then 'sin-modulo'
        when not exists (select 1 from unnest(r.modulos) m where rls.module_active(m)) then
          case when exists (select 1 from regb.tenant_modules tm
                            where tm.tenant_id = v_tenant and tm.module_id = any (r.modulos))
               then 'modulo-apagado' else 'no-contratado' end
        when not exists (select 1 from unnest(r.modulos) m
                         where rls.module_active(m) and m = any (coalesce(p_modulos, '{}'))) then
          'sin-permiso'
      end as motivo
    from public.respaldo_tablas() r
    left join omitidas om on om.tabla = r.tabla
  ) x;

  insert into public.backups (tenant_id, kind, payload, size_bytes, created_by, formato)
  values (v_tenant, p_kind, '{}'::jsonb, 0, rls.regb_uid(), 2)
  returning id into v_id;

  -- UNA sentencia para todas las tablas: una sola foto (cabecera, punto 3).
  insert into public.backup_parts (tenant_id, backup_id, tabla, parte, filas, datos, size_bytes)
  select v_tenant, v_id, a.tabla, p.parte, p.filas, p.datos, octet_length(p.datos::text)
  from jsonb_to_recordset(v_alcance) as a(tabla text, motivo text, sin text[])
  cross join lateral public.respaldo_tabla(a.tabla, a.sin, p_filas_por_parte) as p
  where a.motivo is null;

  select coalesce(sum(bp.filas), 0), coalesce(sum(bp.size_bytes), 0)
  into v_filas, v_bytes
  from public.backup_parts bp
  where bp.tenant_id = v_tenant and bp.backup_id = v_id;

  select count(*) into v_tablas
  from jsonb_to_recordset(v_alcance) as a(tabla text, motivo text)
  where a.motivo is null;

  -- El indice es tambien la cabecera del JSON que se descarga: el archivo
  -- dice, arriba y en claro, que trae y que no.
  v_indice := jsonb_build_object(
    'formato', 'regb-respaldo',
    'version', 2,
    'exportado_en', now(),
    'filas', v_filas,
    'modulos', (
      select coalesce(jsonb_agg(distinct m order by m), '[]'::jsonb)
      from jsonb_to_recordset(v_alcance) as a(modulos text[], motivo text),
           unnest(a.modulos) m
      where a.motivo is null and rls.module_active(m) and m = any (p_modulos)),
    'tablas', (
      select coalesce(jsonb_object_agg(a.tabla, coalesce(f.filas, 0)), '{}'::jsonb)
      from jsonb_to_recordset(v_alcance) as a(tabla text, motivo text)
      left join (select bp.tabla, sum(bp.filas)::bigint as filas
                 from public.backup_parts bp
                 where bp.tenant_id = v_tenant and bp.backup_id = v_id
                 group by bp.tabla) f on f.tabla = a.tabla
      where a.motivo is null),
    'fuera', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tabla', a.tabla, 'modulos', a.modulos, 'motivo', a.motivo, 'detalle', a.detalle)
             order by a.motivo, a.tabla), '[]'::jsonb)
      from jsonb_to_recordset(v_alcance) as a(tabla text, modulos jsonb, motivo text, detalle text)
      where a.motivo is not null),
    'personales', (
      select coalesce(jsonb_agg(a.tabla order by a.tabla), '[]'::jsonb)
      from jsonb_to_recordset(v_alcance) as a(tabla text, motivo text, personal boolean)
      where a.motivo is null and a.personal),
    'omitido', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tabla', o.tabla, 'columna', o.columna, 'motivo', o.motivo)
             order by o.tabla, o.columna), '[]'::jsonb)
      from public.respaldo_columnas_omitidas() o
      join jsonb_to_recordset(v_alcance) as a(tabla text, motivo text)
        on a.tabla = o.tabla and a.motivo is null),
    'no_incluye', jsonb_build_array(
      'Los archivos adjuntos (PDF, fotos, XML): el respaldo trae la ficha de cada uno -nombre, tipo, tamano-, no el archivo.',
      'La bitacora de auditoria: quien cambio que y cuando.',
      'Tu suscripcion con REGB: plan, facturas y pagos a REGB.')
  );

  update public.backups
  set payload    = v_indice,
      size_bytes = v_bytes + octet_length(v_indice::text)
  where id = v_id;

  -- Numeros, nunca datos: el outbox lo leen automatizaciones y webhooks
  -- que salen a sistemas de terceros.
  perform public.emit_event(
    'backup.snapshot.created',
    jsonb_build_object('backup_id', v_id, 'kind', p_kind, 'tablas', v_tablas,
                       'filas', v_filas, 'size_bytes', v_bytes + octet_length(v_indice::text)),
    'backup');

  return v_id;
end;
$$;

comment on function public.crear_respaldo(text[], text, integer) is
  'Respaldo completo del cliente bajo la RLS de quien lo pide. p_modulos = modulos que la accion verifico que el rol ve completos. Emite backup.snapshot.created.';

-- ── Permisos ────────────────────────────────────────────────────────────
revoke all on function public.respaldo_columnas_omitidas() from public, anon;
revoke all on function public.respaldo_tablas() from public, anon;
revoke all on function public.respaldo_tabla(text, text[], integer) from public, anon;
revoke all on function public.crear_respaldo(text[], text, integer) from public, anon;
grant execute on function public.respaldo_columnas_omitidas() to authenticated;
grant execute on function public.respaldo_tablas() to authenticated;
grant execute on function public.respaldo_tabla(text, text[], integer) to authenticated;
grant execute on function public.crear_respaldo(text[], text, integer) to authenticated;

-- ── 7. El catalogo deja de prometer lo que no hay ───────────────────────
--  Decia "Snapshots programados, export total y restauracion a un punto".
--  Export total ya es cierto; programados y restauracion, no.
update regb.module_catalog
set description = 'Copia completa de tus datos en JSON, descargable, que dice en la primera linea que trae y que no.',
    tagline     = 'Llevate tu informacion cuando quieras, entera'
where id = 'backup';

-- ═══════════════════════════════════════════════════════════════════════
--  0017 — Los helpers de claims toleran la ausencia de sesion
--
--  `current_setting('request.jwt.claims', true)` devuelve la CADENA VACIA
--  cuando el ajuste existe pero esta en blanco (una conexion del pool que
--  ya sirvio a otra transaccion, un cron, una limpieza administrativa), y
--  ''::jsonb revienta con "invalid input syntax for type json".
--
--  Mientras esto solo se llamaba desde politicas RLS pasaba inadvertido:
--  ahi siempre hay sesion. Al enganchar audit.record() a mas tablas en
--  0016, el trigger empezo a llamar a rls.regb_uid() en CUALQUIER
--  escritura — incluidas las que hace el dueno de las tablas sin claims —
--  y un simple `delete` de mantenimiento fallaba.
--
--  Sin sesion, lo correcto es "no se quien eres" (null), no un error.
--  El `nullif(..., '')` de fuera hace exactamente eso, y como siguen
--  siendo funciones SQL puras Postgres las sigue insertando en linea
--  dentro de las politicas: cero coste en RLS.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function rls.tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'tenant_id',
    ''
  )::uuid
$$;

create or replace function rls.is_provider()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'is_provider')::boolean,
    false
  )
$$;

create or replace function rls.regb_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid
$$;

comment on function rls.regb_uid() is
  'Usuario actual segun el JWT, o null si no hay sesion. Nunca lanza: la bitacora escribe desde triggers que corren con y sin sesion.';

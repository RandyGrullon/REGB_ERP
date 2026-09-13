-- ═══════════════════════════════════════════════════════════════════════
--  0109 — La base tambien mira el permiso, no solo el modulo
--
--  ── El hallazgo ───────────────────────────────────────────────────────
--
--  Ninguna de las 370 politicas de RLS miraba el ROL del usuario. Todas
--  filtran por tenant y por modulo activo, y nada mas.
--
--  Mientras todo pasaba por la app web eso no se notaba: el servidor
--  comprueba el permiso antes de cada consulta. Pero con el movil, que le
--  habla a PostgREST con la anon key y el token del usuario, la app deja
--  de estar en el medio.
--
--  Medido en este repo con el rol Cajero del tenant de demo:
--
--      select avg_cost from stock_levels  ->  620.0000, 411.5000
--      select count(*) from employees     ->  3
--
--  Las dos cosas que la app le esconde a ese rol. Y el tutorial promete
--  justo lo contrario, con estas palabras: "Ocultar el boton no es
--  seguridad. Cada ruta y cada accion vuelven a verificar el permiso en
--  el servidor, y LA BASE DE DATOS FILTRA POR SU CUENTA" (tour
--  core.permisos, paso 3). Esa ultima parte era falsa.
--
--  ── El alcance de ESTA migracion ──────────────────────────────────────
--
--  No se tocan las 370. Se anade el helper y se aplica donde el daño es
--  concreto y el permiso ya existe en el catalogo:
--
--    · costos de inventario   (`inventory.cost.view`)
--    · expedientes de empleado y nomina  (`employees.view`, `payroll.view`)
--    · llaves de API          (`api-webhooks.view`)
--    · configuracion de e-CF  (`e-invoice.view`) — ahi vive el token de
--      las URL publicas
--
--  El resto queda como deuda conocida, no como sorpresa.
--
--  ── Por que el helper NO deniega cuando falta informacion ─────────────
--
--  Si el token no trae `role_id` -sesiones viejas, un hook mal
--  configurado, el propio proveedor impersonando-, `has_perm` devuelve
--  TRUE y deja que sigan mandando el tenant y el modulo, que es lo que
--  habia hasta hoy.
--
--  Es deliberado y es la decision incomoda: denegar por defecto convierte
--  un despliegue con el hook a medias en "nadie puede trabajar", y eso en
--  una caja un sabado es peor que el problema que se arregla. La puerta
--  se cierra cuando el token trae el rol, que es el 100% de las sesiones
--  que abre el sistema hoy.
-- ═══════════════════════════════════════════════════════════════════════

-- ── El rol de quien llama, si el token lo trae ───────────────────────
create or replace function rls.role_id()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role_id',
    ''
  )::uuid
$$;

comment on function rls.role_id() is
  'El role_id del token. Null si la sesion no lo trae.';

-- ── Los patrones que cubren una accion ───────────────────────────────
--  Replica `matchingPatterns` de @regb/permissions, del mas especifico
--  al mas general. Para `inventory.cost.view`:
--    inventory.cost.view · inventory.cost.* · inventory.* · *.view · *
--
--  Se replica en SQL por lo mismo que el costo promedio en 0019: un
--  trigger no puede llamar a TypeScript. Y como es una replica, tiene
--  que coincidir exactamente o la base y la app discreparian sobre quien
--  puede que — hay pruebas que las comparan.
create or replace function rls.patrones_de(p_accion text)
returns text[]
language sql
immutable
as $$
  select array(select p from (
    select p_accion as p, 0 as orden
    union all
    select array_to_string(partes[1:i], '.') || '.*', 1
      from (select string_to_array(p_accion, '.') as partes) s,
           generate_series(array_length(s.partes, 1) - 1, 1, -1) as i
    union all
    select '*.' || (string_to_array(p_accion, '.'))[array_length(string_to_array(p_accion, '.'), 1)], 2
      where array_length(string_to_array(p_accion, '.'), 1) > 1
    union all
    select '*', 3
  ) t order by orden)
$$;

-- ── El evaluador ─────────────────────────────────────────────────────
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
    -- Sin rol en el token no se decide aqui: mandan tenant y modulo, que
    -- es lo que habia hasta 0109. Ver la cabecera de la migracion.
    when rls.role_id() is null then true
    -- El proveedor impersonando ya pasa por `rls.impersonating`.
    when rls.is_provider() then true
    when not exists (select 1 from r) then true
    -- Una sola denegacion explicita cierra la puerta, en cualquier nivel
    -- de especificidad. No hay concesion que la venza.
    when exists (
      select 1 from pat, r where (r.permissions -> pat.p) = 'false'::jsonb
    ) then false
    else exists (
      select 1 from pat, r where (r.permissions -> pat.p) = 'true'::jsonb
    )
  end
$$;

comment on function rls.has_perm(text) is
  'Si el rol del token concede la accion. Replica can() de @regb/permissions: comodines del mas especifico al mas general y la denegacion gana siempre. Devuelve true cuando el token no trae rol -ver 0109-.';

grant execute on function rls.role_id() to authenticated;
grant execute on function rls.patrones_de(text) to authenticated;
grant execute on function rls.has_perm(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
--  Donde se aplica
-- ═══════════════════════════════════════════════════════════════════════

-- ── Costos de inventario ─────────────────────────────────────────────
--  La RLS filtra FILAS, no columnas, asi que el costo no se puede
--  esconder con una politica. Y el permiso de columna tampoco sirve
--  solo: no distingue roles, asi que quitarselo a `authenticated` se lo
--  quita tambien al dueño del negocio.
--
--  La combinacion que si funciona:
--
--    1. Se le quita a `authenticated` el permiso sobre la COLUMNA
--       `avg_cost`. Con eso, nadie la lee por PostgREST — que es por
--       donde entraba el movil.
--    2. Una vista que corre como SU DUEÑO -no `security_invoker`- si
--       puede leerla, y la devuelve o la tapa segun el permiso del que
--       pregunta.
--
--  Correr como dueño significa que la RLS de `stock_levels` no aplica
--  dentro de la vista: el `where` de abajo es lo UNICO que separa a un
--  cliente de otro, y por eso repite tenant y modulo a mano.
--
--  Las CANTIDADES no se tocan. Quien vende necesita saber si hay, y un
--  sistema que le esconde el stock al vendedor no se usa.
--  OJO con la forma de escribirlo: en Postgres `revoke select (col)` NO
--  puede restarle una columna a un `grant select` de tabla entera. Se
--  intento asi primero y el costo seguia leyendose. Hay que quitar el
--  permiso de tabla y volver a conceder columna por columna.
revoke select on public.stock_levels from authenticated;
grant select (tenant_id, warehouse_id, product_id, qty_on_hand, qty_reserved, updated_at)
  on public.stock_levels to authenticated;

-- ── Y NO una vista ───────────────────────────────────────────────────
--
--  El primer intento fue una vista que corria como su dueño. La prueba
--  "Regla permanente: ninguna vista de public se salta la RLS"
--  (fiscal.test.ts) la rechazo, y con razon: es el patron que ya se colo
--  dos veces en este repo -dgii_607 y dgii_608- y su comentario dice
--  literalmente "si falla, no lo excluyas".
--
--  Con `security_invoker` la vista tampoco servia: hereda los permisos
--  de quien pregunta, y `authenticated` ya no puede leer la columna.
--
--  Asi que es una FUNCION, que es el patron que el repo si acepta para
--  esto -mismo caso que `public.mis_modulos()`-: corre como dueño, y su
--  propio `where` sobre `rls.tenant_id()` hace de RLS. Al ser funcion no
--  cae bajo la regla de las vistas, y queda explicito que es una
--  frontera a revisar y no una tabla mas.
create or replace function public.existencias()
returns table (
  tenant_id    uuid,
  warehouse_id uuid,
  product_id   uuid,
  qty_on_hand  numeric,
  qty_reserved numeric,
  avg_cost     numeric,
  updated_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select sl.tenant_id, sl.warehouse_id, sl.product_id,
         sl.qty_on_hand, sl.qty_reserved,
         -- Null y no cero: cero es un costo posible y mentiria.
         case when rls.has_perm('inventory.cost.view') then sl.avg_cost end,
         sl.updated_at
  from public.stock_levels sl
  -- Corre como dueño: esto SUSTITUYE a la RLS, no la acompaña.
  where sl.tenant_id = rls.tenant_id()
    and rls.module_active('inventory')
$$;

comment on function public.existencias() is
  'Existencias con el costo tapado para quien no tiene inventory.cost.view (0109). Es funcion y no vista a proposito: ver el comentario de 0109.';

revoke all on function public.existencias() from public;
grant execute on function public.existencias() to authenticated;

-- ── Expedientes y nomina ─────────────────────────────────────────────
drop policy if exists tenant_module on public.employees;
create policy tenant_module on public.employees for all
  using      (tenant_id = rls.tenant_id() and rls.module_active('employees')
              and rls.has_perm('employees.view'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('employees')
              and rls.has_perm('employees.view'));

drop policy if exists tenant_module on public.payroll_lines;
create policy tenant_module on public.payroll_lines for all
  using      (tenant_id = rls.tenant_id() and rls.module_active('payroll')
              and rls.has_perm('payroll.view'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('payroll')
              and rls.has_perm('payroll.view'));

-- ── Llaves de API ────────────────────────────────────────────────────
drop policy if exists tenant_module on public.api_keys;
create policy tenant_module on public.api_keys for all
  using      (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks')
              and rls.has_perm('api-webhooks.view'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('api-webhooks')
              and rls.has_perm('api-webhooks.view'));

-- ── Configuracion de e-CF ────────────────────────────────────────────
--  Ahi vive `endpoint_token`, que es lo unico que separa el buzon de un
--  contribuyente del de otro. Que lo lea cualquier empleado del tenant
--  no tiene por que.
drop policy if exists tenant_module on public.ecf_config;
create policy tenant_module on public.ecf_config for all
  using      (tenant_id = rls.tenant_id() and rls.module_active('e-invoice')
              and rls.has_perm('e-invoice.view'))
  with check (tenant_id = rls.tenant_id() and rls.module_active('e-invoice')
              and rls.has_perm('e-invoice.view'));

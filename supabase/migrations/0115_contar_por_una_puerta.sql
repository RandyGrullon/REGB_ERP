-- ═══════════════════════════════════════════════════════════════════════
--  0115 — Contar por una puerta, y solo mientras el conteo este abierto
--
--  Esto empezo como el paso que faltaba para que los conteos pasen por
--  la cola offline del movil (0114): la cola manda funciones, y contar
--  era lo unico del telefono que escribia una tabla directo.
--
--  Al mirarlo aparecio algo mas serio, y NO es lo mismo en las dos
--  tablas de conteo. Comprobado contra el esquema, no supuesto:
--
--  ┌───────────────────┬──────────────────┬──────────────────────────┐
--  │                   │ ¿mira el estado? │ ¿mira el permiso?        │
--  ├───────────────────┼──────────────────┼──────────────────────────┤
--  │ stock_count_lines │ NO -nadie-       │ NO                       │
--  │ cycle_count_lines │ si, trigger 0068 │ NO                       │
--  └───────────────────┴──────────────────┴──────────────────────────┘
--
--  La RLS de las dos acota tenant y modulo, y nada mas. El permiso de
--  columna de 0106 corta QUE columna se toca, no CUANDO ni QUIEN.
--
--  ── El agujero del conteo simple: hasta cuando ───────────────────────
--
--  `stock_count_lines` no tiene ningun trigger. Un PATCH a `counted_qty`
--  entra igual en un conteo ya cerrado.
--
--  Y cerrar es lo que convierte la diferencia en movimientos de ajuste
--  del kardex (`inventory/actions.ts`). Despues de eso, cambiar lo
--  contado reescribe la historia: el conteo dice una cosa y los ajustes
--  que salieron de el dicen otra. El kardex es inmutable (0107), asi que
--  los ajustes no se pueden realinear con el numero nuevo: quedan dos
--  verdades y ninguna forma de saber cual valia.
--
--  Es el agujero de 0106 un paso mas alla. Alli la pregunta era "¿que
--  columnas puede tocar quien cuenta?". Aqui es "¿hasta cuando?".
--
--  ── El agujero de los dos: quien ─────────────────────────────────────
--
--  Ninguna de las dos politicas mira el permiso. O sea que un cajero
--  -con su token, sin `inventory.count` ni `stock-counts.count`- podia
--  mandar el PATCH y escribir lo contado. El trigger de 0068 protege el
--  ciclico del CUANDO, pero no dice nada del QUIEN.
--
--  Con el movil hablandole a PostgREST esto deja de ser teorico: el
--  telefono anda en manos de quien cuenta, que es justo quien tiene
--  motivo para que un faltante desaparezca despues de cerrado.
--
--  ── El arreglo: una sola puerta ──────────────────────────────────────
--
--  Se revoca el UPDATE directo y se entra por una funcion que comprueba
--  el estado del conteo. Web y movil llaman a la MISMA: una regla que
--  vive en dos sitios se arregla en uno solo y sigue rota en el otro.
--
--  Son dos funciones y no una porque son dos conteos con vocabularios
--  distintos -el simple esta 'open', el ciclico esta 'counting'- y con
--  permisos distintos. Meterlas en una obligaria a adivinar en cual de
--  las dos tablas vive el id que llega, y "buscalo en las dos" es la
--  clase de atajo que despues nadie entiende.
--
--  ── Por que estas NO llevan `p_ref` ──────────────────────────────────
--
--  0114 se lo puso a transferir, gastos y vacaciones porque cada llamada
--  CREA una fila: repetirla crea otra. Contar no crea nada, ASIGNA un
--  numero a una linea que ya existe. Poner 43 dos veces deja 43. Ya es
--  idempotente por lo que hace, y agregarle una referencia seria copiar
--  la forma de 0114 sin copiar la razon.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
--  Conteo simple (0019) — el que usa el movil
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.contar(
  p_linea    uuid,
  p_cantidad numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_estado text;
begin
  if v_tenant is null then
    raise exception 'Sesion sin cliente.' using errcode = '28000';
  end if;

  if not rls.module_active('inventory') then
    raise exception 'El modulo de inventario no esta activo.' using errcode = '42501';
  end if;

  if not rls.has_perm('inventory.count') then
    raise exception 'Tu rol no permite contar inventario.' using errcode = '42501';
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    -- Cero SI se acepta: "no hay ninguno" es el resultado mas valioso de
    -- un conteo y confundirlo con "no lo he contado" es como se pierden
    -- los faltantes. Lo que no existe es una cantidad negativa.
    raise exception 'La cantidad contada no puede ser negativa.' using errcode = '22023';
  end if;

  -- La linea Y su conteo, en una sola pregunta y comprobando el tenant
  -- de las dos: esto corre como dueño, la RLS no esta aqui para ayudar.
  select c.status into v_estado
  from public.stock_count_lines l
  join public.stock_counts c on c.id = l.count_id and c.tenant_id = v_tenant
  where l.id = p_linea and l.tenant_id = v_tenant;

  if v_estado is null then
    raise exception 'Esa linea de conteo no es de esta cuenta.' using errcode = '42501';
  end if;

  if v_estado <> 'open' then
    -- El mensaje dice QUE hacer, no solo que fallo: quien lo lee esta en
    -- un pasillo con el telefono y un numero contado que no quiere
    -- perder.
    raise exception 'Este conteo ya se cerro. Pide que abran uno nuevo para ajustar.'
      using errcode = '23514';
  end if;

  update public.stock_count_lines
  set counted_qty = p_cantidad
  where id = p_linea and tenant_id = v_tenant;

  return p_linea;
end;
$$;

comment on function public.contar(uuid, numeric) is
  'Registra lo contado en una linea de conteo simple. Unica puerta: el UPDATE directo esta revocado porque nadie comprobaba que el conteo siguiera abierto, y tocar counted_qty despues de cerrar reescribe una diferencia que ya salio al kardex, que es inmutable (0115).';

revoke all on function public.contar(uuid, numeric) from public;
grant execute on function public.contar(uuid, numeric) to authenticated;

-- ───────────────────────────────────────────────────────────────────────
--  Conteo ciclico (0068)
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.contar_ciclico(
  p_linea    uuid,
  p_cantidad numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := rls.tenant_id();
  v_estado text;
begin
  if v_tenant is null then
    raise exception 'Sesion sin cliente.' using errcode = '28000';
  end if;

  if not rls.module_active('stock-counts') then
    raise exception 'El modulo de conteos ciclicos no esta activo.' using errcode = '42501';
  end if;

  if not rls.has_perm('stock-counts.count') then
    raise exception 'Tu rol no permite contar inventario.' using errcode = '42501';
  end if;

  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad contada no puede ser negativa.' using errcode = '22023';
  end if;

  select c.status into v_estado
  from public.cycle_count_lines l
  join public.cycle_counts c on c.id = l.count_id and c.tenant_id = v_tenant
  where l.id = p_linea and l.tenant_id = v_tenant;

  if v_estado is null then
    raise exception 'Esa linea de conteo no es de esta cuenta.' using errcode = '42501';
  end if;

  -- Aqui el vocabulario es otro: 'counting' es el unico estado en que se
  -- cuenta. `pending_approval` ya esta delante de un supervisor y
  -- `approved` ya movio el inventario; cambiar el numero en cualquiera
  -- de los dos es cambiarle la respuesta a alguien que ya decidio.
  --
  -- Esta comprobacion DUPLICA la del trigger `no_editar_linea_conteo_no
  -- _editable` de 0068, y se deja a proposito: el mensaje de aqui dice
  -- que paso en terminos de conteo y el del trigger es el generico de
  -- cualquier escritura. Lo que esta funcion agrega de nuevo al ciclico
  -- no es el estado -eso ya estaba- sino el PERMISO, que la politica de
  -- RLS no mira.
  if v_estado <> 'counting' then
    raise exception 'Este conteo ya se envio a aprobacion. No se puede seguir contando.'
      using errcode = '23514';
  end if;

  update public.cycle_count_lines
  set counted_qty = p_cantidad
  where id = p_linea and tenant_id = v_tenant;

  return p_linea;
end;
$$;

comment on function public.contar_ciclico(uuid, numeric) is
  'Registra lo contado en una linea de conteo ciclico. Solo mientras el conteo este en `counting`: despues ya esta delante de un supervisor o ya movio inventario (0115).';

revoke all on function public.contar_ciclico(uuid, numeric) from public;
grant execute on function public.contar_ciclico(uuid, numeric) to authenticated;

-- ───────────────────────────────────────────────────────────────────────
--  Y se cierra la puerta de atras
--
--  0106 habia dejado `grant update (counted_qty)`. Eso es lo que permite
--  el PATCH directo sin mirar el estado del conteo. Con las funciones
--  arriba, ya no hace falta: se revoca y queda una sola entrada.
-- ───────────────────────────────────────────────────────────────────────

revoke update (counted_qty) on public.stock_count_lines from authenticated;
revoke update (counted_qty) on public.cycle_count_lines from authenticated;

comment on column public.stock_count_lines.counted_qty is
  'Lo contado. NO se escribe por UPDATE directo: authenticated no tiene ese permiso desde 0115. Se escribe con public.contar(), que es quien comprueba que el conteo siga abierto.';

comment on column public.cycle_count_lines.counted_qty is
  'Lo contado. Se escribe con public.contar_ciclico(), unica puerta desde 0115: comprueba que el conteo siga en `counting`.';

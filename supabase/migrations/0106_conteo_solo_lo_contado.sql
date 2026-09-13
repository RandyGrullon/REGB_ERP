-- ═══════════════════════════════════════════════════════════════════════
--  0106 — Quien cuenta solo puede escribir lo que conto
--
--  ── El agujero ────────────────────────────────────────────────────────
--
--  `authenticated` tenia UPDATE sobre TODA la fila de las lineas de
--  conteo. La RLS acota el tenant y exige el modulo activo, pero dentro
--  de eso deja tocar cualquier columna — incluida `system_qty`.
--
--  `system_qty` es la foto del sistema al ABRIR el conteo. La diferencia
--  del conteo es `counted_qty - system_qty`, o sea que quien puede
--  escribir `system_qty` puede hacer que la diferencia sea CERO. Y el
--  conteo existe justamente para encontrar diferencias: un faltante que
--  se tapa asi no aparece en ningun reporte, en ninguna bitacora de
--  ajuste, en ningun sitio.
--
--  Mientras solo habia pantalla web daba menos miedo -las acciones del
--  servidor escriben el UPDATE y ahi solo se toca `counted_qty`-. Con el
--  movil hablandole a PostgREST, cualquiera con el telefono y el token
--  de su sesion manda el PATCH que quiera. Y el telefono anda en manos
--  de quien cuenta, que es exactamente la persona con motivo.
--
--  ── El arreglo ────────────────────────────────────────────────────────
--
--  Permiso a nivel de COLUMNA. Es lo unico que corta esto de verdad: una
--  politica de RLS decide QUE FILAS se tocan, no que columnas.
--
--  Comprobado antes de tocar nada: en todo el repo `system_qty` solo se
--  INSERTA (al abrir el conteo) y se LEE (al cerrarlo). No hay un solo
--  UPDATE. Los unicos UPDATE contra estas tablas escriben `counted_qty`.
--
--  El insert no se toca: abrir un conteo sigue necesitando escribir la
--  foto del sistema, y eso lo hace el servidor al crearlo.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Conteo simple (0019) ─────────────────────────────────────────────
revoke update on public.stock_count_lines from authenticated;
grant update (counted_qty) on public.stock_count_lines to authenticated;

-- ── Conteo ciclico (0068) ────────────────────────────────────────────
revoke update on public.cycle_count_lines from authenticated;
grant update (counted_qty) on public.cycle_count_lines to authenticated;

comment on column public.stock_count_lines.system_qty is
  'Foto del sistema al ABRIR el conteo. Solo se inserta y se lee: authenticated NO tiene update sobre esta columna (0106), porque poder escribirla es poder hacer desaparecer un faltante.';

comment on column public.cycle_count_lines.system_qty is
  'Foto del sistema al ABRIR el conteo. Sin update para authenticated (0106): ver el comentario de stock_count_lines.system_qty.';

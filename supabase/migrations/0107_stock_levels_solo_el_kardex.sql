-- ═══════════════════════════════════════════════════════════════════════
--  0107 — A stock_levels solo escribe el kardex
--
--  ── El agujero ────────────────────────────────────────────────────────
--
--  `public.stock_levels` NO es un dato: es la PROYECCION del kardex.
--  Cada fila la calcula el trigger `apply_inventory_movement` a partir de
--  los movimientos, dentro de la misma transaccion.
--
--  Pero `authenticated` tenia insert, update y delete sobre ella, con una
--  politica de RLS que solo acota tenant y modulo. O sea que cualquier
--  usuario del cliente -un cajero, el que cuenta, cualquiera con su
--  sesion- podia escribirla directo.
--
--  Comprobado en este repo, no deducido: con la sesion de un usuario
--  normal, un update subio una existencia de 31 a 1030 sin generar UN
--  SOLO movimiento de kardex. El kardex diria 31 y el sistema diria 1030,
--  para siempre, y el unico sitio donde eso se nota es al contar.
--
--  Con la app web sola costaba explotarlo -las acciones del servidor son
--  las que escriben-. Con el movil hablandole a PostgREST, la tabla queda
--  a un PATCH de distancia de cualquiera que tenga la app instalada.
--
--  ── Por que aqui SI se puede revocar entero ───────────────────────────
--
--  Porque nadie legitimo escribe esta tabla:
--
--    · El trigger que la mantiene es `security definer`, asi que corre
--      con los permisos de su dueño y no necesita los del usuario.
--    · En todo el repo no hay un solo insert, update o delete de
--      `stock_levels` fuera de ese trigger. Ni en SQL ni en TypeScript.
--    · `qty_reserved` tambien lo mueve ese mismo trigger. Lo que la app
--      escribe es `sales_order_lines.qty_reserved`, que es otra tabla.
--
--  El SELECT no se toca: leer existencias es el pan de cada dia.
--
--  ── Las otras dos tablas parecidas ────────────────────────────────────
--
--  `journal_entries` y `payroll_lines` tambien aceptan update de
--  `authenticated`, pero ahi SI hace falta -el borrador de un asiento se
--  edita- y estan protegidas donde importa por sus triggers
--  `no_editar_contabilizado` y `no_editar_linea_procesada`. Se dejan como
--  estan: revocarles el permiso romperia el trabajo normal.
-- ═══════════════════════════════════════════════════════════════════════

revoke insert, update, delete on public.stock_levels from authenticated;

comment on table public.stock_levels is
  'Proyeccion del kardex, mantenida por apply_inventory_movement. authenticated solo puede LEERLA (0107): escribirla a mano crea existencias sin movimiento y el kardex deja de cuadrar con el sistema. Para corregir, se hace un movimiento.';

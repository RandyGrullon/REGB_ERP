-- ═══════════════════════════════════════════════════════════════════════
--  0108 — Lo fiscal no se borra
--
--  ── Que se cierra ─────────────────────────────────────────────────────
--
--  `authenticated` podia BORRAR DE VERDAD -no soft delete, delete- las
--  facturas emitidas, los cobros, los e-CF enviados y recibidos, y los
--  contadores de secuencia fiscal.
--
--  Cada una destruye algo distinto:
--
--    · Una factura o un cobro borrado deja un hueco en la 607 y en la
--      contabilidad, sin rastro de que existio. Anular una factura es un
--      CAMBIO DE ESTADO, no un borrado: el numero queda quemado y eso es
--      precisamente lo que la DGII quiere ver.
--
--    · Un e-CF borrado deja al contribuyente sin poder probar que mando.
--      El unico que conserva el original entonces es la DGII.
--
--    · Un CONTADOR borrado es el peor de los cuatro y el menos obvio: se
--      vuelve a crear empezando de cero y el sistema reemite numeros ya
--      usados. Reusar un NCF sale en la 607 y es el tipo de hallazgo que
--      convierte una revision de rutina en otra cosa.
--
--  ── Por que ahora ─────────────────────────────────────────────────────
--
--  Mientras solo existia la web, borrar estas filas requeria una accion
--  del servidor que no existe. Con el movil hablando por PostgREST,
--  cualquiera con su sesion manda el DELETE.
--
--  ── Comprobado antes de revocar ───────────────────────────────────────
--
--  En todo el repo no hay un solo `delete from` contra ninguna de estas
--  seis tablas, ni en SQL ni en TypeScript. Lo que las pruebas limpian lo
--  limpian como dueño de la base, no como `authenticated`, asi que no se
--  ven afectadas.
--
--  El insert, el select y el update se quedan: emitir, consultar y anular
--  -que es un update de estado- siguen igual.
-- ═══════════════════════════════════════════════════════════════════════

revoke delete on public.customer_invoices          from authenticated;
revoke delete on public.customer_payments          from authenticated;
revoke delete on public.ecf_emitidos               from authenticated;
revoke delete on public.ecf_recibidos              from authenticated;
revoke delete on public.customer_invoice_counters  from authenticated;
revoke delete on public.journal_entry_counters     from authenticated;

comment on table public.customer_invoice_counters is
  'Secuencia de facturacion. NO se borra (0108): borrarla la reinicia y el sistema reemite numeros ya usados, que es lo que la DGII detecta en la 607.';

comment on table public.journal_entry_counters is
  'Secuencia de asientos. NO se borra (0108): mismo motivo que el contador de facturas.';

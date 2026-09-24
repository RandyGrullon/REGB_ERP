/**
 * Arranque del servidor web (Next lo llama una vez por proceso).
 *
 * ── La zona horaria ───────────────────────────────────────────────────
 *
 * Las pantallas del servidor formatean fechas con `toLocaleString('es-DO')`
 * sin `timeZone` en mas de doscientos sitios. Eso usa la zona del PROCESO:
 * en la maquina de desarrollo (UTC-4) sale bien de casualidad, pero en un
 * servidor en UTC -Vercel, casi cualquier nube- cada hora saldria 4 horas
 * adelantada y lo hecho despues de las 8 p. m. apareceria con la fecha de
 * mañana. Un ticket de las 9 de la noche fechado al dia siguiente.
 *
 * En vez de tocar doscientas llamadas, se fija la zona del proceso aqui:
 * Node respeta un cambio de `process.env.TZ` en caliente. Si el despliegue
 * ya la fija (TZ=...), se respeta la suya. Lo fiscal no depende de esto:
 * la base decide el periodo con `hoy_fiscal()` / `fecha_fiscal()` (0129).
 */
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && !process.env.TZ) {
    process.env.TZ = 'America/Santo_Domingo'
  }
}

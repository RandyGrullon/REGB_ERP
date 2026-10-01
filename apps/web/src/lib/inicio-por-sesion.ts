import { checkAccess, readSession } from '@regb/sdk'

/**
 * A donde va alguien con sesion que pide "el inicio" (`/` o `/login`).
 *
 * La pagina de inicio solo sabe pintar a una persona CON cliente: sin el,
 * `resolve()` no arma contexto y manda al login. Y el middleware, al ver
 * sesion en /login, mandaba de vuelta a `/`. Con inicio de sesion real eso
 * era un bucle de redirecciones para tres personas:
 *
 *  · el proveedor (REGB Control no tiene cliente en el token, por diseño);
 *  · quien entro pero todavia no acepta su invitacion (sin membresia);
 *  · el equipo de un cliente suspendido o archivado (el hook no le pone
 *    cliente).
 *
 * Encontrado probando contra Supabase de verdad: en modo demostracion no
 * pasa, porque ahi siempre hay un cliente simulado.
 *
 * Solo decide la RUTA. Que puede ver cada quien lo siguen decidiendo las
 * paginas (`requireProvider`, `resolve`) y la RLS: esto no es un control
 * de acceso, es no dejar a nadie dando vueltas.
 */
export function inicioPorSesion(claims: {
  sub: string
  email?: unknown
  app_metadata?: unknown
}): '/' | '/control' | '/sin-acceso' {
  const sesion = readSession({
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    app_metadata: claims.app_metadata,
  })
  if (sesion.isProvider) return '/control'
  if (checkAccess(sesion).blocked) return '/sin-acceso'
  return '/'
}

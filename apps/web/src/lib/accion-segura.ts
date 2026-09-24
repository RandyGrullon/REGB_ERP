import type { ActionResult } from './module-page'

/**
 * Una accion devuelve su error; no lo tira.
 *
 * `anotarAviso` solo sabe pintar un `ActionResult`. Si la accion LANZA
 * -un `raise` de la base, un rechazo de RLS o de un indice unico, un id
 * mal formado- el usuario ve la pagina de error generica de Next y pierde
 * lo que escribio. Paso con "Facturar" sin secuencia B01: `assign_ncf`
 * lanza a proposito, con un mensaje claro, y la pantalla reventaba en
 * vez de mostrarlo.
 *
 * El `error.tsx` global ataja lo que se escape, pero una accion no debe
 * llegar ahi: esto convierte la excepcion en un aviso legible, y la
 * transaccion ya se revirtio sola (asUser corre dentro de `begin`).
 */

/**
 * Un error que ya viene escrito para el usuario. Sirve para traducir, en
 * el sitio donde se entiende, un rechazo generico de la base (una RLS que
 * dice "new row violates...") a lo que significa ahi.
 */
export class ErrorDeNegocio extends Error {}

interface ErrorDePostgres {
  code?: unknown
  message?: unknown
  constraint_name?: unknown
}

/** Los errores de control de Next (redirect, notFound) tienen que seguir su camino. */
function esControlDeNext(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest)
}

/**
 * El mensaje que ve el usuario para una excepcion.
 *
 * Los `raise exception` de nuestras funciones ya vienen en español y dicen
 * que hacer (assign_ncf, las guardas de cliente, las de inmutabilidad): se
 * muestran tal cual. Los de Postgres crudos (en ingles, con nombres de
 * tabla) se traducen a lo que significan para el negocio.
 */
export function mensajeLegible(e: unknown): string {
  if (e instanceof ErrorDeNegocio) return e.message
  const pg = (e ?? {}) as ErrorDePostgres
  const code = typeof pg.code === 'string' ? pg.code : ''
  const msg = typeof pg.message === 'string' ? pg.message : ''
  const propio =
    msg !== '' &&
    !/^(new row|duplicate key|insert or update|update or delete|null value|invalid input|value too long|permission denied|column |relation |syntax error)/i.test(
      msg,
    )

  switch (code) {
    // assign_ncf (0026/0030): sin secuencia, vencida o agotada. El texto
    // ya dice que hacer; se agrega donde.
    case 'P0002':
    case 'P0003':
    case 'P0004':
      return `${msg} Se registra en Por cobrar > Comprobantes.`
    case 'P0001':
      return propio ? msg : 'La base rechazo la operacion.'
    case '42501':
      if (propio) return msg
      return 'No se pudo guardar: el modulo que maneja ese dato esta apagado, o el registro no es de este negocio.'
    case '23505':
      return 'Ya existe un registro con esos mismos datos. Revisa que no se haya guardado antes.'
    case '23514':
      if (propio) return msg
      return `Un dato no cumple las reglas del sistema${typeof pg.constraint_name === 'string' ? ` (${pg.constraint_name})` : ''}.`
    case '23503':
      return 'Hace referencia a algo que no existe o que ya no esta disponible.'
    case '23502':
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return 'Uno de los datos no tiene el formato esperado.'
    case '40001':
    case '40P01':
    case '55P03':
      return 'Otra persona estaba guardando lo mismo en ese momento. Intenta de nuevo.'
    default:
      return 'No se pudo completar. Intenta de nuevo; si se repite, avisale a soporte.'
  }
}

/**
 * Corre la accion y convierte cualquier excepcion en `{ ok: false }`.
 * `contexto` va al log del servidor, que es donde se diagnostica.
 */
export async function sinExcepciones(
  contexto: string,
  fn: () => Promise<ActionResult>,
): Promise<ActionResult> {
  try {
    return await fn()
  } catch (e) {
    if (esControlDeNext(e)) throw e
    console.error(`[${contexto}]`, e)
    return { ok: false, error: mensajeLegible(e) }
  }
}

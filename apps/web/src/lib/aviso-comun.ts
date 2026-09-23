/**
 * Lo del aviso que tambien necesita el NAVEGADOR.
 *
 * Vive aparte de `aviso.ts` porque ese es `server-only` -usa
 * `next/headers`- y el componente que pinta el aviso corre en el
 * cliente: importar la constante desde alli arrastraba todo el modulo
 * de servidor al bundle y Next lo rechaza en el build.
 *
 * Aqui solo hay un nombre de cookie y una forma. Nada de servidor.
 */

export const COOKIE_AVISO = 'regb_aviso'

export interface Aviso {
  tipo: 'ok' | 'error'
  texto: string
  /**
   * El siguiente paso natural, cuando lo hay. Ej.: tras cobrar, el
   * ticket con su NCF para imprimirlo: sin esto el cajero tenia que ir a
   * buscarlo a Cierres.
   */
  enlace?: { href: string; texto: string } | undefined
}

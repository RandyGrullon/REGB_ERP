/**
 * Tema de la app web — oscuro por defecto, claro a un clic.
 *
 * SIN `server-only`: el layout (servidor) lo lee de la cookie para pintar
 * `data-theme` en el primer HTML, y el boton (cliente) lo escribe. Leerlo
 * en el servidor es lo que evita el destello: si se decidiera en el
 * navegador, la pagina saldria oscura y saltaria a clara un instante
 * despues para quien eligio claro.
 *
 * Los dos temas son de primera: los tokens de `@regb/config` definen cada
 * color en `dark` y `light`, y `contrast.test.ts` vigila AA en ambos.
 */

export type Tema = 'dark' | 'light'

export const TEMA_POR_DEFECTO: Tema = 'dark'

export const COOKIE_TEMA = 'regb-tema'

/** Un año: es una preferencia, no una sesion. */
export const COOKIE_TEMA_MAX_AGE = 60 * 60 * 24 * 365

/** Lo que venga en la cookie es una sugerencia: solo se aceptan los dos valores. */
export function temaDe(valor: string | undefined | null): Tema {
  return valor === 'light' || valor === 'dark' ? valor : TEMA_POR_DEFECTO
}

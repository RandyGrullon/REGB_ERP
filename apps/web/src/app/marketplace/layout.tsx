import type { ReactNode } from 'react'
import { Aviso } from '@/components/Aviso'
import { leerAviso } from '@/lib/aviso'

/**
 * El aviso de "esto se hizo", para el marketplace.
 *
 * ── El fallo que arregla ──────────────────────────────────────────────
 *
 * Pedir modulos NO confirmaba nada. Se elegian, se pulsaba "Solicitar
 * activacion" -que vive en la barra pegada abajo- y la pantalla se
 * quedaba exactamente igual. La peticion SI se guardaba; simplemente
 * nadie te lo decia.
 *
 * El aviso ya existia y la accion ya lo anotaba (`anotarAviso` en
 * `actions.ts`), pero lo pinta el `Shell`, y esta pantalla no lleva Shell
 * -es una vista inmersiva, igual que `/roles` y que `REGB Control`-. O
 * sea que la cookie del aviso se escribia y se moria sin que nadie la
 * leyera.
 *
 * `control` ya tenia este mismo problema y lo resolvio asi, con un
 * layout. Se copia el patron en vez de inventar otro: son las dos zonas
 * del ERP que viven fuera del Shell y deben enterarse igual.
 *
 * ── Por que un layout y no la propia pagina ──────────────────────────
 *
 * Porque `/marketplace/[id]` -la ficha de cada modulo- es la otra mitad
 * de esta zona y tiene sus propios botones. Ponerlo en la pagina de la
 * lista habria dejado la ficha igual de muda, y el proximo que lo note
 * seria otra vez un usuario.
 *
 * El aviso se pinta flotando arriba a la derecha, asi que se ve aunque
 * el boton este al fondo de una lista de 79 modulos, que es justo el
 * caso donde "no pasa nada" se sentia mas.
 */
export default async function MarketplaceLayout({ children }: { children: ReactNode }) {
  const aviso = await leerAviso()

  return (
    <>
      <Aviso aviso={aviso} />
      {children}
    </>
  )
}

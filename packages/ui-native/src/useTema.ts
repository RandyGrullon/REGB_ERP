/**
 * El tema vivo de la app movil.
 *
 * En movil NO hay selector de tema propio: manda el sistema operativo,
 * igual que en la web manda `prefers-color-scheme`. Si el sistema no dice
 * nada -`useColorScheme()` devuelve null mientras arranca- caemos en
 * oscuro, que es el tema por defecto de Aurora.
 */
import { useColorScheme } from 'react-native'
import { temas, type Tema, type TemaAurora } from './tokens'

export function useTema(): TemaAurora {
  const esquema = useColorScheme()
  return temas[esquema === 'light' ? 'claro' : 'oscuro']
}

/** Version sin hook, para codigo que ya sabe que tema quiere (pruebas, storybook). */
export function temaPorNombre(nombre: Tema): TemaAurora {
  return temas[nombre]
}

import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTema } from '../useTema'
import { Texto } from './Texto'

/**
 * Estado vacio.
 *
 * Ley de Aurora (§11.5): nunca una lista vacia muda. Titulo, una frase
 * con humor en espanol dominicano y, si la hay, la accion que saca al
 * usuario del vacio.
 */
export interface PropsEstadoVacio {
  titulo: string
  descripcion: string
  accion?: ReactNode
}

export function EstadoVacio({ titulo, descripcion, accion }: PropsEstadoVacio) {
  const tema = useTema()

  return (
    <View
      style={[
        estilos.caja,
        {
          gap: tema.espacio[2],
          padding: tema.espacio[6],
          backgroundColor: tema.color.superficie.base,
        },
      ]}
    >
      <Texto variante="subtitulo" style={estilos.centrado}>
        {titulo}
      </Texto>
      <Texto tono="secundario" style={estilos.centrado}>
        {descripcion}
      </Texto>
      {accion}
    </View>
  )
}

const estilos = StyleSheet.create({
  caja: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centrado: { textAlign: 'center' },
})

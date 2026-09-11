import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { conAlfa } from '../tokens'
import { useTema } from '../useTema'
import { Texto, type TonoTexto } from './Texto'

/**
 * Pildora de estado.
 *
 * Ley de Aurora: el estado NUNCA se comunica solo con color. Siempre
 * color + punto + texto, para quien no distingue rojo de verde (§11.7).
 * Por eso el punto va por defecto y hay que apagarlo a proposito.
 */
export type TonoInsignia = 'neutral' | 'exito' | 'alerta' | 'peligro' | 'info' | 'marca'

export interface PropsInsignia {
  children: string
  tono?: TonoInsignia
  /** Punto de color a la izquierda. */
  punto?: boolean
  style?: StyleProp<ViewStyle>
}

export function Insignia({ children, tono = 'neutral', punto = true, style }: PropsInsignia) {
  const tema = useTema()

  const relleno: Record<TonoInsignia, string> = {
    neutral: tema.color.relleno.neutral,
    exito: tema.color.relleno.exito,
    alerta: tema.color.relleno.alerta,
    peligro: tema.color.relleno.peligro,
    info: tema.color.relleno.info,
    marca: tema.color.marca.base,
  }

  // El texto va siempre en la familia `textoEstado` (AA 4.5:1), nunca en la
  // de relleno, que solo cumple el umbral de componente.
  const tonoTexto: Record<TonoInsignia, TonoTexto> = {
    neutral: 'neutral',
    exito: 'exito',
    alerta: 'alerta',
    peligro: 'peligro',
    info: 'info',
    marca: 'marca',
  }

  return (
    <View
      style={[
        estilos.base,
        {
          gap: tema.espacio[1],
          paddingHorizontal: tema.espacio[2],
          paddingVertical: tema.espacio[1],
          borderRadius: tema.radio.completo,
          backgroundColor: tono === 'marca' ? tema.color.marca.suave : conAlfa(relleno[tono], 0.18),
        },
        style,
      ]}
    >
      {punto && (
        <View
          accessible={false}
          style={[
            estilos.punto,
            { borderRadius: tema.radio.completo, backgroundColor: relleno[tono] },
          ]}
        />
      )}
      <Texto variante="pie" tono={tonoTexto[tono]}>
        {children}
      </Texto>
    </View>
  )
}

const estilos = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  punto: { width: 6, height: 6 },
})

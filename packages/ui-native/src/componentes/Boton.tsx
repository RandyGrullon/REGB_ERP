import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useTema } from '../useTema'
import { Texto, type TonoTexto } from './Texto'

/**
 * Boton de Aurora en nativo.
 *
 * Dos cosas que no se negocian (§11.7): el area tactil minima sale de
 * `disposicion.areaTactil` -44 px- y el estado "cargando" se anuncia al
 * lector de pantalla con `accessibilityState.busy`, no solo con la ruedita.
 */
export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro'

export interface PropsBoton {
  etiqueta: string
  onPress: () => void | Promise<void>
  variante?: VarianteBoton
  cargando?: boolean
  deshabilitado?: boolean
  style?: StyleProp<ViewStyle>
}

export function Boton({
  etiqueta,
  onPress,
  variante = 'primario',
  cargando = false,
  deshabilitado = false,
  style,
}: PropsBoton) {
  const tema = useTema()
  const inactivo = deshabilitado || cargando

  const fondo: Record<VarianteBoton, string> = {
    primario: tema.color.marca.base,
    secundario: tema.color.superficie.elevada,
    fantasma: 'transparent',
    peligro: tema.color.relleno.peligro,
  }

  const tonoTexto: Record<VarianteBoton, TonoTexto> = {
    primario: 'sobreMarca',
    secundario: 'primario',
    fantasma: 'secundario',
    peligro: 'sobreMarca',
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      disabled={inactivo}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        estilos.base,
        {
          minHeight: tema.disposicion.areaTactil,
          paddingHorizontal: tema.espacio[4],
          borderRadius: tema.radio.md,
          backgroundColor: fondo[variante],
          borderWidth: variante === 'fantasma' ? 1 : 0,
          borderColor: tema.color.borde.normal,
          opacity: inactivo ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {cargando && (
        <View style={estilos.ruedita}>
          <ActivityIndicator
            size="small"
            color={
              variante === 'primario' || variante === 'peligro'
                ? tema.color.texto.sobreMarca
                : tema.color.texto.primario
            }
          />
        </View>
      )}
      <Texto variante="cuerpo" tono={tonoTexto[variante]} style={estilos.etiqueta}>
        {etiqueta}
      </Texto>
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  etiqueta: { fontWeight: '600' },
  ruedita: { justifyContent: 'center' },
})

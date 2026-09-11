import { useId } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import { useTema } from '../useTema'
import { Texto } from './Texto'

/**
 * Campo de texto con etiqueta visible.
 *
 * La etiqueta se ve SIEMPRE, nunca es solo un placeholder que desaparece
 * al escribir: quien vuelve a un formulario a medias necesita saber que
 * estaba llenando. Ademas va como `accessibilityLabel` para el lector.
 */
export interface PropsCampo extends Omit<TextInputProps, 'accessibilityLabel'> {
  etiqueta: string
  /** Mensaje de error: se pinta debajo y cambia el borde. */
  error?: string
  /** Texto de ayuda cuando no hay error. */
  ayuda?: string
}

export function Campo({ etiqueta, error, ayuda, style, ...resto }: PropsCampo) {
  const tema = useTema()
  const id = useId()

  return (
    <View style={estilos.grupo}>
      <Texto variante="pie" tono="secundario" nativeID={`${id}-etiqueta`}>
        {etiqueta}
      </Texto>
      <TextInput
        accessibilityLabel={etiqueta}
        accessibilityLabelledBy={`${id}-etiqueta`}
        placeholderTextColor={tema.color.texto.apagado}
        style={[
          {
            minHeight: tema.disposicion.areaTactil,
            paddingHorizontal: tema.espacio[3],
            paddingVertical: tema.espacio[2],
            borderRadius: tema.radio.md,
            borderWidth: 1,
            borderColor: error ? tema.color.relleno.peligro : tema.color.borde.normal,
            backgroundColor: tema.color.superficie.campo,
            color: tema.color.texto.primario,
            fontSize: tema.tipografia.body.tamano,
          },
          style,
        ]}
        {...resto}
      />
      {error ? (
        <Texto variante="pie" tono="peligro">
          {error}
        </Texto>
      ) : ayuda ? (
        <Texto variante="pie" tono="atenuado">
          {ayuda}
        </Texto>
      ) : null}
    </View>
  )
}

const estilos = StyleSheet.create({
  grupo: { gap: 4 },
})

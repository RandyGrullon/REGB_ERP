import { View, type ViewProps } from 'react-native'
import { useTema } from '../useTema'

/** Contenedor elevado: la unidad de contenido del movil, equivalente a `Card` en web. */
export function Tarjeta({ style, ...resto }: ViewProps) {
  const tema = useTema()

  return (
    <View
      style={[
        {
          padding: tema.espacio[3],
          borderRadius: tema.radio.lg,
          borderWidth: 1,
          borderColor: tema.color.borde.normal,
          backgroundColor: tema.color.superficie.elevada,
        },
        style,
      ]}
      {...resto}
    />
  )
}

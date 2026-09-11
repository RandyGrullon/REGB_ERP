import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import type { ReactNode } from 'react'
import { useTema } from '../useTema'

/**
 * Fila de lista, con o sin toque.
 *
 * Si lleva `onPress` se anuncia como boton y respeta el area tactil
 * minima de 44 px (§11.7); si no, es una fila muda y no se anuncia como
 * algo que se pueda tocar.
 */
export interface PropsFila {
  children: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

export function Fila({ children, onPress, style }: PropsFila) {
  const tema = useTema()

  const base: ViewStyle = {
    minHeight: tema.disposicion.areaTactil,
    justifyContent: 'center',
    paddingHorizontal: tema.espacio[4],
    paddingVertical: tema.espacio[3],
    borderBottomWidth: 1,
    borderBottomColor: tema.color.borde.normal,
    backgroundColor: tema.color.superficie.base,
  }

  if (!onPress) return <View style={[base, style]}>{children}</View>

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        base,
        pressed ? { backgroundColor: tema.color.superficie.superpuesta } : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  )
}

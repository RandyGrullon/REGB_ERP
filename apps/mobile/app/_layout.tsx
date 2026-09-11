import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { useTema } from '@regb/ui-native'
import { ProveedorSesion } from '../src/sesion'

/** Raiz de la app: sesion y navegacion. El tema sigue al del sistema, igual que la web. */
export default function LayoutRaiz() {
  const esquema = useColorScheme()
  const tema = useTema()

  return (
    <ProveedorSesion>
      <StatusBar style={esquema === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: tema.color.superficie.honda },
          headerTintColor: tema.color.texto.primario,
          contentStyle: { backgroundColor: tema.color.superficie.base },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'REGB ERP' }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </ProveedorSesion>
  )
}

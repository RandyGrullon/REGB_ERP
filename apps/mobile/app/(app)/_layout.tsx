import { Stack, Redirect } from 'expo-router'
import { useTema } from '@regb/ui-native'
import { useSesion } from '../../src/sesion'

/**
 * Todo lo de adentro exige sesion con tenant.
 *
 * El movil NO replica el ERP completo: solo lo que cada manifest declara
 * en `mobileScope`. Hoy la unica pantalla portada es `chat` -prueba de
 * concepto de las tres plataformas-.
 */
export default function LayoutApp() {
  const { cargando, sesion } = useSesion()
  const tema = useTema()

  if (cargando) return null
  if (!sesion?.tenantId) return <Redirect href="/" />

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: tema.color.superficie.deep },
        headerTintColor: tema.color.texto.primario,
        contentStyle: { backgroundColor: tema.color.superficie.base },
      }}
    >
      <Stack.Screen name="chat/index" options={{ title: 'Chat interno' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Canal' }} />
    </Stack>
  )
}

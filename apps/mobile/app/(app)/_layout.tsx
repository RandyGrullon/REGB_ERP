import { Stack, Redirect } from 'expo-router'
import { useTema } from '@regb/ui-native'
import { useSesion } from '../../src/sesion'
import { ProveedorPermisos } from '../../src/permisos'
import { ProveedorCola } from '../../src/cola'

/**
 * Todo lo de adentro exige sesion con tenant.
 *
 * El movil NO replica el ERP completo: solo lo que cada manifest declara
 * en `mobileScope`. La pantalla de inicio decide que enseñar mirando los
 * modulos que el cliente tiene activos, no una lista escrita a mano.
 */
export default function LayoutApp() {
  const { cargando, sesion } = useSesion()
  const tema = useTema()

  if (cargando) return null
  if (!sesion?.tenantId) return <Redirect href="/" />

  // La cola envuelve a los permisos y no al reves: lo que hay dentro de
  // ella es trabajo ya hecho por una persona, y tiene que sobrevivir a
  // que el rol tarde en cargar o falle en cargar.
  return (
    <ProveedorCola>
    <ProveedorPermisos>
      <Stack
      screenOptions={{
        headerStyle: { backgroundColor: tema.color.superficie.honda },
        headerTintColor: tema.color.texto.primario,
        contentStyle: { backgroundColor: tema.color.superficie.base },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'REGB ERP' }} />
      <Stack.Screen name="existencias/index" options={{ title: 'Existencias' }} />
      <Stack.Screen name="transferir/index" options={{ title: 'Transferir' }} />
      <Stack.Screen name="conteos/index" options={{ title: 'Conteos' }} />
      <Stack.Screen name="conteos/[id]" options={{ title: 'Contar' }} />
      <Stack.Screen name="vacaciones/index" options={{ title: 'Vacaciones' }} />
      <Stack.Screen name="gastos/index" options={{ title: 'Gastos' }} />
      <Stack.Screen name="chat/index" options={{ title: 'Chat interno' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Canal' }} />
      <Stack.Screen name="pendientes/index" options={{ title: 'Sin subir' }} />
      </Stack>
    </ProveedorPermisos>
    </ProveedorCola>
  )
}

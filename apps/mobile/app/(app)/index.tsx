import { useEffect, useState } from 'react'
import { View, ScrollView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { EstadoVacio, Fila, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../src/supabase'

/**
 * Lo que este cliente puede hacer desde el telefono.
 *
 * ── Por que se consulta y no se escribe a mano ────────────────────────
 *
 * El movil NO replica el ERP: cada modulo declara en su manifest que
 * parte suya vale la pena en un telefono (`mobileScope`). Un menu con
 * las secciones escritas a mano enseñaria Existencias a un cliente que
 * no tiene el modulo de inventario contratado —y le daria un 403 al
 * tocarlo, que es la peor forma de enterarse—.
 *
 * Los modulos vivos salen de `regb.tenant_modules` via RLS, igual que en
 * la web. El telefono no tiene ningun privilegio extra por ser una app
 * instalada.
 */
interface Seccion {
  moduleId: string
  titulo: string
  descripcion: string
  ruta: string
}

/**
 * El catalogo de lo que existe en movil HOY.
 *
 * Vive en la app -no en el core- a proposito: es la app la que sabe que
 * pantallas tiene compiladas. El core no puede conocer modulos (§2.2), y
 * una lista de rutas de React Native no le sirve de nada.
 */
const SECCIONES: Seccion[] = [
  {
    moduleId: 'inventory',
    titulo: 'Existencias',
    descripcion: 'Cuanto hay y en que almacen, desde el piso de venta',
    ruta: '/(app)/existencias',
  },
  {
    moduleId: 'chat',
    titulo: 'Chat interno',
    descripcion: 'Lo que se habla del trabajo, donde se trabaja',
    ruta: '/(app)/chat',
  },
]

export default function Inicio() {
  const tema = useTema()
  const router = useRouter()
  const [activos, setActivos] = useState<Set<string> | null>(null)

  useEffect(() => {
    void (async () => {
      // `public.mis_modulos()` y NO `.from('tenant_modules')`.
      //
      // Esa tabla vive en el esquema `regb`, y PostgREST -por donde
      // habla el telefono- solo expone `public`. La consulta directa no
      // fallaba de forma visible: devolvia vacio, y el menu salia sin
      // nada como si el cliente no tuviera modulos contratados.
      const { data } = await supabase.rpc('mis_modulos')
      setActivos(new Set(((data as { module_id: string }[] | null) ?? []).map((r) => r.module_id)))
    })()
  }, [])

  if (activos === null) {
    return (
      <View style={[estilos.centro, { backgroundColor: tema.color.superficie.base }]}>
        <Texto tono="atenuado">Cargando…</Texto>
      </View>
    )
  }

  const visibles = SECCIONES.filter((s) => activos.has(s.moduleId))

  if (visibles.length === 0) {
    return (
      <EstadoVacio
        titulo="Nada para el telefono todavia"
        descripcion="Ninguno de tus modulos activos tiene pantalla movil. Entra desde la computadora."
      />
    )
  }

  return (
    <ScrollView style={{ backgroundColor: tema.color.superficie.base }}>
      {visibles.map((s) => (
        <Fila key={s.moduleId} onPress={() => router.push(s.ruta)}>
          <Texto variante="cuerpo">{s.titulo}</Texto>
          <Texto variante="pie" tono="atenuado">
            {s.descripcion}
          </Texto>
        </Fila>
      ))}
    </ScrollView>
  )
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})

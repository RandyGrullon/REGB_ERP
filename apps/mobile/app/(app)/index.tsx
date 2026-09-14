import { View, ScrollView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { EstadoVacio, Fila, Texto, useTema } from '@regb/ui-native'
import { usePermisos } from '../../src/permisos'
import { SECCIONES } from '../../src/menu'

/**
 * Lo que ESTE usuario puede hacer desde el telefono.
 *
 * Se filtra por dos cosas, y las dos hacen falta:
 *
 *   · el modulo lo tiene contratado el cliente (`mis_modulos`)
 *   · el rol lo concede (`mi_rol` + `can()` de @regb/permissions)
 *
 * Solo con el modulo no basta: a un cajero se le enseñaria "Contar
 * inventario" para que descubra al segundo toque que no puede. Un 403
 * es la peor forma de enterarse de que no tienes permiso.
 *
 * Es ERGONOMIA, no seguridad. Lo que decide de verdad es la RLS — ver
 * `docs/PERMISOS-Y-RLS.md`.
 *
 * La tabla de secciones vive en `src/menu.ts` para que se pueda probar:
 * un permiso mal escrito vacia el menu en silencio.
 */
export default function Inicio() {
  const tema = useTema()
  const router = useRouter()
  // Modulos contratados Y permisos del rol. Los dos salen de
  // `mi_rol()` y `mis_modulos()`: ver src/permisos.tsx.
  const { cargando, puede } = usePermisos()

  if (cargando) {
    return (
      <View style={[estilos.centro, { backgroundColor: tema.color.superficie.base }]}>
        <Texto tono="atenuado">Cargando…</Texto>
      </View>
    )
  }

  // Por modulo contratado Y por permiso del rol. Solo el modulo no
  // basta: a un cajero no se le enseña "Contar inventario" para que
  // descubra al segundo toque que no puede.
  const visibles = SECCIONES.filter((s) => puede(s.permiso, s.moduleId))

  if (visibles.length === 0) {
    return (
      <EstadoVacio
        titulo="Nada para ti en el telefono"
        descripcion="Ninguna pantalla movil corresponde a tu rol y a los modulos activos. Entra desde la computadora."
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

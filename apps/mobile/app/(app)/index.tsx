import { View, ScrollView, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { usePermisos } from '../../src/permisos'
import { useCola } from '../../src/cola'
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
  const { indicador } = useCola()

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

  // La fila de pendientes NO se filtra por permiso ni por modulo, y va
  // arriba de todo. Lo que hay ahi dentro es trabajo que esta persona ya
  // hizo: si se le escondiera porque su rol cambio o porque el cliente
  // apago un modulo, se quedaria sin forma de ver -ni de recuperar- algo
  // que ocurrio de verdad.
  const pendientes =
    indicador.texto === null ? null : (
      <Fila onPress={() => router.push('/pendientes')}>
        <View style={estilos.linea}>
          <Texto variante="cuerpo" style={estilos.crece}>
            Sin subir
          </Texto>
          <Insignia tono={indicador.tono ?? 'neutral'}>{indicador.texto}</Insignia>
        </View>
        <Texto variante="pie" tono="atenuado">
          {indicador.bloqueadas > 0
            ? 'Algo no se pudo guardar. Toca para ver que paso.'
            : 'Sube solo en cuanto haya señal.'}
        </Texto>
      </Fila>
    )

  if (visibles.length === 0) {
    return (
      <ScrollView style={{ backgroundColor: tema.color.superficie.base }}>
        {pendientes}
        <EstadoVacio
          titulo="Nada para ti en el telefono"
          descripcion="Ninguna pantalla movil corresponde a tu rol y a los modulos activos. Entra desde la computadora."
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView style={{ backgroundColor: tema.color.superficie.base }}>
      {pendientes}
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
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crece: { flex: 1 },
})

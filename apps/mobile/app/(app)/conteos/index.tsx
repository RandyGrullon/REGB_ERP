import { useCallback, useEffect, useState } from 'react'
import { FlatList, RefreshControl, View, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'

/**
 * Los conteos abiertos.
 *
 * El movil no ABRE conteos: eso se decide en la oficina -que almacen,
 * que productos- y es donde se toma la foto del sistema. Aqui solo se
 * cuenta, que es lo que se hace de pie en un pasillo.
 */
interface ConteoCrudo {
  id: string
  started_at: string
  warehouses: { name: string } | null
}

export default function Conteos() {
  const tema = useTema()
  const router = useRouter()
  const [conteos, setConteos] = useState<ConteoCrudo[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('stock_counts')
      .select('id, started_at, warehouses(name)')
      .eq('status', 'open')
      .order('started_at', { ascending: false })
    setConteos((data as ConteoCrudo[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (!cargando && conteos.length === 0) {
    return (
      <EstadoVacio
        titulo="No hay conteos abiertos"
        descripcion="Los conteos se abren desde la computadora, eligiendo almacen y productos. Aqui se cuentan."
      />
    )
  }

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })

  return (
    <View style={[estilos.pantalla, { backgroundColor: tema.color.superficie.base }]}>
      <FlatList
        data={conteos}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={() => void cargar()} />}
        renderItem={({ item }) => (
          <Fila onPress={() => router.push(`/(app)/conteos/${item.id}`)}>
            <View style={estilos.linea}>
              <Texto variante="cuerpo" style={estilos.nombre}>
                {item.warehouses?.name ?? 'Sin almacen'}
              </Texto>
              <Insignia tono="info">Abierto</Insignia>
            </View>
            <Texto variante="pie" tono="atenuado">
              Empezado el {fecha(item.started_at)}
            </Texto>
          </Fila>
        )}
      />
    </View>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre: { flex: 1 },
})

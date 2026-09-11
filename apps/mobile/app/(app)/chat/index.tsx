import { useCallback, useEffect, useState } from 'react'
import { FlatList, RefreshControl, View, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'

interface Canal {
  id: string
  name: string
  scope_type: string
}

const AMBITO: Record<string, string> = {
  module: 'Modulo',
  project: 'Proyecto',
  branch: 'Sucursal',
  general: 'General',
}

/**
 * Lista de canales.
 *
 * No filtra por tenant a mano: RLS ya lo hace con los claims del token
 * que Supabase manda en cada peticion. El telefono no tiene ningun
 * privilegio extra por ser una app instalada.
 */
export default function ListaCanales() {
  const tema = useTema()
  const router = useRouter()
  const [canales, setCanales] = useState<Canal[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('chat_channels')
      .select('id, name, scope_type')
      .order('created_at', { ascending: true })
    setCanales((data as Canal[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (!cargando && canales.length === 0) {
    return (
      <EstadoVacio
        titulo="Todavia no hay ningun canal"
        descripcion="Crea el primero desde la version web; el movil por ahora solo lee y responde."
      />
    )
  }

  return (
    <FlatList
      style={{ backgroundColor: tema.color.superficie.base }}
      data={canales}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargar} />}
      renderItem={({ item }) => (
        <Fila onPress={() => router.push(`/(app)/chat/${item.id}`)}>
          <View style={estilos.fila}>
            <Texto>{item.name}</Texto>
            <Insignia tono="neutral">{AMBITO[item.scope_type] ?? item.scope_type}</Insignia>
          </View>
        </Fila>
      )}
    />
  )
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
})

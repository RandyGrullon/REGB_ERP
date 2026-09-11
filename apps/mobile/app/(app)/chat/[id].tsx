import { useCallback, useEffect, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { formatearMencion } from '@regb/operations'
import { Boton, Campo, Tarjeta, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'
import { useSesion } from '../../../src/sesion'

interface Mensaje {
  id: string
  body: string
  created_at: string
  parent_message_id: string | null
  author_id: string
  mentioned_user_ids: string[]
}

/**
 * Hilo de un canal.
 *
 * `formatearMencion()` es la MISMA funcion que usa la web -vive en
 * @regb/operations-, asi que una mencion se ve identica en las tres
 * plataformas. Un mensaje enviado es inmutable: aqui tampoco se edita.
 */
export default function HiloCanal() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { sesion } = useSesion()
  const tema = useTema()
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    if (!id) return

    const [{ data: filas }, { data: perfiles }] = await Promise.all([
      supabase
        .from('chat_messages')
        .select('id, body, created_at, parent_message_id, author_id, mentioned_user_ids')
        .eq('channel_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('user_profiles').select('user_id, display_name'),
    ])

    setMensajes((filas as Mensaje[] | null) ?? [])
    setNombres(
      Object.fromEntries(
        ((perfiles as { user_id: string; display_name: string }[] | null) ?? []).map((p) => [
          p.user_id,
          p.display_name,
        ]),
      ),
    )
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const enviar = async () => {
    if (!texto.trim() || !id || !sesion) return
    setEnviando(true)
    await supabase.from('chat_messages').insert({
      tenant_id: sesion.tenantId,
      channel_id: id,
      author_id: sesion.userId,
      body: texto.trim(),
    })
    setTexto('')
    await cargar()
    setEnviando(false)
  }

  return (
    <KeyboardAvoidingView
      style={[estilos.raiz, { backgroundColor: tema.color.superficie.base }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        data={mensajes}
        keyExtractor={(m) => m.id}
        contentContainerStyle={estilos.lista}
        renderItem={({ item }) => (
          <Tarjeta style={item.parent_message_id ? estilos.respuesta : undefined}>
            <Texto variante="pie" tono="atenuado">
              {nombres[item.author_id] ?? 'Usuario'} ·{' '}
              {new Date(item.created_at).toLocaleString('es-DO')}
            </Texto>
            <Texto>{item.body}</Texto>
            {item.mentioned_user_ids.length > 0 && (
              <Texto variante="pie" tono="marca">
                {item.mentioned_user_ids
                  .map((uid) => formatearMencion(nombres[uid] ?? 'Usuario'))
                  .join(' ')}
              </Texto>
            )}
          </Tarjeta>
        )}
      />
      <View style={estilos.compositor}>
        <View style={estilos.campo}>
          <Campo etiqueta="Mensaje" value={texto} onChangeText={setTexto} />
        </View>
        <Boton etiqueta="Enviar" cargando={enviando} onPress={enviar} />
      </View>
    </KeyboardAvoidingView>
  )
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  lista: { padding: 12, gap: 8 },
  respuesta: { marginLeft: 24 },
  compositor: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12 },
  campo: { flex: 1 },
})

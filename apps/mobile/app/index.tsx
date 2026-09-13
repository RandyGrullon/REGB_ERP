import { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Redirect } from 'expo-router'
import { Boton, Campo, Tarjeta, Texto, useTema } from '@regb/ui-native'
import { useSesion } from '../src/sesion'

/** Entrada: si ya hay sesion con tenant, adentro; si no, pedir correo y contraseña. */
export default function Entrada() {
  const { cargando, sesion, entrar } = useSesion()
  const tema = useTema()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (cargando) {
    return (
      <View style={[estilos.centro, { backgroundColor: tema.color.superficie.base }]}>
        <Texto tono="atenuado">Cargando…</Texto>
      </View>
    )
  }

  // Al menu, no a una pantalla concreta: cuando habia una sola tenia
  // sentido; con varias, mandar siempre al chat esconde el resto.
  if (sesion?.tenantId) return <Redirect href="/(app)" />

  return (
    <View style={[estilos.centro, { backgroundColor: tema.color.superficie.base }]}>
      <Tarjeta style={estilos.tarjeta}>
        <Texto variante="titulo">Entrar a REGB ERP</Texto>
        <Campo
          etiqueta="Correo"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Campo etiqueta="Contraseña" value={password} onChangeText={setPassword} secureTextEntry />
        {error && <Texto tono="peligro">{error}</Texto>}
        <Boton
          etiqueta="Entrar"
          cargando={enviando}
          onPress={async () => {
            setEnviando(true)
            setError(await entrar(email, password))
            setEnviando(false)
          }}
        />
      </Tarjeta>
    </View>
  )
}

const estilos = StyleSheet.create({
  centro: { flex: 1, justifyContent: 'center', padding: 20 },
  tarjeta: { gap: 12 },
})

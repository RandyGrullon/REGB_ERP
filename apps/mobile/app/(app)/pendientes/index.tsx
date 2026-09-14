import { ScrollView, View, StyleSheet } from 'react-native'
import { Boton, EstadoVacio, Insignia, Texto, useTema } from '@regb/ui-native'
import { useCola } from '../../../src/cola'

/**
 * Lo que se hizo en el telefono y todavia no esta en el sistema.
 *
 * ── Por que esta pantalla existe ──────────────────────────────────────
 *
 * Porque una cola que trabaja sola y no se puede mirar es una caja
 * negra, y la gente no confia en una caja negra con su trabajo dentro.
 * Quien conto un pasillo sin señal necesita poder abrir esto y ver su
 * conteo ahi, esperando. Si no puede verlo, lo vuelve a contar —o lo
 * apunta en un papel, que es lo que el ERP venia a quitar—.
 *
 * ── Dos listas, porque son dos problemas distintos ────────────────────
 *
 * Lo que espera se arregla solo en cuanto haya linea; no hay nada que
 * hacer y decirlo asi evita que alguien intente "arreglarlo".
 *
 * Lo que esta trabado NO se arregla solo, y mezclarlo con lo otro es
 * como se queda un gasto sin reembolsar tres semanas. El caso tipico:
 * una transferencia que se encolo cuando habia stock y sube tres horas
 * despues, cuando ya no lo hay. La mercancia SI se movio —alguien la
 * cargo— pero el sistema no la puede registrar sin descuadrar el kardex.
 * Eso lo resuelve una persona, no un reintento.
 *
 * Por eso lo trabado enseña el mensaje de la base tal cual: es lo unico
 * que le dice a quien mira QUE fue lo que paso.
 */
export default function Pendientes() {
  const tema = useTema()
  const { cola, sincronizar, subiendo } = useCola()

  const esperando = cola.acciones.filter((a) => a.bloqueada === undefined)
  const trabadas = cola.acciones.filter((a) => a.bloqueada !== undefined)

  if (cola.acciones.length === 0) {
    return (
      <EstadoVacio
        titulo="Todo subido"
        descripcion="No queda nada esperando. Lo que hagas sin señal aparece aqui hasta que el telefono consiga subirlo."
      />
    )
  }

  return (
    <ScrollView style={{ backgroundColor: tema.color.superficie.base }}>
      {trabadas.length > 0 && (
        <View style={estilos.seccion}>
          <Texto variante="seccion">No se pudieron guardar</Texto>
          <Texto variante="pie" tono="atenuado">
            Esto no se arregla solo. Avisa a quien lleva el inventario: lo que hiciste ocurrio de
            verdad y hay que registrarlo a mano.
          </Texto>
          {trabadas.map((a) => (
            <View key={a.ref} style={[estilos.tarjeta, { borderColor: tema.color.borde.normal }]}>
              <View style={estilos.linea}>
                <Texto variante="cuerpo" style={estilos.crece}>
                  {a.resumen}
                </Texto>
                <Insignia tono="peligro">Trabado</Insignia>
              </View>
              <Texto variante="pie" tono="atenuado">
                {fecha(a.creadaEn)}
              </Texto>
              {/* El mensaje de la base, tal cual: lo escribe en español y
                  para el usuario. Traducirlo aqui seria adivinar. */}
              <Texto variante="pie" tono="peligro">
                {a.bloqueada}
              </Texto>
            </View>
          ))}
        </View>
      )}

      {esperando.length > 0 && (
        <View style={estilos.seccion}>
          <Texto variante="seccion">Esperando señal</Texto>
          <Texto variante="pie" tono="atenuado">
            Sube solo en cuanto haya linea. No hace falta que hagas nada.
          </Texto>
          {esperando.map((a) => (
            <View key={a.ref} style={[estilos.tarjeta, { borderColor: tema.color.borde.normal }]}>
              <View style={estilos.linea}>
                <Texto variante="cuerpo" style={estilos.crece}>
                  {a.resumen}
                </Texto>
                <Insignia tono="alerta">Sin subir</Insignia>
              </View>
              <Texto variante="pie" tono="atenuado">
                {fecha(a.creadaEn)}
                {a.intentos > 1 ? ` · ${a.intentos} intentos` : ''}
              </Texto>
            </View>
          ))}
        </View>
      )}

      <View style={estilos.seccion}>
        <Boton
          variante="secundario"
          etiqueta="Intentar ahora"
          cargando={subiendo}
          onPress={() => void sincronizar()}
        />
      </View>
    </ScrollView>
  )
}

/** La hora del bolsillo: dia y hora, sin segundos ni zona. */
function fecha(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-DO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const estilos = StyleSheet.create({
  seccion: { padding: 12, gap: 8 },
  tarjeta: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crece: { flex: 1 },
})

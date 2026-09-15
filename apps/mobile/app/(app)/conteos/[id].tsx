import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, View, StyleSheet } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import {
  MENSAJE_PROBLEMA,
  avanceDelConteo,
  leerCantidad,
  ordenarParaContar,
  type LineaConteo,
} from '@regb/operations'
import { Boton, Campo, EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'
import { useCola } from '../../../src/cola'

/**
 * Contar, linea por linea.
 *
 * ── EL QUE CUENTA NO VE EL SISTEMA ────────────────────────────────────
 *
 * `system_qty` NO se pide en la consulta. No se pide y se oculta al
 * pintar: no se pide. Si en la pantalla dijera "deberia haber 40", el
 * que cuenta escribe 40 -no por deshonestidad, sino porque contar 43
 * tornillos es incomodo y el numero da permiso para no terminar-. Un
 * conteo que confirma lo que ya se sabia no encuentra nada, y entonces
 * cerrar el pasillo y pagar las horas no sirvio de nada.
 *
 * Un campo que no viaja no se puede filtrar por accidente en un
 * rediseño ni leerse en el trafico.
 *
 * ── Se guarda linea por linea ─────────────────────────────────────────
 *
 * Y no al final con un boton "guardar todo". En un almacen se pierde la
 * señal, se apaga el telefono y suena el jefe: cualquier cosa que
 * dependa de llegar al final pierde una hora de trabajo. Cada linea que
 * se confirma ya esta a salvo.
 *
 * ── "A salvo" tambien sin señal ───────────────────────────────────────
 *
 * Antes, cada linea era un PATCH y sin linea no se guardaba: la pantalla
 * decia "revisa la señal y vuelve a intentar" y quien contaba tenia que
 * quedarse ahi parado, o apuntar en un papel. En un pasillo de un
 * deposito eso es la mitad del tiempo.
 *
 * Ahora va por la cola (`src/cola.tsx`) y se marca contada igual. Contar
 * es una ASIGNACION y no un hecho: si se recuenta la misma linea sin
 * señal, la cola sustituye lo que habia en vez de acumular dos numeros
 * que se van a pisar al subir.
 *
 * Escribe con `public.contar()` (0115) y no con un UPDATE, que es la
 * unica puerta desde que se descubrio que nadie comprobaba que el conteo
 * siguiera abierto.
 */
interface LineaCruda {
  id: string
  counted_qty: string | null
  products: { sku: string; name: string; unit: string } | null
}

export default function Contar() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const tema = useTema()
  const [lineas, setLineas] = useState<LineaConteo[]>([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const { enviar, indicador } = useCola()

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('stock_count_lines')
      // Sin `system_qty`. Ver el comentario de arriba: es la regla que
      // hace que el conteo sirva para algo.
      .select('id, counted_qty, products(sku, name, unit)')
      .eq('count_id', id)

    setLineas(
      ((data as LineaCruda[] | null) ?? [])
        .filter((l) => l.products !== null)
        .map((l) => ({
          id: l.id,
          sku: l.products!.sku,
          nombre: l.products!.name,
          unidad: l.products!.unit,
          contado: l.counted_qty === null ? null : Number(l.counted_qty),
        })),
    )
    setCargando(false)
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const ordenadas = useMemo(() => ordenarParaContar(lineas), [lineas])
  const avance = useMemo(() => avanceDelConteo(lineas), [lineas])

  async function guardar(lineaId: string) {
    const r = leerCantidad(texto)
    if (!r.ok) {
      setError(MENSAJE_PROBLEMA[r.problema])
      return
    }
    const linea = lineas.find((l) => l.id === lineaId)
    setGuardando(true)
    const res = await enviar(
      'contar',
      { p_linea: lineaId, p_cantidad: r.valor },
      `${linea?.nombre ?? 'Linea'}: ${r.valor} ${linea?.unidad ?? ''}`.trim(),
      `contar:${lineaId}`,
    )
    setGuardando(false)

    if (res.estado === 'rechazado') {
      // La base contesto que no -el conteo se cerro, falta el permiso-.
      // La linea NO se marca como contada: decir "guardado" cuando no se
      // guardo es como se pierde un conteo entero sin que nadie se
      // entere hasta cerrarlo. El mensaje de 0115 ya viene en español y
      // dice que hacer.
      setError(res.mensaje)
      return
    }

    // Encolado cuenta como contado, y es la diferencia entre poder
    // trabajar en un pasillo sin señal y no poder. La linea se marca, el
    // avance sube, y si algo no se pudo guardar de verdad aparece en
    // pendientes -que es donde se mira, no aqui, para no interrumpir a
    // quien lleva el ritmo de un estante-.
    setLineas((prev) => prev.map((l) => (l.id === lineaId ? { ...l, contado: r.valor } : l)))
    setEditando(null)
    setTexto('')
    setError(null)
  }

  if (!cargando && lineas.length === 0) {
    return (
      <EstadoVacio
        titulo="Este conteo no tiene productos"
        descripcion="Se arma desde la computadora eligiendo que contar."
      />
    )
  }

  return (
    <View style={[estilos.pantalla, { backgroundColor: tema.color.superficie.base }]}>
      {/*
        El avance arriba y siempre visible: contar es largo y aburrido, y
        saber cuanto falta es lo unico que sostiene a quien lo hace.
      */}
      <View style={estilos.cabecera}>
        <Texto variante="cuerpoSm">{avance.texto}</Texto>
        {/*
          Lo que falta por subir, aqui mismo. Quien cuenta un pasillo
          entero sin señal necesita ver que su trabajo esta guardado en
          algun sitio; si no lo ve, lo apunta en un papel por si acaso, y
          ese papel es lo que veniamos a quitar.
        */}
        {indicador.texto !== null && (
          <Texto variante="pie" tono={indicador.tono === 'peligro' ? 'peligro' : 'alerta'}>
            {indicador.bloqueadas > 0
              ? `${indicador.texto}. Miralo en Sin subir.`
              : `${indicador.texto}. Se guardo en el telefono y sube solo.`}
          </Texto>
        )}
        <View style={[estilos.barra, { backgroundColor: tema.color.superficie.elevada }]}>
          <View
            style={[
              estilos.relleno,
              {
                backgroundColor: tema.color.marca.base,
                width: `${Math.round(avance.fraccion * 100)}%`,
              },
            ]}
          />
        </View>
      </View>

      <FlatList
        data={ordenadas}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => {
          const abierta = editando === item.id
          return (
            <Fila
              // El prop se OMITE cuando la fila ya esta abierta, en vez
              // de pasar undefined: con `exactOptionalPropertyTypes` no
              // es lo mismo "no lo mando" que "lo mando vacio".
              {...(abierta
                ? {}
                : {
                    onPress: () => {
                      setEditando(item.id)
                      // Se abre VACIO aunque ya estuviera contado:
                      // enseñar lo de la vuelta anterior es el mismo
                      // problema que enseñar el sistema, en pequeño.
                      setTexto('')
                      setError(null)
                    },
                  })}
            >
              <View style={estilos.linea}>
                <Texto variante="cuerpo" style={estilos.nombre}>
                  {item.nombre}
                </Texto>
                {item.contado !== null && <Insignia tono="exito">Contado</Insignia>}
              </View>
              <Texto variante="pie" tono="atenuado">
                {item.sku} · se cuenta en {item.unidad}
              </Texto>

              {abierta && (
                <View style={estilos.editor}>
                  <Campo
                    etiqueta={`¿Cuantos hay? (${item.unidad})`}
                    value={texto}
                    onChangeText={(t) => {
                      setTexto(t)
                      setError(null)
                    }}
                    keyboardType="decimal-pad"
                    autoFocus
                  />
                  {error !== null && <Texto tono="peligro">{error}</Texto>}
                  <View style={estilos.botones}>
                    <Boton
                      etiqueta="Confirmar"
                      onPress={() => void guardar(item.id)}
                      cargando={guardando}
                    />
                    <Boton
                      variante="secundario"
                      etiqueta="Cancelar"
                      onPress={() => {
                        setEditando(null)
                        setError(null)
                      }}
                    />
                  </View>
                </View>
              )}
            </Fila>
          )
        }}
      />
    </View>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  cabecera: { padding: 12, gap: 6 },
  barra: { height: 6, borderRadius: 3, overflow: 'hidden' },
  relleno: { height: 6 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre: { flex: 1 },
  editor: { marginTop: 8, gap: 8 },
  botones: { flexDirection: 'row', gap: 8 },
})

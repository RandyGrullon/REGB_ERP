import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, View, StyleSheet } from 'react-native'
import {
  MENSAJE_PROBLEMA,
  agruparPorProducto,
  filtrarExistencias,
  leerCantidad,
  textoSemaforo,
  type ExistenciaMovil,
} from '@regb/operations'
import { Boton, Campo, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'
import { useCola } from '../../../src/cola'

/**
 * Mover mercancia entre almacenes, desde el almacen.
 *
 * ── Todo pasa por `public.transferir()` ───────────────────────────────
 *
 * Una transferencia son CUATRO escrituras que tienen que ocurrir juntas:
 * la cabecera, la linea y los dos movimientos de kardex. Por PostgREST
 * cada peticion es su propia transaccion, asi que hacerlas por separado
 * significa que si se cae la señal —en un almacen, que es donde peor se
 * cae— la mercancia SALE de un sitio y no LLEGA al otro. Y el kardex es
 * inmutable: arreglarlo es registrar movimientos contrarios a mano.
 *
 * La funcion es una sola transaccion, y ademas comprueba el permiso y
 * que los tres ids sean de este cliente. Ver la migracion 0111.
 *
 * ── Lo que la pantalla NO hace ────────────────────────────────────────
 *
 * No deja escribir un almacen ni un producto "a mano": los dos se eligen
 * de lo que la base devolvio. Es lo que evita una transferencia a un
 * almacen que no existe por un dedo mal puesto, con el telefono en una
 * mano y una caja en la otra.
 *
 * ── Sin señal la transferencia NO se pierde ───────────────────────────
 *
 * Un deposito es justo donde peor entra la señal, y quien mueve la
 * mercancia ya la movio: el pallet esta en el otro almacen aunque el
 * telefono no haya podido decirlo. Por eso se manda por la cola
 * (`src/cola.tsx`): si la base no contesta, queda guardada en el
 * telefono y sube sola. La idempotencia de 0114 es lo que hace que ese
 * reintento no mueva la mercancia dos veces.
 */
interface Almacen {
  id: string
  name: string
}

interface FilaCruda {
  product_id: string
  qty_on_hand: string
  qty_reserved: string
  products: { sku: string; name: string; barcode: string | null } | null
  warehouses: { id: string; name: string } | null
}

export default function Transferir() {
  const tema = useTema()
  const [almacenes, setAlmacenes] = useState<Almacen[]>([])
  const [filas, setFilas] = useState<ExistenciaMovil[]>([])
  const [origen, setOrigen] = useState<Almacen | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [elegido, setElegido] = useState<{ id: string; nombre: string; disponible: number } | null>(
    null,
  )
  const [cantidad, setCantidad] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Un aviso de "quedo en el telefono" NO es el mismo que "se movio": el
  // primero deja algo pendiente y el segundo no. Pintarlos los dos en
  // verde de exito es como alguien se va del almacen creyendo que ya
  // subio.
  const [aviso, setAviso] = useState<{ texto: string; tono: 'exito' | 'alerta' } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const { enviar: enviarPorCola } = useCola()

  const cargar = useCallback(async () => {
    const [w, s] = await Promise.all([
      supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('stock_levels')
        // Sin `avg_cost`: desde 0109 esa columna no la lee `authenticated`,
        // y para mover mercancia el costo no hace falta.
        .select(
          'product_id, qty_on_hand, qty_reserved, products(sku, name, barcode), warehouses(id, name)',
        )
        .limit(2000),
    ])
    setAlmacenes((w.data as Almacen[] | null) ?? [])
    setFilas(
      ((s.data as FilaCruda[] | null) ?? [])
        .filter((r) => r.products !== null && r.warehouses !== null)
        .map((r) => ({
          productId: r.product_id,
          sku: r.products!.sku,
          nombre: r.products!.name,
          barcode: r.products!.barcode,
          almacen: r.warehouses!.name,
          almacenId: r.warehouses!.id,
          cantidad: Number(r.qty_on_hand),
          reservado: Number(r.qty_reserved),
          precio: null,
        })),
    )
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Solo lo que hay EN EL ORIGEN: ofrecer lo que esta en otro almacen es
  // prometer algo que la funcion va a rechazar.
  const disponibles = useMemo(() => {
    if (origen === null) return []
    return agruparPorProducto(filtrarExistencias(filas.filter((f) => f.almacenId === origen.id), busqueda))
  }, [filas, origen, busqueda])

  async function enviar(destino: Almacen) {
    if (origen === null || elegido === null) return
    const q = leerCantidad(cantidad)
    if (!q.ok) {
      setError(MENSAJE_PROBLEMA[q.problema])
      return
    }
    if (q.valor > elegido.disponible) {
      setError(`Solo hay ${elegido.disponible} en ${origen.name}.`)
      return
    }

    setEnviando(true)
    const r = await enviarPorCola(
      'transferir',
      {
        p_origen: origen.id,
        p_destino: destino.id,
        p_producto: elegido.id,
        p_cantidad: q.valor,
      },
      `${q.valor} ${elegido.nombre} → ${destino.name}`,
    )
    setEnviando(false)

    if (r.estado === 'rechazado') {
      // El mensaje de la base se enseña tal cual: lo escribe 0111 en
      // español y para el usuario -"No hay suficiente en el almacen de
      // origen"-, no es un codigo que haya que traducir aqui.
      setError(r.mensaje)
      return
    }

    if (r.estado === 'encolado') {
      // Se dice que quedo guardada en el telefono, no que "se guardo":
      // quien mueve mercancia necesita saber que todavia falta subirla
      // para no extrañarse cuando el sistema no la enseñe.
      setAviso({
        texto: `Sin señal. Guardamos el movimiento de ${q.valor} ${elegido.nombre} en el telefono y sube solo.`,
        tono: 'alerta',
      })
      setElegido(null)
      setCantidad('')
      setError(null)
      return
    }

    setAviso({ texto: `Moviste ${q.valor} de ${elegido.nombre} a ${destino.name}.`, tono: 'exito' })
    setElegido(null)
    setCantidad('')
    setError(null)
    await cargar()
  }

  const fondo = { backgroundColor: tema.color.superficie.base }

  // ── Paso 1: de donde sale ──────────────────────────────────────────
  if (origen === null) {
    return (
      <ScrollView style={[estilos.pantalla, fondo]}>
        <View style={estilos.cabecera}>
          <Texto variante="seccion">¿De cual almacen sale?</Texto>
        </View>
        {almacenes.map((a) => (
          <Fila key={a.id} onPress={() => setOrigen(a)}>
            <Texto variante="cuerpo">{a.name}</Texto>
          </Fila>
        ))}
      </ScrollView>
    )
  }

  // ── Paso 2: que se mueve ───────────────────────────────────────────
  if (elegido === null) {
    return (
      <View style={[estilos.pantalla, fondo]}>
        <View style={estilos.cabecera}>
          <Texto variante="pie" tono="atenuado">
            Sale de {origen.name}
          </Texto>
          {aviso !== null && <Texto tono={aviso.tono}>{aviso.texto}</Texto>}
          <Campo
            etiqueta="Buscar"
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Nombre, codigo o escanear"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Boton variante="fantasma" etiqueta="Cambiar de almacen" onPress={() => setOrigen(null)} />
        </View>
        <ScrollView>
          {disponibles.map((p) => (
            <Fila
              key={p.productId}
              onPress={() => {
                setElegido({ id: p.productId, nombre: p.nombre, disponible: p.disponible })
                setAviso(null)
                setError(null)
              }}
            >
              <View style={estilos.linea}>
                <Texto variante="cuerpo" style={estilos.nombre}>
                  {p.nombre}
                </Texto>
                <Insignia tono={p.disponible > 0 ? 'exito' : 'peligro'}>
                  {textoSemaforo(p.disponible)}
                </Insignia>
              </View>
              <Texto variante="pie" tono="atenuado">
                {p.sku}
              </Texto>
            </Fila>
          ))}
        </ScrollView>
      </View>
    )
  }

  // ── Paso 3: cuanto y a donde ───────────────────────────────────────
  return (
    <ScrollView style={[estilos.pantalla, fondo]}>
      <View style={estilos.cabecera}>
        <Texto variante="seccion">{elegido.nombre}</Texto>
        <Texto variante="pie" tono="atenuado">
          Hay {elegido.disponible} en {origen.name}
        </Texto>
        <Campo
          etiqueta="¿Cuantos mueves?"
          value={cantidad}
          onChangeText={(t) => {
            setCantidad(t)
            setError(null)
          }}
          keyboardType="decimal-pad"
          autoFocus
        />
        {error !== null && <Texto tono="peligro">{error}</Texto>}
        <Texto variante="etiqueta" tono="atenuado">
          ¿A cual almacen?
        </Texto>
      </View>

      {almacenes
        .filter((a) => a.id !== origen.id)
        .map((a) => (
          // Se OMITE el prop mientras se envia, en vez de pasar undefined:
          // con `exactOptionalPropertyTypes` no es lo mismo. Y asi la
          // fila deja de responder y no se manda dos veces la misma
          // transferencia por un doble toque.
          <Fila key={a.id} {...(enviando ? {} : { onPress: () => void enviar(a) })}>
            <Texto variante="cuerpo">{a.name}</Texto>
          </Fila>
        ))}

      <View style={estilos.cabecera}>
        <Boton
          variante="secundario"
          etiqueta="Cancelar"
          onPress={() => {
            setElegido(null)
            setCantidad('')
            setError(null)
          }}
        />
      </View>
    </ScrollView>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  cabecera: { padding: 12, gap: 8 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre: { flex: 1 },
})

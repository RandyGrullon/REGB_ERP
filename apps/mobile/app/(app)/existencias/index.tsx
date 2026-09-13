import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, RefreshControl, View, StyleSheet } from 'react-native'
import {
  agruparPorProducto,
  filtrarExistencias,
  semaforo,
  textoSemaforo,
  type ExistenciaMovil,
} from '@regb/operations'
import { Campo, EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'

/**
 * Existencias en el telefono.
 *
 * Es la pantalla que justifica el ERP delante de un cliente: el vendedor
 * con una caja en la mano y alguien preguntando "¿tienes de este?", y la
 * respuesta en cinco segundos sin ir al almacen ni llamar a nadie.
 *
 * ── Lo que NO hace ────────────────────────────────────────────────────
 *
 * No ajusta, no transfiere y no vende. Solo consulta. Es lo que el
 * manifest de `inventory` declara en `mobileScope`, y ampliarlo por las
 * buenas convertiria el telefono en una via para mover inventario sin
 * las comprobaciones que tiene la web.
 *
 * No filtra por tenant a mano: RLS lo hace con los claims del token.
 *
 * ── El costo NO viaja ─────────────────────────────────────────────────
 *
 * Se pide precio, no costo. El costo esta detras de un permiso aparte
 * (`inventory.cost.view`) y el telefono suele andar en manos del
 * vendedor, que es justo quien no debe verlo. Que la consulta ni lo pida
 * es mas seguro que pedirlo y ocultarlo al pintar.
 */
interface FilaCruda {
  product_id: string
  qty_on_hand: string
  qty_reserved: string
  products: { sku: string; name: string; barcode: string | null; price: string | null } | null
  warehouses: { name: string } | null
}

export default function Existencias() {
  const tema = useTema()
  const [filas, setFilas] = useState<ExistenciaMovil[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('stock_levels')
      .select('product_id, qty_on_hand, qty_reserved, products(sku, name, barcode, price), warehouses(name)')
      .limit(2000)

    setFilas(
      ((data as FilaCruda[] | null) ?? [])
        // Una fila sin producto no se pinta: seria una linea en blanco
        // que el vendedor no sabe interpretar.
        .filter((r) => r.products !== null)
        .map((r) => ({
          productId: r.product_id,
          sku: r.products!.sku,
          nombre: r.products!.name,
          barcode: r.products!.barcode,
          almacen: r.warehouses?.name ?? 'Sin almacen',
          cantidad: Number(r.qty_on_hand),
          reservado: Number(r.qty_reserved),
          precio: r.products!.price === null ? null : Number(r.products!.price),
        })),
    )
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // El filtro corre en el telefono y no en el servidor a proposito: el
  // vendedor escribe letra a letra y una peticion por tecla, en la red
  // de un local, se siente mas lenta que cargar todo una vez.
  const resultados = useMemo(
    () => agruparPorProducto(filtrarExistencias(filas, busqueda)),
    [filas, busqueda],
  )

  const moneda = (n: number) =>
    `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <View style={[estilos.pantalla, { backgroundColor: tema.color.superficie.base }]}>
      <View style={estilos.buscador}>
        <Campo
          etiqueta="Buscar"
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Nombre, codigo o escanear"
          autoCapitalize="none"
          autoCorrect={false}
          // Numerico no: el SKU y el nombre llevan letras. Un lector
          // bluetooth teclea igual con cualquier teclado.
        />
      </View>

      {!cargando && resultados.length === 0 ? (
        <EstadoVacio
          titulo={busqueda === '' ? 'Sin existencias todavia' : 'Nada con eso'}
          descripcion={
            busqueda === ''
              ? 'Cuando entre mercancia al almacen aparece aqui.'
              : 'Prueba con otra parte del nombre, o con el codigo completo.'
          }
        />
      ) : (
        <FlatList
          data={resultados}
          keyExtractor={(r) => r.productId}
          refreshControl={<RefreshControl refreshing={cargando} onRefresh={() => void cargar()} />}
          renderItem={({ item }) => {
            const s = semaforo(item.disponible)
            return (
              <Fila>
                <View style={estilos.linea}>
                  <Texto variante="cuerpo" style={estilos.nombre}>
                    {item.nombre}
                  </Texto>
                  {/*
                    El estado lleva texto y no solo color: al sol, en la
                    puerta de un local, el color es lo primero que se
                    pierde. Es ley de Aurora y aqui se nota de verdad.
                  */}
                  <Insignia tono={s === 'nada' ? 'peligro' : s === 'poco' ? 'alerta' : 'exito'}>
                    {textoSemaforo(item.disponible)}
                  </Insignia>
                </View>

                <Texto variante="pie" tono="atenuado">
                  {item.sku}
                  {item.precio !== null ? ` · ${moneda(item.precio)}` : ''}
                </Texto>

                {/*
                  Los almacenes se enseñan siempre que haya mas de uno:
                  saber que hay 4 no sirve si estan en la otra sucursal.
                */}
                {item.porAlmacen.length > 1 && (
                  <Texto variante="pie" tono="secundario">
                    {item.porAlmacen
                      .map((a) => `${a.almacen}: ${a.disponible}`)
                      .join('  ·  ')}
                  </Texto>
                )}
              </Fila>
            )
          }}
        />
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1 },
  buscador: { padding: 12 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre: { flex: 1 },
})

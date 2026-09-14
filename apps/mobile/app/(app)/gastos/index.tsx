import { useCallback, useEffect, useState } from 'react'
import { FlatList, RefreshControl, ScrollView, View, StyleSheet } from 'react-native'
import { Boton, Campo, EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'
import { useCola } from '../../../src/cola'

/**
 * Reportar un gasto en el momento en que ocurre.
 *
 * ── Por que en el momento ─────────────────────────────────────────────
 *
 * Un gasto con NCF de credito fiscal entra en la 606 del mes. Reunir los
 * papeles el dia 18 para declarar el 20 es como se pierden deducciones y
 * como se pasan fechas. El telefono esta en el bolsillo cuando dan el
 * comprobante; la computadora, no.
 *
 * ── Lo que no decide el telefono ──────────────────────────────────────
 *
 * QUIEN reporta. Lo pone `public.reportar_gasto()` (0113) desde el
 * token. Si viajara desde aqui, esto seria un formulario para cobrarle a
 * la empresa a nombre de otro.
 *
 * El RNC tambien se limpia en la base: si cada telefono lo guarda a su
 * manera, la 606 sale con el mismo proveedor repetido en dos formatos.
 *
 * ── Lo que todavia NO hace ────────────────────────────────────────────
 *
 * Adjuntar la foto del comprobante. Hace falta una dependencia nativa
 * (camara) que cambia como se compila la app, y eso no se agrega de
 * paso. Sin comprobante el gasto NO es deducible, asi que la pantalla lo
 * dice en vez de dejar creer que con reportarlo basta.
 */
interface Gasto {
  id: string
  category: string
  expense_date: string
  amount: string
  vendor_name: string | null
  ncf: string | null
  status: string
  decision_note: string | null
}

const CATEGORIAS: { id: string; texto: string }[] = [
  { id: 'transport', texto: 'Transporte' },
  { id: 'meals', texto: 'Comida' },
  { id: 'lodging', texto: 'Hospedaje' },
  { id: 'travel', texto: 'Viaje' },
  { id: 'supplies', texto: 'Materiales' },
  { id: 'other', texto: 'Otro' },
]

const ESTADO: Record<string, { texto: string; tono: 'exito' | 'alerta' | 'peligro' | 'info' }> = {
  submitted: { texto: 'Esperando', tono: 'alerta' },
  approved: { texto: 'Aprobado', tono: 'info' },
  rejected: { texto: 'Rechazado', tono: 'peligro' },
  reimbursed: { texto: 'Reembolsado', tono: 'exito' },
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const corta = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1] ?? ''}`
}
const HOY = () => new Date().toISOString().slice(0, 10)
const moneda = (n: number) =>
  `RD$ ${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Gastos() {
  const tema = useTema()
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [cargando, setCargando] = useState(true)
  const [reportando, setReportando] = useState(false)
  const [categoria, setCategoria] = useState('transport')
  const [fecha, setFecha] = useState(HOY())
  const [monto, setMonto] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [rnc, setRnc] = useState('')
  const [ncf, setNcf] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const { enviar: enviarPorCola } = useCola()

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('expenses')
      .select('id, category, expense_date, amount, vendor_name, ncf, status, decision_note')
      .order('expense_date', { ascending: false })
      .limit(50)
    setGastos((data as Gasto[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function enviar() {
    const n = Number(monto.trim().replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      setError('Escribe cuanto gastaste. Solo numeros.')
      return
    }

    setEnviando(true)
    // Por la cola: el comprobante se da en la calle, que es justo donde
    // no hay señal, y ese es el momento en que hay que reportarlo -ver
    // la cabecera-. La idempotencia de 0114 evita que el reintento lo
    // reembolse dos veces y lo meta dos veces en la 606.
    const r = await enviarPorCola(
      'reportar_gasto',
      {
        p_categoria: categoria,
        p_fecha: fecha,
        p_monto: n,
        p_proveedor: proveedor,
        p_rnc: rnc,
        p_ncf: ncf,
        p_nota: null,
      },
      `Gasto de ${n} · ${proveedor.trim() === '' ? categoria : proveedor}`,
    )
    setEnviando(false)

    if (r.estado === 'rechazado') {
      setError(r.mensaje)
      return
    }

    if (r.estado === 'encolado') {
      setAviso('Sin señal. Lo guardamos en el telefono y sube solo. No lo reportes otra vez.')
    }

    setReportando(false)
    setMonto('')
    setProveedor('')
    setRnc('')
    setNcf('')
    setError(null)
    await cargar()
  }

  const fondo = { backgroundColor: tema.color.superficie.base }

  if (reportando) {
    return (
      <ScrollView style={[estilos.pantalla, fondo]}>
        <View style={estilos.formulario}>
          <Texto variante="etiqueta" tono="atenuado">
            ¿De que fue?
          </Texto>
          <View style={estilos.categorias}>
            {CATEGORIAS.map((c) => (
              <Boton
                key={c.id}
                variante={categoria === c.id ? 'primario' : 'secundario'}
                etiqueta={c.texto}
                onPress={() => setCategoria(c.id)}
              />
            ))}
          </View>

          <Campo
            etiqueta="¿Cuanto?"
            value={monto}
            onChangeText={(t) => {
              setMonto(t)
              setError(null)
            }}
            keyboardType="decimal-pad"
            placeholder="850.00"
          />
          <Campo etiqueta="Fecha" value={fecha} onChangeText={setFecha} placeholder="2026-09-13" />
          <Campo etiqueta="¿A quien le pagaste?" value={proveedor} onChangeText={setProveedor} />
          <Campo
            etiqueta="RNC del proveedor"
            value={rnc}
            onChangeText={setRnc}
            keyboardType="number-pad"
            placeholder="131223345"
          />
          <Campo
            etiqueta="NCF del comprobante"
            value={ncf}
            onChangeText={setNcf}
            autoCapitalize="characters"
            placeholder="E310000000001"
          />

          {/*
            Se dice aqui y no en una ayuda escondida: sin comprobante el
            gasto se reembolsa pero NO deduce, y esa diferencia la paga
            la empresa sin enterarse.
          */}
          <Texto variante="pie" tono="secundario">
            Si el comprobante trae RNC y NCF, el gasto deduce en la 606. Sin eso se te reembolsa
            igual, pero la empresa no lo puede deducir.
          </Texto>

          {error !== null && <Texto tono="peligro">{error}</Texto>}

          <View style={estilos.botones}>
            <Boton etiqueta="Reportar" onPress={() => void enviar()} cargando={enviando} />
            <Boton
              variante="secundario"
              etiqueta="Cancelar"
              onPress={() => {
                setReportando(false)
                setError(null)
              }}
            />
          </View>
        </View>
      </ScrollView>
    )
  }

  return (
    <View style={[estilos.pantalla, fondo]}>
      <View style={estilos.formulario}>
        <Boton etiqueta="Reportar un gasto" onPress={() => setReportando(true)} />
        {/* Un gasto encolado NO sale en la lista de abajo -todavia no
            existe en la base-. Sin este aviso, quien lo reporto ve la
            lista igual que antes y lo reporta otra vez. */}
        {aviso !== null && <Texto tono="alerta">{aviso}</Texto>}
      </View>

      {!cargando && gastos.length === 0 ? (
        <EstadoVacio
          titulo="Todavia no has reportado nada"
          descripcion="Reporta el gasto cuando te den el comprobante, no al final del mes."
        />
      ) : (
        <FlatList
          data={gastos}
          keyExtractor={(g) => g.id}
          refreshControl={<RefreshControl refreshing={cargando} onRefresh={() => void cargar()} />}
          renderItem={({ item }) => {
            const e = ESTADO[item.status] ?? { texto: item.status, tono: 'info' as const }
            const cat = CATEGORIAS.find((c) => c.id === item.category)?.texto ?? item.category
            return (
              <Fila>
                <View style={estilos.linea}>
                  <Texto variante="cuerpo" style={estilos.crece}>
                    {moneda(Number(item.amount))}
                  </Texto>
                  <Insignia tono={e.tono}>{e.texto}</Insignia>
                </View>
                <Texto variante="pie" tono="atenuado">
                  {corta(item.expense_date)} · {cat}
                  {item.vendor_name !== null ? ` · ${item.vendor_name}` : ''}
                  {item.ncf !== null ? ' · con NCF' : ' · sin NCF'}
                </Texto>
                {item.decision_note !== null && item.decision_note !== '' && (
                  <Texto variante="pie" tono="secundario">
                    {item.decision_note}
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
  formulario: { padding: 12, gap: 10 },
  categorias: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  botones: { flexDirection: 'row', gap: 8 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crece: { flex: 1 },
})

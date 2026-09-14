import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, RefreshControl, View, StyleSheet } from 'react-native'
import { diasLaborablesEntre } from '@regb/operations'
import { Boton, Campo, EstadoVacio, Fila, Insignia, Texto, useTema } from '@regb/ui-native'
import { supabase } from '../../../src/supabase'
import { useCola } from '../../../src/cola'

/**
 * Pedir vacaciones y ver en que va lo pedido.
 *
 * ── Lo que NO decide el telefono ──────────────────────────────────────
 *
 * Ni QUIEN pide ni CUANTOS DIAS son. Los dos los pone
 * `public.pedir_vacaciones()` (0112): el empleado se resuelve del token
 * y los dias laborables se cuentan en la base.
 *
 * Si el `employee_id` viajara desde aqui, cualquiera pediria vacaciones
 * a nombre de otro. Si `business_days` viajara desde aqui, se pedirian
 * tres semanas declarando un dia y el saldo no bajaria.
 *
 * Los dias SI se calculan tambien aqui, pero solo para enseñarlos antes
 * de mandar -"son 5 dias laborables"-. Es informacion, no la cifra que
 * se guarda.
 */
interface Solicitud {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  business_days: number
  status: string
  decision_note: string | null
}

const ESTADO: Record<string, { texto: string; tono: 'exito' | 'alerta' | 'peligro' | 'info' }> = {
  pending: { texto: 'Esperando', tono: 'alerta' },
  approved: { texto: 'Aprobada', tono: 'exito' },
  rejected: { texto: 'Rechazada', tono: 'peligro' },
  cancelled: { texto: 'Cancelada', tono: 'info' },
}

const TIPO: Record<string, string> = {
  vacation: 'Vacaciones',
  sick: 'Enfermedad',
  personal: 'Personal',
  maternity: 'Maternidad',
  paternity: 'Paternidad',
  bereavement: 'Duelo',
  other: 'Otro',
}

/** `2026-10-05` -> `5 oct`. Sin librerias: es lo unico que hace falta. */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function corta(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1] ?? ''} ${a}`
}

const HOY = () => new Date().toISOString().slice(0, 10)

export default function Vacaciones() {
  const tema = useTema()
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [pidiendo, setPidiendo] = useState(false)
  const [inicio, setInicio] = useState(HOY())
  const [fin, setFin] = useState(HOY())
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const { enviar } = useCola()

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('time_off_requests')
      .select('id, leave_type, start_date, end_date, business_days, status, decision_note')
      .order('start_date', { ascending: false })
      .limit(50)
    setSolicitudes((data as Solicitud[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Solo para enseñar el numero antes de mandar. El que cuenta es el de
  // la base: ver la cabecera de este archivo.
  const dias = useMemo(() => {
    // Medianoche LOCAL y no UTC: `diasLaborablesEntre` lee getDate(), y
    // con una Z de por medio en UTC-4 el dia se corre uno hacia atras.
    const a = new Date(`${inicio}T00:00:00`)
    const b = new Date(`${fin}T00:00:00`)
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
    return diasLaborablesEntre(a, b)
  }, [inicio, fin])

  async function pedir() {
    if (dias === null) {
      setError('Escribe las fechas como 2026-10-05.')
      return
    }
    if (dias === 0) {
      setError('Ese rango no tiene ningun dia laborable.')
      return
    }

    setEnviando(true)
    const r = await enviar(
      'pedir_vacaciones',
      { p_inicio: inicio, p_fin: fin, p_tipo: 'vacation', p_motivo: motivo },
      `Vacaciones del ${inicio} al ${fin}`,
    )
    setEnviando(false)

    if (r.estado === 'rechazado') {
      // El mensaje de 0112 ya viene en español y para el usuario.
      setError(r.mensaje)
      return
    }

    if (r.estado === 'encolado') {
      // Importa decir "no la pidas otra vez": dos solicitudes iguales le
      // descuentan al empleado el doble de dias de su saldo.
      setAviso('Sin señal. La guardamos en el telefono y sube sola. No la pidas otra vez.')
    }

    setPidiendo(false)
    setMotivo('')
    setError(null)
    await cargar()
  }

  const fondo = { backgroundColor: tema.color.superficie.base }

  if (pidiendo) {
    return (
      <View style={[estilos.pantalla, fondo]}>
        <View style={estilos.formulario}>
          <Campo
            etiqueta="Desde"
            value={inicio}
            onChangeText={(t) => {
              setInicio(t)
              setError(null)
            }}
            placeholder="2026-10-05"
            autoCapitalize="none"
          />
          <Campo
            etiqueta="Hasta"
            value={fin}
            onChangeText={(t) => {
              setFin(t)
              setError(null)
            }}
            placeholder="2026-10-09"
            autoCapitalize="none"
          />
          <Campo etiqueta="Motivo (opcional)" value={motivo} onChangeText={setMotivo} />

          {/*
            El numero de dias ANTES de mandar. Es lo que evita pedir un
            fin de semana entero creyendo que cuentan.
          */}
          {dias !== null && (
            <Texto tono={dias === 0 ? 'peligro' : 'secundario'}>
              {dias === 0
                ? 'Ese rango no tiene dias laborables.'
                : `Son ${dias} ${dias === 1 ? 'dia laborable' : 'dias laborables'}.`}
            </Texto>
          )}
          {error !== null && <Texto tono="peligro">{error}</Texto>}

          <View style={estilos.botones}>
            <Boton etiqueta="Pedir" onPress={() => void pedir()} cargando={enviando} />
            <Boton
              variante="secundario"
              etiqueta="Cancelar"
              onPress={() => {
                setPidiendo(false)
                setError(null)
              }}
            />
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={[estilos.pantalla, fondo]}>
      <View style={estilos.formulario}>
        <Boton etiqueta="Pedir vacaciones" onPress={() => setPidiendo(true)} />
        {/* Una solicitud encolada no sale en la lista de abajo: todavia
            no existe en la base. Sin este aviso se pide otra vez. */}
        {aviso !== null && <Texto tono="alerta">{aviso}</Texto>}
      </View>

      {!cargando && solicitudes.length === 0 ? (
        <EstadoVacio
          titulo="Todavia no has pedido nada"
          descripcion="Cuando pidas vacaciones o un permiso, aqui ves en que va."
        />
      ) : (
        <FlatList
          data={solicitudes}
          keyExtractor={(s) => s.id}
          refreshControl={<RefreshControl refreshing={cargando} onRefresh={() => void cargar()} />}
          renderItem={({ item }) => {
            const e = ESTADO[item.status] ?? { texto: item.status, tono: 'info' as const }
            return (
              <Fila>
                <View style={estilos.linea}>
                  <Texto variante="cuerpo" style={estilos.crece}>
                    {corta(item.start_date)} — {corta(item.end_date)}
                  </Texto>
                  <Insignia tono={e.tono}>{e.texto}</Insignia>
                </View>
                <Texto variante="pie" tono="atenuado">
                  {TIPO[item.leave_type] ?? item.leave_type} · {item.business_days}{' '}
                  {item.business_days === 1 ? 'dia' : 'dias'}
                </Texto>
                {/*
                  El motivo del rechazo se enseña SIEMPRE que exista. Un
                  "rechazada" sin explicacion es lo que hace que la gente
                  vaya a preguntar en persona, y entonces la app no
                  ahorro nada.
                */}
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
  botones: { flexDirection: 'row', gap: 8 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crece: { flex: 1 },
})

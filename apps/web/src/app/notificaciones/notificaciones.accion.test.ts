import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { marcarLeida, marcarTodasLeidas } from './actions'

/**
 * marcarLeida() y marcarTodasLeidas() llamadas DE VERDAD (0125).
 *
 * En modo demostracion la accion corre como el usuario de la demo. Lo
 * que se fija es que lo que ESE usuario marca no se lo apaga a un
 * companero: `luis` es otra persona del mismo cliente, y se le pregunta
 * a la base con su propia sesion, igual que haria su campana.
 *
 * supabase/tests/notifications.test.ts cubre la base: privacidad de los
 * personales, aislamiento entre clientes y el evento.
 */

let c: ClientePrueba
let caja: string
let pedido: string
const luis = crypto.randomUUID()
const DEMO = '00000000-0000-0000-0000-000000000001'

async function aviso(titulo: string): Promise<string> {
  const [n] = await db()<{ id: string }[]>`
    insert into public.notifications (tenant_id, module_id, title, link)
    values (${c.tenantId}, 'pos', ${titulo}, '/pos/shifts') returning id`
  return n!.id
}

async function sinLeer(userId: string): Promise<number> {
  const [r] = await asUser(
    userId,
    c.tenantId,
    (tx) => tx<{ n: number }[]>`
    select public.avisos_sin_leer() as n`,
  )
  return r!.n
}

async function leidoPor(userId: string, id: string): Promise<boolean> {
  const filas = await asUser(
    userId,
    c.tenantId,
    (tx) => tx<{ read_at: Date | null }[]>`
    select read_at from public.mis_avisos(100) where id = ${id}`,
  )
  return (filas[0]?.read_at ?? null) !== null
}

function textoAviso(): string | null {
  const g = tarro.get(COOKIE_AVISO)
  return g ? (JSON.parse(g.value) as { texto: string }).texto : null
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-avisos',
    nombre: 'Distribuidora Avisos SRL',
    modulos: ['notifications'],
    roles: {
      Gerente: { 'notifications.*': true },
      Consulta: { 'notifications.view': true },
    },
  })
  caja = await aviso('Falto efectivo en el cierre de caja')
  pedido = await aviso('Hay un pedido entregado sin facturar')
})

afterAll(async () => {
  await c.limpiar()
  await cerrarBase()
})

describe('Marcar como leido es por persona', () => {
  it('al empezar, los dos tienen los dos avisos sin leer', async () => {
    expect(await sinLeer(DEMO)).toBe(2)
    expect(await sinLeer(luis)).toBe(2)
  })

  it('marcarLeida: queda leido para quien lo marco y NO para su companero', async () => {
    await marcarLeida(c.fd({ id: caja }))

    expect(await leidoPor(DEMO, caja)).toBe(true)
    expect(await sinLeer(DEMO)).toBe(1)

    expect(await leidoPor(luis, caja)).toBe(false)
    expect(await sinLeer(luis)).toBe(2)
  })

  it('la fila del aviso no cambia: lo leido vive en notification_reads', async () => {
    const [r] = await db()<{ n: string }[]>`
      select count(*)::text as n from public.notification_reads
      where tenant_id = ${c.tenantId} and notification_id = ${caja}`
    expect(Number(r!.n)).toBe(1)
  })

  it('marcarTodasLeidas: la campana de quien pulsa queda en cero, la de Luis no', async () => {
    tarro.delete(COOKIE_AVISO)
    await marcarTodasLeidas(c.fd())
    expect(textoAviso()).toBe('Listo, marcamos todas como leidas.')

    expect(await sinLeer(DEMO)).toBe(0)
    expect(await sinLeer(luis)).toBe(2)
    expect(await leidoPor(luis, pedido)).toBe(false)
  })

  it('Luis lee los suyos sin tocar lo que ya leyo el otro', async () => {
    await asUser(luis, c.tenantId, (tx) => tx`select public.marcar_aviso_leido(${pedido})`)
    expect(await sinLeer(luis)).toBe(1)
    expect(await sinLeer(DEMO)).toBe(0)
  })
})

describe('Permiso', () => {
  it('sin notifications.edit no marca nada, y lo dice', async () => {
    const nuevo = await aviso('Productos bajo el punto de reorden')
    tarro.delete(COOKIE_AVISO)

    await marcarLeida(c.fd({ id: nuevo }, 'Consulta'))

    expect(await leidoPor(DEMO, nuevo)).toBe(false)
    expect(textoAviso()).not.toBeNull()
  })

  it('un id que no es un aviso no revienta la accion', async () => {
    tarro.delete(COOKIE_AVISO)
    await marcarLeida(c.fd({ id: 'no-es-un-uuid' }))
    expect(textoAviso()).toBe('Ese aviso no existe.')
  })
})

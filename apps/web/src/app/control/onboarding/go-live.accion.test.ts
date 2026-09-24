import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase } from '@/test/arnes'

/**
 * 0139: un cliente que se carga ya operando (go_live_at puesto) entra al
 * tablero de onboarding en "En vivo", no en "Vendido". Antes el seed de la
 * demo -y cualquier cliente migrado de otro sistema- salia en REGB Control
 * como recien vendido aunque llevara meses facturando.
 */

const creados: string[] = []

async function tenant(goLive: boolean): Promise<string> {
  const slug = `accion-golive-${crypto.randomUUID().slice(0, 8)}`
  const [t] = await db()<{ id: string }[]>`
    insert into regb.tenants (slug, legal_name, tier, status, go_live_at)
    values (${slug}, 'Cliente Go Live SRL', 'pyme', 'active',
            ${goLive ? new Date(Date.now() - 90 * 86_400_000) : null})
    returning id`
  creados.push(t!.id)
  return t!.id
}

const etapa = async (id: string) =>
  (await db()<{ stage: string }[]>`select stage from regb.onboarding where tenant_id = ${id}`)[0]
    ?.stage

afterAll(async () => {
  for (const id of creados) {
    await db()`delete from audit.log where tenant_id = ${id}`
    await db()`delete from regb.tenants where id = ${id}`
  }
  await cerrarBase()
})

describe('etapa inicial del tablero', () => {
  it('un cliente que ya opera entra en "En vivo"', async () => {
    expect(await etapa(await tenant(true))).toBe('live')
  })

  it('uno recien vendido sigue entrando en "Vendido"', async () => {
    expect(await etapa(await tenant(false))).toBe('sold')
  })
})

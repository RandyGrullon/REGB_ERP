import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { enviarAPapelera, subirArchivo } from './actions'

/**
 * subirArchivo() llamada DE VERDAD: deja `files.file.uploaded` en el
 * outbox, en la misma transaccion que el archivo.
 *
 * El payload NO lleva el nombre: "cedula-maria-perez.pdf" es un dato
 * personal, y un evento viaja a webhooks de terceros. Quien lo necesite
 * lo lee por su id, bajo RLS.
 */

let c: ClientePrueba

async function eventos() {
  return db()<{ payload: Record<string, unknown>; emitted_by: string }[]>`
    select payload, emitted_by from public.event_outbox
    where tenant_id = ${c.tenantId} and type = 'files.file.uploaded'
    order by id`
}

function aviso(): { tipo: string; texto: string } | null {
  const g = tarro.get(COOKIE_AVISO)
  return g ? (JSON.parse(g.value) as { tipo: string; texto: string }) : null
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-arch',
    nombre: 'Eventos Archivos SRL',
    modulos: ['files'],
    roles: { Administrador: { 'files.*': true } },
  })
})

afterAll(async () => {
  await c.limpiar(['public.files'])
  await cerrarBase()
})

describe('subirArchivo emite files.file.uploaded', () => {
  it('un archivo subido deja un solo evento, con id, tipo y tamaño y sin nombre', async () => {
    const fd = c.fd()
    fd.set(
      'archivo',
      new File([new Uint8Array(2048).fill(7)], 'cedula-maria-perez.pdf', {
        type: 'application/pdf',
      }),
    )
    await subirArchivo(fd)
    expect(aviso()?.tipo).toBe('ok')

    const [f] = await db()<{ id: string }[]>`
      select id from public.files where tenant_id = ${c.tenantId}`
    expect(f).toBeDefined()

    const ev = await eventos()
    expect(ev).toHaveLength(1)
    expect(ev[0]!.emitted_by).toBe('files')
    expect(ev[0]!.payload).toEqual({ fileId: f!.id, mime: 'application/pdf', sizeBytes: 2048 })
    expect(JSON.stringify(ev[0]!.payload)).not.toContain('maria')
  })

  it('un archivo por encima del limite no se guarda ni emite', async () => {
    const fd = c.fd()
    fd.set('archivo', new File([new Uint8Array(600 * 1024)], 'grande.bin'))
    await subirArchivo(fd)
    expect(aviso()?.tipo).toBe('error')
    expect(await eventos()).toHaveLength(1)
  })

  it('mandarlo a la papelera no es una subida', async () => {
    const [f] = await db()<{ id: string }[]>`
      select id from public.files where tenant_id = ${c.tenantId}`
    await enviarAPapelera(c.fd({ id: f!.id }))
    expect(aviso()?.tipo).toBe('ok')
    expect(await eventos()).toHaveLength(1)
  })
})

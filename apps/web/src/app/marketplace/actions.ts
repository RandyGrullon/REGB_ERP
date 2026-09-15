'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Solicitud de activacion de modulos (§12.3).
 *
 * Activar NO es automatico y no debe serlo: hay que cotizar, cobrar la
 * instalacion y a veces migrar datos del sistema viejo. Lo que el cliente
 * hace aqui es PEDIR; lo que el proveedor hace es atender.
 *
 * Se guarda el precio que la pantalla le enseño al pedir. Si el catalogo
 * cambia entre la peticion y la llamada, nadie tiene que discutir de
 * memoria sobre lo que decia el simulador.
 */

export async function solicitarActivacion(fd: FormData): Promise<ActionResult> {
  const demo: DemoParams = {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
  const ctx = await actionCtx(demo)
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }

  let modulos: string[]
  try {
    const crudo: unknown = JSON.parse(String(fd.get('modulos') ?? '[]'))
    modulos = Array.isArray(crudo) ? crudo.filter((m): m is string => typeof m === 'string') : []
  } catch {
    return { ok: false, error: 'No se pudo leer la seleccion.' }
  }
  if (modulos.length === 0) return { ok: false, error: 'Elige al menos un modulo.' }

  const num = (k: string) => {
    const n = Number(String(fd.get(k) ?? '0'))
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  const nota =
    String(fd.get('nota') ?? '')
      .trim()
      .slice(0, 500) || null

  const res = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    // Los ids se contrastan contra el catalogo publicado: lo que manda el
    // navegador es una sugerencia, tambien aqui (§8.3). Sin esto, alguien
    // podria pedir un modulo que no existe o uno sin publicar.
    const validos = await tx<{ id: string }[]>`
      select id from regb.module_catalog
      where id = any(${modulos}) and is_published`
    if (validos.length === 0) return 'sin-modulos'

    const [ya] = await tx<{ id: string }[]>`
      select id from regb.activation_requests
      where tenant_id = ${ctx.tenantId} and status = 'pending'`
    // Pulsar dos veces el boton es lo normal cuando no pasa nada visible.
    // La segunda vez actualiza la peticion abierta en vez de abrir otra
    // conversacion con el mismo cliente.
    if (ya) {
      await tx`
        update regb.activation_requests
        set modules = ${validos.map((v) => v.id)},
            quoted_monthly = ${num('mensual')}, quoted_install = ${num('instalacion')},
            note = ${nota}, created_at = now()
        where id = ${ya.id}`
      return 'actualizada'
    }

    await tx`
      insert into regb.activation_requests
        (tenant_id, modules, quoted_monthly, quoted_install, note, requested_by)
      values (${ctx.tenantId}, ${validos.map((v) => v.id)},
              ${num('mensual')}, ${num('instalacion')}, ${nota}, ${ctx.userId})`
    return 'creada'
  })

  if (res === 'sin-modulos') {
    return { ok: false, error: 'Ninguno de esos modulos esta disponible todavia.' }
  }

  revalidatePath('/marketplace')
  return { ok: true }
}

export async function solicitarActivacionForm(fd: FormData): Promise<void> {
  // Texto a mano, y no el que deduce `anotarAviso` del nombre de la
  // accion. "solicitar" no esta en su tabla de verbos, asi que salia el
  // generico "Guardamos tu cambio" -y aqui eso es justo lo que confunde-.
  //
  // Lo que el usuario necesita oir es que su modulo NO quedo encendido:
  // pidio, y alguien va a llamar. Si el aviso dice "guardado" y despues
  // el modulo no aparece en el menu, parece que el sistema fallo.
  await anotarAviso(
    await solicitarActivacion(fd),
    'solicitarActivacion',
    'Recibimos tu pedido. Te llamamos para cotizar; todavia no se activo nada.',
  )
}

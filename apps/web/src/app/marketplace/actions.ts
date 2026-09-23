'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, type ActionResult, type DemoParams } from '@/lib/module-page'
import { cotizarConMotor } from '@/lib/marketplace'
import type { CotizacionMotor } from '@/lib/catalog'

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
 *
 * Ese precio lo calcula AQUI el motor de facturacion (`cotizarConMotor`),
 * con los mismos datos con que lo calculo el simulador: el navegador ya no
 * manda montos. Un monto que viaja en un campo oculto es un monto que
 * cualquiera puede editar antes de pulsar.
 */

/**
 * Cotiza lo que el simulador tiene marcado con `calculateMonthly` de
 * `@regb/billing`: el mismo motor que emite la factura, para el tier, el
 * ciclo y el pais de ESTE cliente. Solo lee: no guarda nada.
 *
 * El tenant sale de la sesion (o del modo demo, como el resto de las
 * acciones); de lo que manda el navegador solo se usan los ids, y el
 * motor descarta lo que no se puede comprar.
 */
export async function cotizarSeleccion(entrada: {
  tenant?: string | undefined
  rol?: string | undefined
  modulos: unknown
}): Promise<CotizacionMotor | null> {
  const ctx = await actionCtx({
    tenant: entrada.tenant || undefined,
    rol: entrada.rol || undefined,
  })
  if (!ctx) return null
  const modulos = Array.isArray(entrada.modulos)
    ? entrada.modulos.filter((m): m is string => typeof m === 'string').slice(0, 200)
    : []
  return cotizarConMotor(ctx.tenantId, modulos)
}

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

  const nota =
    String(fd.get('nota') ?? '')
      .trim()
      .slice(0, 500) || null

  // Lo que sube la mensualidad y la instalacion, segun el motor.
  const cotizacion = await cotizarConMotor(ctx.tenantId, modulos)
  const mensual = cotizacion?.aumento ?? 0
  const instalacion = cotizacion?.instalacionTotal ?? 0

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
            quoted_monthly = ${mensual}, quoted_install = ${instalacion},
            note = ${nota}, created_at = now()
        where id = ${ya.id}`
      return 'actualizada'
    }

    await tx`
      insert into regb.activation_requests
        (tenant_id, modules, quoted_monthly, quoted_install, note, requested_by)
      values (${ctx.tenantId}, ${validos.map((v) => v.id)},
              ${mensual}, ${instalacion}, ${nota}, ${ctx.userId})`
    return 'creada'
  })

  if (res === 'sin-modulos') {
    return { ok: false, error: 'Ninguno de esos modulos esta disponible todavia.' }
  }

  // 'layout' y no solo la pagina: la ficha `/marketplace/[id]` tambien
  // pinta la solicitud abierta y tiene que enterarse igual.
  revalidatePath('/marketplace', 'layout')
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
    'Recibimos tu pedido. Te llamamos para cotizar; todavía no se activó nada.',
  )
}

/** Lo que el proveedor lee en `/control` para saber que el cliente quiere probar primero. */
const NOTA_PRUEBA = 'Prueba 14 días'

/**
 * "Probar 14 dias" desde la ficha de un modulo.
 *
 * No existe un encendido de prueba en autoservicio: TODA activacion pasa
 * por `/control`, y alli `activarSolicitud` ya enciende los modulos como
 * `trial` con 14 dias (0035 + solicitudes-actions). Lo honesto es que el
 * boton haga exactamente eso: una solicitud en la misma tabla, marcada
 * como prueba para que quien llame no empiece cotizando la instalacion.
 *
 * La marca la pone el servidor, no un campo oculto: el navegador no
 * decide que dice la nota que lee el proveedor.
 */
export async function solicitarPruebaForm(fd: FormData): Promise<void> {
  const previa = String(fd.get('nota') ?? '').trim()
  fd.set(
    'nota',
    previa.startsWith(NOTA_PRUEBA) ? previa : previa ? `${NOTA_PRUEBA} · ${previa}` : NOTA_PRUEBA,
  )
  await anotarAviso(
    await solicitarActivacion(fd),
    'solicitarPrueba',
    'Recibimos tu pedido de prueba por 14 días. Te avisamos cuando esté encendida; todavía no se activó nada.',
  )
}

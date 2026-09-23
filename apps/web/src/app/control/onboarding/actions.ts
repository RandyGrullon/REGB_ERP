'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import type postgres from 'postgres'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'
import { anotarAviso } from '@/lib/aviso'
import { authConfigured, currentSession } from '@/lib/supabase'
import { enlaceDeInvitacion } from '@/app/usuarios/invitacion'
import { TIERS, type EstadoDueno, type ResultadoAlta, type ResultadoEnlace } from './alta'

const STAGES = ['sold', 'migration', 'config', 'training', 'live'] as const
type Etapa = (typeof STAGES)[number]

// ═══════════════════════════════════════════════════════════════════════
//  Alta de un cliente real
//
//  Toda la regla vive en `regb.alta_de_cliente()` (0133): RNC con digito
//  verificador, cierre de dependencias, enterprise solo en grande,
//  empresa/sucursal/almacen, roles e invitacion Owner por la puerta de
//  0123, idempotencia por RNC, bitacora. Aqui solo se arma la llamada y
//  se traduce la respuesta: una sola transaccion, o nada.
// ═══════════════════════════════════════════════════════════════════════

/** El usuario del proveedor en la demo (el mismo de solicitudes-actions). */
const DEMO_PROVIDER_USER = '00000000-0000-0000-0000-00000000f00d'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function quienOpera(): Promise<string> {
  if (!authConfigured) return DEMO_PROVIDER_USER
  const s = await currentSession()
  return s?.userId ?? DEMO_PROVIDER_USER
}

/**
 * Corre `fn` como el proveedor: claims con `is_provider` y el rol
 * `authenticated`, igual que llegaria por PostgREST con su token. La
 * funcion de la base vuelve a mirar `is_provider`: requireProvider() es la
 * barrera de la pantalla, no la unica.
 */
async function comoProveedor<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({
    sub: await quienOpera(),
    app_metadata: { is_provider: true },
  })
  return db().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

/** Los mensajes de 0133 y 0123 ya vienen redactados para quien opera. */
const CODIGOS_CON_MENSAJE = new Set(['22023', '23505', '42501', '55000', '23514'])

function mensajeDeBase(e: unknown, generico: string): string {
  const err = e as { code?: string; message?: string; constraint_name?: string }
  if (err?.code === '23514' && err.constraint_name?.startsWith('user_invitations')) {
    return 'La invitacion al dueño no paso: revisa su nombre (de 3 a 120 letras) y su correo.'
  }
  if (err?.code && CODIGOS_CON_MENSAJE.has(err.code) && err.message) return err.message
  console.error('[alta de cliente]', e)
  return generico
}

async function origen(): Promise<string> {
  const h = await headers()
  const o = h.get('origin')
  if (o && /^https?:\/\/[a-z0-9.:-]+$/i.test(o)) return o
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (host && /^[a-z0-9.:-]+$/i.test(host)) {
    const proto = h.get('x-forwarded-proto') === 'https' ? 'https' : 'http'
    return `${proto}://${host}`
  }
  return 'http://localhost:3000'
}

interface FilaAlta {
  resultado: 'creado' | 'completado' | 'ya_existia'
  cliente: string
  identificador: string
  modulos_activados: string[]
  piezas: string[]
  estado_dueno: EstadoDueno
  invitacion: string | null
  enlace_token: string | null
  vence: Date | null
}

export async function darDeAltaCliente(
  _prev: ResultadoAlta | null,
  fd: FormData,
): Promise<ResultadoAlta> {
  await requireProvider()

  const campo = (k: string) => String(fd.get(k) ?? '').trim()
  const tierRaw = campo('tier')
  // Un tier que no es del enum se manda como null: la base responde "Elige
  // el plan" en vez de un error de conversion.
  const tier = (TIERS as readonly string[]).includes(tierRaw) ? tierRaw : null
  const modulos = fd
    .getAll('modulos')
    .map((m) => String(m).trim())
    .filter(Boolean)
  const correo = campo('duenoCorreo').toLowerCase()

  let fila: FilaAlta
  try {
    fila = await comoProveedor(async (tx) => {
      const [r] = await tx<FilaAlta[]>`
        select * from regb.alta_de_cliente(
          ${campo('slug')}, ${campo('razonSocial')}, ${campo('nombreComercial') || null},
          ${campo('rnc')}, ${tier}::regb.tenant_tier, ${modulos}::text[],
          ${campo('sucursal') || null}, ${campo('almacen') || null},
          ${campo('duenoNombre')}, ${correo})`
      return r!
    })
  } catch (e) {
    return {
      ok: false,
      error: mensajeDeBase(
        e,
        'No pudimos dar de alta al cliente. No se guardo nada; intenta de nuevo.',
      ),
    }
  }

  revalidatePath('/control')
  revalidatePath('/control/onboarding')

  return {
    ok: true,
    resultado: fila.resultado,
    clienteId: fila.cliente,
    slug: fila.identificador,
    modulosActivados: fila.modulos_activados,
    piezas: fila.piezas,
    dueno: {
      estado: fila.estado_dueno,
      correo,
      enlace: fila.enlace_token ? enlaceDeInvitacion(await origen(), fila.enlace_token) : null,
      vence: fila.vence ? new Date(fila.vence).toISOString() : null,
    },
  }
}

/**
 * El token de la invitacion sale una sola vez. Si el proveedor cerro la
 * pantalla sin compartirlo, esto lo rota (0123: el anterior deja de
 * servir) y lo devuelve otra vez.
 */
export async function enlaceNuevoParaDueno(
  _prev: ResultadoEnlace | null,
  fd: FormData,
): Promise<ResultadoEnlace> {
  await requireProvider()
  const clienteId = String(fd.get('clienteId') ?? '')
  if (!UUID.test(clienteId)) return { ok: false, error: 'Falta el cliente.' }

  try {
    const r = await comoProveedor(async (tx) => {
      const [x] = await tx<{ enlace_token: string; vence: Date; correo: string }[]>`
        select enlace_token, vence, correo from regb.alta_enlace_nuevo_para_dueno(${clienteId}::uuid)`
      return x!
    })
    revalidatePath('/control/onboarding')
    return {
      ok: true,
      correo: r.correo,
      enlace: enlaceDeInvitacion(await origen(), r.enlace_token),
      vence: new Date(r.vence).toISOString(),
    }
  } catch (e) {
    return { ok: false, error: mensajeDeBase(e, 'No pudimos generar el enlace. Intenta de nuevo.') }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Mover de etapa en el tablero
//
//  Dos puertas, un solo nucleo: las flechas de siempre (`moverEtapa`, con
//  aviso por cookie) y arrastrar la tarjeta a cualquier columna
//  (`moverEtapaTablero`, que DEVUELVE el resultado para que el tablero
//  revierta su movimiento optimista si el servidor lo rechaza). Las dos
//  escriben como proveedor, bajo la RLS `provider_only` de regb.onboarding.
// ═══════════════════════════════════════════════════════════════════════

export type ResultadoMover = { ok: true; stage: Etapa } | { ok: false; error: string }

async function mover(
  tenantId: string,
  destino: (actual: Etapa) => Etapa | { error: string },
): Promise<ResultadoMover> {
  return comoProveedor(async (tx) => {
    const [row] = await tx<{ stage: Etapa }[]>`
      select stage from regb.onboarding where tenant_id = ${tenantId} for update`
    if (!row) return { ok: false, error: 'Ese cliente no tiene onboarding abierto.' } as const
    const target = destino(row.stage)
    if (typeof target !== 'string') return { ok: false, error: target.error } as const
    if (target === row.stage) return { ok: true, stage: target } as const

    await tx`
      update regb.onboarding
      set stage = ${target}, updated_at = now()
      where tenant_id = ${tenantId}`

    // Llegar a 'live' marca el go-live real del cliente. Volver atras no
    // lo borra: el go-live ya ocurrio.
    if (target === 'live') {
      await tx`
        update regb.tenants set go_live_at = coalesce(go_live_at, now())
        where id = ${tenantId}`
    }
    return { ok: true, stage: target } as const
  })
}

/** Arrastrar (o "Mover a..." con el teclado): directo a la etapa pedida. */
export async function moverEtapaTablero(formData: FormData): Promise<ResultadoMover> {
  await requireProvider()
  const tenantId = String(formData.get('tenantId') ?? '')
  const stage = String(formData.get('stage') ?? '')
  if (!UUID.test(tenantId) || stage === '') {
    return { ok: false, error: 'Falta el cliente o la etapa.' }
  }
  if (!(STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: 'Esa etapa no existe.' }
  }
  const r = await mover(tenantId, () => stage as Etapa)
  if (r.ok) revalidatePath('/control/onboarding')
  return r
}

/** Las flechas de la tarjeta: una etapa adelante o atras. */
export async function moverEtapa(formData: FormData): Promise<void> {
  await requireProvider()

  const tenantId = String(formData.get('tenantId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!UUID.test(tenantId) || (direction !== 'next' && direction !== 'prev')) {
    await anotarAviso({ ok: false, error: 'Falta el cliente o la direccion.' }, 'moverEtapa')
    return
  }

  const r = await mover(tenantId, (actual) => {
    const idx = STAGES.indexOf(actual)
    // Ya esta en el extremo: no es un fallo del sistema, pero el usuario
    // hizo clic y merece saber por que no se movio nada.
    const target = direction === 'next' ? STAGES[idx + 1] : STAGES[idx - 1]
    return (
      target ?? {
        error:
          direction === 'next' ? 'Ya esta en la ultima etapa.' : 'Ya esta en la primera etapa.',
      }
    )
  })
  if (!r.ok) {
    await anotarAviso(r, 'moverEtapa')
    return
  }

  revalidatePath('/control/onboarding')
  await anotarAviso({ ok: true }, 'moverEtapa', 'Listo, movimos la etapa.')
}

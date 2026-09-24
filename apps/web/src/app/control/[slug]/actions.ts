'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { authConfigured, currentSession } from '@/lib/supabase'
import { requireProvider } from '@/lib/provider-guard'
import { anotarAviso } from '@/lib/aviso'

/**
 * Impersonacion (§7.4): razon obligatoria (>=10), 60 minutos de vigencia
 * (rls.impersonating() los hace cumplir), doble bitacora (la del
 * proveedor y la del tenant, escritas por regb.start_impersonation).
 *
 * Con auth real el MFA se re-verifica ANTES de llegar aqui (Supabase AAL2).
 * En demostracion se usa un uuid fijo de proveedor para dejar el rastro.
 */
const DEMO_PROVIDER_USER = '00000000-0000-0000-0000-00000000f00d'

export async function impersonar(formData: FormData): Promise<void> {
  await requireProvider()

  const slug = String(formData.get('slug') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  const ticket = String(formData.get('ticket') ?? '').trim() || null

  // Antes esto devolvia en seco: escribir una razon de 9 letras no
  // producia nada y parecia que el boton estaba muerto.
  if (!slug) {
    await anotarAviso({ ok: false, error: 'Falta el cliente.' }, 'impersonar')
    return
  }
  if (reason.length < 10) {
    await anotarAviso(
      {
        ok: false,
        error:
          'La razón tiene que tener al menos 10 caracteres: queda en la bitácora de los dos lados.',
      },
      'impersonar',
    )
    return
  }

  const sql = db()
  const [tenant] = await sql<{ id: string }[]>`
    select id from regb.tenants where slug = ${slug}`
  if (!tenant) {
    await anotarAviso({ ok: false, error: 'Ese cliente no existe.' }, 'impersonar')
    return
  }

  let providerUser = DEMO_PROVIDER_USER
  if (authConfigured) {
    const session = await currentSession()
    if (session) providerUser = session.userId
  }

  await sql`select regb.start_impersonation(
    ${providerUser}, ${tenant.id}, ${reason}, ${ticket})`

  redirect(`/?tenant=${slug}&rol=Owner&impersonando=1`)
}

/**
 * Pasa a pago un modulo en prueba (vigente o vencida hace poco).
 *
 * Es el cierre de la venta que abrio "Activar en prueba": hasta ahora no
 * habia boton, y al vencer los 14 dias el modulo se apagaba sin que nadie
 * pudiera cobrarlo sin SQL. `active` dispara el cargo de instalacion
 * pendiente (0128) y la proxima factura cobra instalacion y mensualidad.
 *
 * Solo toca filas en `trial`: pulsar dos veces, o sobre un modulo que ya
 * esta de pago, no cambia nada.
 */
export async function pasarAPago(formData: FormData): Promise<void> {
  await requireProvider()
  const slug = String(formData.get('slug') ?? '')
  const moduleId = String(formData.get('moduleId') ?? '')
  if (!slug || !moduleId) {
    await anotarAviso({ ok: false, error: 'Falta el cliente o el módulo.' }, 'pasarAPago')
    return
  }

  // Con lo que necesita para funcionar: pasar "Cuentas por cobrar" a pago
  // y dejar "Pedidos de venta" en prueba lo apagaria a los 14 dias.
  const sql = db()
  const filas = await sql<{ tenant_id: string; name: string }[]>`
    with recursive necesita(id) as (
      select ${moduleId}::text
      union
      select unnest(mc.requires) from regb.module_catalog mc join necesita n on n.id = mc.id
    )
    update regb.tenant_modules tm
    set status = 'active', enabled = true, trial_ends_at = null
    from regb.tenants t, regb.module_catalog mc
    where t.slug = ${slug} and tm.tenant_id = t.id
      and tm.module_id in (select id from necesita) and mc.id = tm.module_id
      and tm.status = 'trial'
    returning tm.tenant_id, mc.name`

  if (filas.length === 0) {
    await anotarAviso(
      { ok: false, error: 'Ese módulo ya no está en prueba: no cambiamos nada.' },
      'pasarAPago',
    )
    revalidatePath(`/control/${slug}`)
    return
  }
  const lista = filas.map((f) => f.name).join(', ')

  await sql`
    insert into public.notifications (tenant_id, module_id, title, body, link)
    values (${filas[0]!.tenant_id}, 'marketplace',
            ${`${lista}: ya ${filas.length === 1 ? 'es tuyo' : 'son tuyos'}`},
            ${'Dejó de ser prueba: lo sigues usando con tus datos de siempre. La instalación y la mensualidad entran en tu próxima factura.'},
            '/marketplace')`

  revalidatePath(`/control/${slug}`)
  revalidatePath('/control')
  await anotarAviso(
    { ok: true },
    'pasarAPago',
    `Listo: ${lista} quedó de pago. La instalación entra en la próxima factura.`,
  )
}

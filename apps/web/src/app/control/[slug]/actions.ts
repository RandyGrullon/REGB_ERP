'use server'

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
      { ok: false, error: 'La razon tiene que tener al menos 10 caracteres: queda en la bitacora de los dos lados.' },
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

'use server'

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { authConfigured, currentSession } from '@/lib/supabase'
import { requireProvider } from '@/lib/provider-guard'

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

  if (!slug || reason.length < 10) return

  const sql = db()
  const [tenant] = await sql<{ id: string }[]>`
    select id from regb.tenants where slug = ${slug}`
  if (!tenant) return

  let providerUser = DEMO_PROVIDER_USER
  if (authConfigured) {
    const session = await currentSession()
    if (session) providerUser = session.userId
  }

  await sql`select regb.start_impersonation(
    ${providerUser}, ${tenant.id}, ${reason}, ${ticket})`

  redirect(`/?tenant=${slug}&rol=Owner&impersonando=1`)
}

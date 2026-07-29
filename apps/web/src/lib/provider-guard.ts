import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { authConfigured, currentSession } from './supabase'

/**
 * Barrera de REGB Control: solo usuarios del proveedor (§7).
 *
 * Con auth real, un usuario normal recibe 404 — no 403 — para no revelar
 * siquiera que el panel existe. En modo demostracion (sin Supabase) se
 * abre, porque toda la app es una vitrina en ese modo.
 */
export async function requireProvider(): Promise<void> {
  if (!authConfigured) return
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!session.isProvider) notFound()
}

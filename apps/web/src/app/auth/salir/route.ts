import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

/** Cerrar sesion. POST y no GET: cerrar sesion cambia estado. */
export async function POST(request: NextRequest) {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  return NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 })
}

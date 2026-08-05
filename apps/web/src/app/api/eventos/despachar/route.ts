import { NextResponse } from 'next/server'
import { despachar } from '@/lib/despachador'

export const dynamic = 'force-dynamic'

/**
 * Despacha un lote del bus de eventos.
 *
 * Existe como endpoint —y no como algo que corre solo— porque Next no
 * tiene procesos de fondo: cada peticion vive y muere. Lo llama un cron
 * (Vercel Cron, un `curl` en el servidor, o la Edge Function cuando
 * llegue) cada pocos minutos, y tambien el boton de /control/salud
 * cuando alguien quiere ver el efecto sin esperar.
 *
 * ── Por que un secreto y no un permiso de usuario ─────────────────────
 *
 * El despachador procesa eventos de TODOS los clientes: no actua en
 * nombre de nadie y por eso no encaja en el modelo de permisos. Se
 * protege con un secreto compartido en `REGB_CRON_SECRET`.
 *
 * Sin ese secreto, en produccion el endpoint NO responde. Se probo primero
 * a dejarlo abierto solo desde localhost, pero eso es falsa seguridad: el
 * `hostname` de `req.url` lo pone el servidor, no el cliente, y detras de
 * un proxy sigue siendo localhost aunque la peticion venga de internet.
 * Una comprobacion que parece proteger y no protege es peor que ninguna.
 *
 * En desarrollo se deja abierto a proposito: no hay cron y hace falta
 * poder dispararlo con un curl.
 */
export async function POST(req: Request) {
  const secreto = process.env.REGB_CRON_SECRET
  const enviado = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  if (secreto) {
    if (enviado !== secreto) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Falta REGB_CRON_SECRET. El despachador no se expone sin el.' },
      { status: 503 },
    )
  }

  const limite = Math.min(Number(new URL(req.url).searchParams.get('limite') ?? 50) || 50, 500)

  try {
    const r = await despachar(limite)
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Fallo el despacho.' },
      { status: 500 },
    )
  }
}

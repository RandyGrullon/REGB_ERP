import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

/** Descarga de un respaldo como JSON (S11). Doble candado, como todo. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const url = new URL(request.url)
  const ctx = await actionCtx({
    tenant: url.searchParams.get('tenant') ?? undefined,
    rol: url.searchParams.get('rol') ?? undefined,
  })
  if (!ctx) return new Response('Sesion no valida', { status: 401 })
  if (!exigir(ctx, 'backup', 'backup.export').ok) return new Response('No existe', { status: 404 })

  const [backup] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ payload: unknown; created_at: string }[]>`
      select payload, created_at::text from public.backups
      where id = ${id} and tenant_id = ${ctx.tenantId}`,
  )

  if (!backup) return new Response('No existe', { status: 404 })

  const nombre = `regb-respaldo-${backup.created_at.slice(0, 10)}.json`
  return new Response(JSON.stringify(backup.payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  })
}

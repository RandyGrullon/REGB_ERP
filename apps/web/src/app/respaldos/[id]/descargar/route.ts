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

  // Se marca que este respaldo SALIO de aqui.
  //
  // Es el unico dato que distingue un respaldo que protege de uno que
  // no: el que sigue dentro de la misma base se pierde con ella. Sin
  // esto, la pantalla no puede avisar y el cliente cree que esta
  // cubierto porque ve la lista llena.
  //
  // Se marca la PRIMERA vez y no se pisa en las siguientes: lo que
  // interesa es cuando dejo de estar solo aqui, no la ultima vez que
  // alguien volvio a bajarlo.
  await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx`
      update public.backups
         set downloaded_at = now(), downloaded_by = ${ctx.userId}
       where id = ${id} and tenant_id = ${ctx.tenantId} and downloaded_at is null`,
  )

  const nombre = `regb-respaldo-${backup.created_at.slice(0, 10)}.json`
  return new Response(JSON.stringify(backup.payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  })
}

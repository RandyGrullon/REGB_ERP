import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

/**
 * Descarga de un archivo (S11).
 *
 * Mismo doble candado que cualquier accion: permiso files.view en
 * servidor + lectura bajo RLS. Adivinando ids no se descarga nada de
 * otro tenant: la fila simplemente no existe bajo su RLS.
 */
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
  if (!exigir(ctx, 'files', 'files.view').ok) return new Response('No existe', { status: 404 })

  const [file] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ name: string; mime: string; content: Buffer | null }[]>`
      select name, mime, content from public.files
      where id = ${id} and tenant_id = ${ctx.tenantId} and deleted_at is null`,
  )

  if (!file?.content) return new Response('No existe', { status: 404 })

  return new Response(new Uint8Array(file.content), {
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
    },
  })
}

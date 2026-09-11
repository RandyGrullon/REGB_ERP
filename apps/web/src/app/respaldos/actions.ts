'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'
import { anotarAviso } from '@/lib/aviso'

/**
 * Respaldos (S11): un snapshot JSON de los datos del tenant, hecho bajo
 * RLS — el respaldo NO puede contener nada que el tenant no vea.
 *
 * TRAMPA DEL DRIVER — leer antes de tocar esto.
 *
 * El snapshot se arma y se inserta en UNA sola sentencia, sin traerlo a
 * JavaScript. Si se trae y se reenvia con `${JSON.stringify(obj)}::jsonb`,
 * postgres.js vuelve a serializar el valor al ver que el destino es jsonb
 * y Postgres acaba guardando un jsonb de tipo *string* (el JSON entero
 * entrecomillado), no un objeto: `jsonb_object_keys` falla y el archivo
 * descargado sale con comillas escapadas.
 */
export async function crearRespaldo(formData: FormData): Promise<void> {
  const ctx = await actionCtx({
    tenant: String(formData.get('tenant') ?? '') || undefined,
    rol: String(formData.get('rol') ?? '') || undefined,
  })
  if (!ctx) {
    await anotarAviso({ ok: false, error: 'Sesion no valida.' }, 'crearRespaldo')
    return
  }
  const permiso = exigir(ctx, 'backup', 'backup.create')
  if (!permiso.ok) {
    await anotarAviso(permiso, 'crearRespaldo')
    return
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      with snapshot as (
        select jsonb_build_object(
          'exportado_en', now(),
          'empresas',  (select coalesce(jsonb_agg(to_jsonb(c) - 'tenant_id'), '[]'::jsonb)
                          from public.companies c
                          where c.tenant_id = ${ctx.tenantId} and c.deleted_at is null),
          'sucursales',(select coalesce(jsonb_agg(to_jsonb(b) - 'tenant_id'), '[]'::jsonb)
                          from public.branches b
                          where b.tenant_id = ${ctx.tenantId} and b.deleted_at is null),
          'roles',     (select coalesce(jsonb_agg(to_jsonb(r) - 'tenant_id'), '[]'::jsonb)
                          from public.roles r where r.tenant_id = ${ctx.tenantId}),
          'equipo',    (select coalesce(jsonb_agg(to_jsonb(p) - 'tenant_id'), '[]'::jsonb)
                          from public.user_profiles p where p.tenant_id = ${ctx.tenantId}),
          'productos', (select coalesce(jsonb_agg(to_jsonb(pr) - 'tenant_id'), '[]'::jsonb)
                          from public.products pr where pr.tenant_id = ${ctx.tenantId}),
          'configuracion', (select to_jsonb(s) - 'tenant_id'
                          from public.tenant_settings s where s.tenant_id = ${ctx.tenantId})
        ) as data
      )
      insert into public.backups (tenant_id, kind, payload, size_bytes, created_by)
      select ${ctx.tenantId}, 'manual', s.data,
             octet_length(s.data::text), ${ctx.userId}
      from snapshot s`
  })

  revalidatePath('/respaldos')
  await anotarAviso({ ok: true }, 'crearRespaldo', 'Listo, creamos el respaldo.')
}

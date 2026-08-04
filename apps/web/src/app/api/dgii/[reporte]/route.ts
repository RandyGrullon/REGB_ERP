import { NextResponse } from 'next/server'
import { asUser } from '@/lib/db'
import { actionCtx, exigir } from '@/lib/module-page'

export const dynamic = 'force-dynamic'

/**
 * Descarga del 607 y del 608 en CSV.
 *
 * Un negocio no solo necesita VER lo que va a declarar: necesita
 * entregarlo. Hasta ahora la pantalla lo enseñaba y ahi se acababa, asi
 * que el contador terminaba copiando a mano — que es exactamente donde se
 * cuelan los errores que rebotan la declaracion.
 *
 * CSV a proposito, y no el TXT de envio a la Oficina Virtual. El layout
 * de ese archivo lo fija una norma de la DGII que cambia, y generar uno
 * mal formado no falla aqui: falla el dia 20, en la ventanilla, con el
 * plazo encima. El CSV lo abre el contador en Excel, lo revisa y lo carga
 * en la herramienta que ya usa. Cuando el layout oficial este confirmado
 * contra un archivo real ya aceptado, se anade como formato adicional sin
 * tocar esto.
 */

const COLUMNAS_607 = [
  ['rnc_comprador', 'RNC o cedula del comprador'],
  ['tipo_identificacion', 'Tipo de identificacion (1 RNC, 2 cedula, 3 sin identificar)'],
  ['ncf', 'NCF'],
  ['fecha_comprobante', 'Fecha del comprobante (AAAAMMDD)'],
  ['monto_facturado', 'Monto facturado sin ITBIS'],
  ['itbis_facturado', 'ITBIS facturado'],
  ['total', 'Total'],
  ['origen', 'Origen (factura o caja)'],
] as const

const COLUMNAS_608 = [
  ['ncf', 'NCF anulado'],
  ['ncf_type', 'Tipo de comprobante'],
  ['fecha_comprobante', 'Fecha del comprobante (AAAAMMDD)'],
  ['motivo', 'Motivo de la anulacion'],
  ['origen', 'Origen (factura o caja)'],
] as const

/** Escapa un campo para CSV. Excel en es-DO abre con `;` como separador. */
function campo(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: Request, { params }: { params: Promise<{ reporte: string }> }) {
  const { reporte } = await params
  if (reporte !== '607' && reporte !== '608') {
    return NextResponse.json({ error: 'Solo 607 o 608.' }, { status: 404 })
  }

  const url = new URL(req.url)
  const periodo = url.searchParams.get('periodo') ?? ''
  if (!/^\d{6}$/.test(periodo)) {
    return NextResponse.json({ error: 'Indica el periodo como AAAAMM.' }, { status: 400 })
  }

  const ctx = await actionCtx({
    tenant: url.searchParams.get('tenant') ?? undefined,
    rol: url.searchParams.get('rol') ?? undefined,
  })
  if (!ctx) return NextResponse.json({ error: 'Sesion no valida.' }, { status: 401 })

  // Mismo permiso que la pantalla: descargar es exportar (§8.3).
  const permiso = exigir(ctx, 'ar', 'ar.export')
  if (!permiso.ok) return NextResponse.json({ error: permiso.error }, { status: 403 })

  const cols = reporte === '607' ? COLUMNAS_607 : COLUMNAS_608
  const filas = await asUser(ctx.userId, ctx.tenantId, async (tx) =>
    reporte === '607'
      ? tx<Record<string, unknown>[]>`
          select rnc_comprador, tipo_identificacion, ncf, fecha_comprobante,
                 monto_facturado::text, itbis_facturado::text, total::text, origen
          from public.dgii_607
          where tenant_id = ${ctx.tenantId} and periodo = ${periodo}
          order by ncf`
      : tx<Record<string, unknown>[]>`
          select ncf, ncf_type, fecha_comprobante, motivo, origen
          from public.dgii_608
          where tenant_id = ${ctx.tenantId} and periodo = ${periodo}
          order by ncf`,
  )

  const lineas = [
    cols.map(([, titulo]) => campo(titulo)).join(';'),
    ...filas.map((f) => cols.map(([k]) => campo(f[k])).join(';')),
  ]

  // BOM para que Excel en Windows respete los acentos. Sin el, "Anulacion"
  // llega como "AnulaciÃ³n" y el contador cree que el sistema esta roto.
  const csv = '﻿' + lineas.join('\r\n') + '\r\n'

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${reporte}-${periodo}-${ctx.tenantSlug}.csv"`,
      'cache-control': 'no-store',
    },
  })
}

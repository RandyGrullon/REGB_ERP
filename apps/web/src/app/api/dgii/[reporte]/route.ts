import { NextResponse } from 'next/server'
import { generar607, generar608, nombreArchivo, type TipoIdentificacion } from '@regb/operations'
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
  // `?formato=txt` da el archivo de envio de la DGII; por defecto, CSV.
  const formato = url.searchParams.get('formato') === 'txt' ? 'txt' : 'csv'
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

  if (formato === 'txt') return archivoDeEnvio(reporte, periodo, ctx)

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

/**
 * Archivo .TXT de envio a la Oficina Virtual.
 *
 * El layout sale de la Norma General 07-2018 (Anexos B y C). NO esta
 * verificado contra un archivo real ya aceptado por la DGII: hasta que lo
 * este, la pantalla lo advierte y el CSV sigue siendo el camino
 * recomendado. Ver docs/DGII-FORMATO-ENVIO.md.
 */
async function archivoDeEnvio(
  reporte: '607' | '608',
  periodo: string,
  ctx: Awaited<ReturnType<typeof actionCtx>> & object,
) {
  const [empresa] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ tax_id: string | null }[]>`
      select regexp_replace(tax_id, '\D', '', 'g') as tax_id
      from public.companies
      where tenant_id = ${ctx.tenantId} and is_default and deleted_at is null`,
  )
  const rnc = empresa?.tax_id ?? ''
  if (!rnc) {
    return NextResponse.json(
      { error: 'Tu empresa no tiene RNC cargado. Sin el, la DGII rechaza el archivo entero.' },
      { status: 409 },
    )
  }

  try {
    let contenido: string

    if (reporte === '607') {
      // Las formas de pago vienen de los pagos reales del ticket. La DGII
      // las quiere CON impuestos y sumando el total, que es justo como se
      // guardaron al cobrar.
      const filas = await asUser(
        ctx.userId,
        ctx.tenantId,
        (tx) => tx<
          {
            rnc: string | null
            tipo: string
            ncf: string
            fecha: string
            monto: string
            itbis: string
            efectivo: string
            transferencia: string
            tarjeta: string
            credito: string
          }[]
        >`
          select v.rnc_comprador as rnc, v.tipo_identificacion as tipo, v.ncf,
                 v.fecha_comprobante as fecha,
                 v.monto_facturado::text as monto, v.itbis_facturado::text as itbis,
                 coalesce(p.efectivo, 0)::text      as efectivo,
                 coalesce(p.transferencia, 0)::text as transferencia,
                 coalesce(p.tarjeta, 0)::text       as tarjeta,
                 case when v.origen = 'factura' then v.total else 0 end::text as credito
          from public.dgii_607 v
          left join lateral (
            select sum(pg.amount) filter (where pg.method = 'cash')     as efectivo,
                   sum(pg.amount) filter (where pg.method = 'transfer') as transferencia,
                   sum(pg.amount) filter (where pg.method = 'card')     as tarjeta
            from public.pos_payments pg
            join public.pos_sales s on s.id = pg.sale_id
            where s.tenant_id = v.tenant_id and s.ncf = v.ncf
          ) p on true
          where v.tenant_id = ${ctx.tenantId} and v.periodo = ${periodo}
          order by v.ncf`,
      )

      contenido = generar607(
        rnc,
        periodo,
        filas.map((f) => ({
          rncComprador: f.rnc,
          tipoIdentificacion: f.tipo as TipoIdentificacion,
          ncf: f.ncf,
          fechaComprobante: f.fecha,
          montoFacturado: Number(f.monto),
          itbisFacturado: Number(f.itbis),
          efectivo: Number(f.efectivo),
          chequeTransferencia: Number(f.transferencia),
          tarjeta: Number(f.tarjeta),
          credito: Number(f.credito),
        })),
      )
    } else {
      const filas = await asUser(
        ctx.userId,
        ctx.tenantId,
        (tx) => tx<{ ncf: string; fecha: string; motivo: string }[]>`
          select ncf, fecha_comprobante as fecha, motivo
          from public.dgii_608
          where tenant_id = ${ctx.tenantId} and periodo = ${periodo}
          order by ncf`,
      )
      contenido = generar608(
        rnc,
        periodo,
        filas.map((f) => ({
          ncf: f.ncf,
          fechaComprobante: f.fecha,
          tipoAnulacion: f.motivo,
        })),
      )
    }

    return new NextResponse(contenido, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${nombreArchivo(reporte, rnc, periodo)}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    // Un archivo que la DGII rechaza es peor que no generarlo: el
    // contribuyente cree que declaro y no declaro. Se explica el motivo en
    // vez de bajar algo roto.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo generar el archivo.' },
      { status: 409 },
    )
  }
}

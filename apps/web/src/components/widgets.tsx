import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, Mono } from '@regb/ui'
import {
  buildBudgetVsActual,
  buildCashFlowProjection,
  daysSinceRate,
  firstShortfallWeek,
  horaEsperadaEnRD,
  lateMinutes,
  certificadoVigente,
  listaVigente,
  progresoObjetivo,
  saldoPrestamo,
  totalAportePatronal,
} from '@regb/operations'
import type { TransactionSql } from 'postgres'

/**
 * Widgets del dashboard.
 *
 * El dashboard NO conoce ids de modulo —lo prohibe `audit:registry` (§2.2)—
 * sino claves de widget. Cada modulo declara las suyas en su manifest y
 * aqui vive el renderizador de cada clave. Si el modulo se apaga, su clave
 * no llega y el widget desaparece solo; si declara una clave sin
 * renderizador, se muestra un aviso honesto en vez de romper el inicio.
 *
 * Todas las consultas corren dentro del `asUser` del dashboard, asi que la
 * RLS ya filtro por tenant y por modulo activo antes de llegar aqui. Un
 * widget que devuelve cero filas porque su tabla esta cerrada es el
 * comportamiento correcto, no un error.
 */

export interface DatosWidgets {
  stockBajo: { name: string; sku: string; qty: number; punto: number }[]
  valorInventario: number
  ventasHoy: { tickets: number; total: number }
  turnosAbiertos: { warehouse: string; cajero: string; desde: string }[]
  pedidosPendientes: { number: string; customer: string; total: number; estado: string }[]
  backorder: number
  vencidas: { customer: string; total: number; dias: number }[]
  catalogoIncompleto: { sinPrecio: number; sinCategoria: number; total: number }
  masVendidos: { name: string; unidades: number; importe: number }[]
  mejoresClientes: { name: string; compras: number; importe: number }[]
  ordenesPorRecibir: { number: string; supplier: string; total: number; estado: string }[]
  mejoresProveedores: { name: string; ordenes: number; importe: number }[]
  asientosBorrador: number
  asientosDelMes: number
  porPagarVencido: { supplier: string; total: number; dias: number }[]
  porPagarEstaSemana: number
  efectivoEnBancos: { total: number; cuentas: number }
  flujoEnRojo: { semana: number | null; efectivoFinal: number }
  conciliacionPendiente: { cuenta: string; pendientes: number; monto: number }[]
  ultimoImport: { cuenta: string; hace: number } | null
  activosValorLibros: number
  activosPorDepreciarEsteMes: number
  presupuestoAlertas: number
  presupuestoYtd: { presupuestado: number; real: number }
  centrosTop: { name: string; total: number }[]
  centrosTotal: number
  tasasHoy: { code: string; rate: number; dias: number }[]
  tasaMasVieja: number | null
  linksPendientes: { description: string; amount: number }[]
  recurrentesVencidos: number
  headcount: number
  nuevosIngresos: { name: string; hace: number }[]
  proximaNomina: { periodo: string; diasFaltan: number } | null
  costoNominaMesActual: number
  marcajesHoy: number
  tardanzasHoy: { name: string; minutos: number }[]
  solicitudesPendientes: number
  fueraHoy: { name: string; tipo: string; regresa: string }[]
  gastosPorAprobar: number
  gastosPorReembolsar: number
  anunciosRecientes: { title: string; publicado: string }[]
  prestamosPendientes: number
  costoBeneficiosMensual: number
  vacantesAbiertas: number
  pipelinePorVacante: { title: string; n: number }[]
  objetivosConProgreso: { title: string; progreso: number }[]
  planesDeMejoraActivos: number
  inscripcionesEnCurso: number
  certificadosPorVencer: { name: string; vence: string }[]
  proveedoresPendientes: number
  documentosProveedorPorVencer: { name: string; vence: string }[]
  listasPrecioVigentes: number
  requisicionesPendientes: number
  rfqsAbiertos: number
  recepcionesConDiscrepancias: number
  lotesPorVencer: number
  transferenciasEnTransito: number
  conteosEsperandoAprobacion: number
  productosSinCodigoBarras: number
  vehiculosMantenimientoVencido: number
  rutasEnProgreso: number
  bomsActivos: number
  ordenesProduccionEnProgreso: number
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Formatea una fecha `YYYY-MM-DD` sin pasar por la zona local -evita que
 * un `new Date('2026-09-15')` se corra un dia al convertir a la hora del
 * servidor-. */
const fechaCortaUTC = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * Se consulta SOLO lo que alguna clave declarada necesita, y en una sola
 * ida a la base. El dashboard no decide que cargar mirando modulos —eso
 * seria conocerlos, y lo prohibe §2.2— sino mirando las claves que el
 * registry ya le entrego: si nadie declaro `stock-alerts`, la consulta de
 * existencias ni se escribe.
 *
 * Efecto util de lado: cero consultas desperdiciadas en la pantalla que
 * mas se abre del ERP.
 */
export async function cargarDatosWidgets(
  tx: TransactionSql,
  tenantId: string,
  claves: readonly string[],
): Promise<DatosWidgets> {
  const pidieron = (...ks: string[]) => ks.some((k) => claves.includes(k))

  const vacio: DatosWidgets = {
    stockBajo: [],
    valorInventario: 0,
    ventasHoy: { tickets: 0, total: 0 },
    turnosAbiertos: [],
    pedidosPendientes: [],
    backorder: 0,
    vencidas: [],
    catalogoIncompleto: { sinPrecio: 0, sinCategoria: 0, total: 0 },
    masVendidos: [],
    mejoresClientes: [],
    ordenesPorRecibir: [],
    mejoresProveedores: [],
    asientosBorrador: 0,
    asientosDelMes: 0,
    porPagarVencido: [],
    porPagarEstaSemana: 0,
    efectivoEnBancos: { total: 0, cuentas: 0 },
    flujoEnRojo: { semana: null, efectivoFinal: 0 },
    conciliacionPendiente: [],
    ultimoImport: null,
    activosValorLibros: 0,
    activosPorDepreciarEsteMes: 0,
    presupuestoAlertas: 0,
    presupuestoYtd: { presupuestado: 0, real: 0 },
    centrosTop: [],
    centrosTotal: 0,
    tasasHoy: [],
    tasaMasVieja: null,
    linksPendientes: [],
    recurrentesVencidos: 0,
    headcount: 0,
    nuevosIngresos: [],
    proximaNomina: null,
    costoNominaMesActual: 0,
    marcajesHoy: 0,
    tardanzasHoy: [],
    solicitudesPendientes: 0,
    fueraHoy: [],
    gastosPorAprobar: 0,
    gastosPorReembolsar: 0,
    anunciosRecientes: [],
    prestamosPendientes: 0,
    costoBeneficiosMensual: 0,
    vacantesAbiertas: 0,
    pipelinePorVacante: [],
    objetivosConProgreso: [],
    planesDeMejoraActivos: 0,
    inscripcionesEnCurso: 0,
    certificadosPorVencer: [],
    proveedoresPendientes: 0,
    documentosProveedorPorVencer: [],
    listasPrecioVigentes: 0,
    requisicionesPendientes: 0,
    rfqsAbiertos: 0,
    recepcionesConDiscrepancias: 0,
    lotesPorVencer: 0,
    transferenciasEnTransito: 0,
    conteosEsperandoAprobacion: 0,
    productosSinCodigoBarras: 0,
    vehiculosMantenimientoVencido: 0,
    rutasEnProgreso: 0,
    bomsActivos: 0,
    ordenesProduccionEnProgreso: 0,
  }

  if (pidieron('stock-alerts', 'inventory-value')) {
    vacio.stockBajo = (
      await tx<{ name: string; sku: string; qty: string; punto: string }[]>`
        select p.name, p.sku, s.qty_on_hand::text as qty, p.reorder_point::text as punto
        from public.stock_levels s
        join public.products p on p.id = s.product_id
        where s.tenant_id = ${tenantId}
          and p.reorder_point > 0
          and s.qty_on_hand <= p.reorder_point
        order by s.qty_on_hand - p.reorder_point
        limit 5`
    ).map((r) => ({ name: r.name, sku: r.sku, qty: Number(r.qty), punto: Number(r.punto) }))

    const [v] = await tx<{ valor: string }[]>`
      select coalesce(sum(qty_on_hand * avg_cost), 0)::text as valor
      from public.stock_levels where tenant_id = ${tenantId}`
    vacio.valorInventario = Number(v?.valor ?? 0)
  }

  if (pidieron('sales-today', 'open-shifts')) {
    const [v] = await tx<{ tickets: string; total: string }[]>`
      select count(*)::text as tickets, coalesce(sum(total), 0)::text as total
      from public.pos_sales
      where tenant_id = ${tenantId} and not voided
        and created_at >= date_trunc('day', now())`
    vacio.ventasHoy = { tickets: Number(v?.tickets ?? 0), total: Number(v?.total ?? 0) }

    vacio.turnosAbiertos = await tx<{ warehouse: string; cajero: string; desde: string }[]>`
      select w.name as warehouse, coalesce(up.display_name, 'sin nombre') as cajero,
             sh.opened_at::text as desde
      from public.pos_shifts sh
      join public.warehouses w on w.id = sh.warehouse_id
      left join public.user_profiles up
        on up.tenant_id = sh.tenant_id and up.user_id = sh.cashier_id
      where sh.tenant_id = ${tenantId} and sh.status = 'open'
      order by sh.opened_at`
  }

  if (pidieron('pending-orders', 'backorder-list')) {
    vacio.pedidosPendientes = (
      await tx<{ number: string; customer: string; total: string; estado: string }[]>`
        select o.number, c.name as customer, o.total::text, o.status as estado
        from public.sales_orders o
        join public.customers c on c.id = o.customer_id
        where o.tenant_id = ${tenantId}
          and o.status in ('confirmed', 'partially_delivered')
        order by o.created_at
        limit 5`
    ).map((r) => ({ ...r, total: Number(r.total) }))

    const [b] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.sales_order_lines
      where tenant_id = ${tenantId} and qty_reserved < qty_ordered - qty_delivered`
    vacio.backorder = Number(b?.n ?? 0)
  }

  if (pidieron('overdue-receivables', 'aging-summary')) {
    vacio.vencidas = (
      await tx<{ customer: string; total: string; dias: string }[]>`
        select c.name as customer,
               public.invoice_balance(i.id)::text as total,
               (current_date - i.due_date)::text as dias
        from public.customer_invoices i
        join public.customers c on c.id = i.customer_id
        where i.tenant_id = ${tenantId}
          and i.status not in ('paid', 'void')
          and i.due_date < current_date
        order by i.due_date
        limit 5`
    ).map((r) => ({ customer: r.customer, total: Number(r.total), dias: Number(r.dias) }))
  }

  // Los mas vendidos salen de la caja Y de los pedidos: un colmado vende
  // por mostrador y una distribuidora por pedido, y el widget tiene que
  // servirle a los dos. Sumar solo uno de los dos caminos daria un ranking
  // que contradice lo que el dueno ve en su propio negocio.
  if (pidieron('top-products')) {
    vacio.masVendidos = (
      await tx<{ name: string; unidades: string; importe: string }[]>`
        with ventas as (
          select l.product_id, l.qty as unidades, l.line_total as importe
          from public.pos_sale_lines l
          join public.pos_sales s on s.id = l.sale_id
          where l.tenant_id = ${tenantId} and not s.voided
            and s.sold_at >= now() - interval '30 days'
          union all
          -- Prorrateado por lo ENTREGADO: line_total es de lo pedido, y en
          -- un pedido a medias contaria como vendido lo que todavia esta
          -- en el almacen.
          select l.product_id, l.qty_delivered,
                 l.line_total * (l.qty_delivered / nullif(l.qty_ordered, 0))
          from public.sales_order_lines l
          join public.sales_orders o on o.id = l.order_id
          where l.tenant_id = ${tenantId} and o.status <> 'cancelled'
            and l.qty_delivered > 0
            and o.created_at >= now() - interval '30 days'
        )
        select p.name, sum(v.unidades)::text as unidades, sum(v.importe)::text as importe
        from ventas v
        join public.products p on p.id = v.product_id
        group by p.name
        order by sum(v.importe) desc
        limit 5`
    ).map((r) => ({ name: r.name, unidades: Number(r.unidades), importe: Number(r.importe) }))
  }

  if (pidieron('top-customers')) {
    vacio.mejoresClientes = (
      await tx<{ name: string; compras: string; importe: string }[]>`
        with compras as (
          select s.customer_id, s.total
          from public.pos_sales s
          where s.tenant_id = ${tenantId} and not s.voided
            and s.customer_id is not null
            and s.sold_at >= now() - interval '90 days'
          union all
          select o.customer_id, o.total
          from public.sales_orders o
          where o.tenant_id = ${tenantId} and o.status <> 'cancelled'
            and o.created_at >= now() - interval '90 days'
        )
        select c.name, count(*)::text as compras, sum(x.total)::text as importe
        from compras x
        join public.customers c on c.id = x.customer_id
        group by c.name
        order by sum(x.total) desc
        limit 5`
    ).map((r) => ({ name: r.name, compras: Number(r.compras), importe: Number(r.importe) }))
  }

  if (pidieron('po-pending-receipt')) {
    vacio.ordenesPorRecibir = (
      await tx<{ number: string; supplier: string; total: string; estado: string }[]>`
        select po.number, s.name as supplier, po.total::text, po.status as estado
        from public.purchase_orders po
        join public.suppliers s on s.id = po.supplier_id
        where po.tenant_id = ${tenantId}
          and po.status in ('confirmed', 'partially_received')
        order by po.order_date
        limit 5`
    ).map((r) => ({ ...r, total: Number(r.total) }))
  }

  if (pidieron('po-top-suppliers')) {
    vacio.mejoresProveedores = (
      await tx<{ name: string; ordenes: string; importe: string }[]>`
        select s.name, count(*)::text as ordenes, sum(po.total)::text as importe
        from public.purchase_orders po
        join public.suppliers s on s.id = po.supplier_id
        where po.tenant_id = ${tenantId}
          and po.status <> 'cancelled'
          and po.order_date >= now() - interval '90 days'
        group by s.name
        order by sum(po.total) desc
        limit 5`
    ).map((r) => ({ name: r.name, ordenes: Number(r.ordenes), importe: Number(r.importe) }))
  }

  if (pidieron('draft-entries-pending', 'monthly-entries-posted')) {
    const [a] = await tx<{ borrador: string; del_mes: string }[]>`
      select
        count(*) filter (where status = 'draft')                                    as borrador,
        count(*) filter (where status = 'posted'
          and entry_date >= date_trunc('month', current_date))                      as del_mes
      from public.journal_entries where tenant_id = ${tenantId}`
    vacio.asientosBorrador = Number(a?.borrador ?? 0)
    vacio.asientosDelMes = Number(a?.del_mes ?? 0)
  }

  if (pidieron('overdue-payables')) {
    vacio.porPagarVencido = (
      await tx<{ supplier: string; total: string; dias: string }[]>`
        select s.name as supplier,
               public.ap_invoice_balance(i.id)::text as total,
               (current_date - i.due_date)::text as dias
        from public.supplier_invoices i
        join public.suppliers s on s.id = i.supplier_id
        where i.tenant_id = ${tenantId}
          and i.status not in ('paid', 'void')
          and i.due_date < current_date
        order by i.due_date
        limit 5`
    ).map((r) => ({ supplier: r.supplier, total: Number(r.total), dias: Number(r.dias) }))
  }

  if (pidieron('due-this-week')) {
    const [d] = await tx<{ n: string }[]>`
      select count(*)::text as n
      from public.supplier_invoices
      where tenant_id = ${tenantId}
        and status in ('open', 'partially_paid', 'overdue')
        and due_date between current_date and current_date + interval '7 days'`
    vacio.porPagarEstaSemana = Number(d?.n ?? 0)
  }

  if (pidieron('cash-position', 'cash-flow-warning')) {
    const [c] = await tx<{ total: string; cuentas: string }[]>`
      select coalesce(sum(public.bank_account_balance(id)), 0)::text as total,
             count(*)::text as cuentas
      from public.bank_accounts
      where tenant_id = ${tenantId} and is_active`
    vacio.efectivoEnBancos = { total: Number(c?.total ?? 0), cuentas: Number(c?.cuentas ?? 0) }
  }

  if (pidieron('cash-flow-warning')) {
    // Las facturas abiertas de ar/ap: si esos modulos no estan activos, su
    // propia RLS ya devuelve cero filas y la proyeccion queda plana.
    const [cobrar, pagar] = await Promise.all([
      tx<{ due_date: string; saldo: string }[]>`
        select due_date::text, public.invoice_balance(id)::text as saldo
        from public.customer_invoices
        where tenant_id = ${tenantId} and status in ('open', 'partially_paid', 'overdue')`,
      tx<{ due_date: string; saldo: string }[]>`
        select due_date::text, public.ap_invoice_balance(id)::text as saldo
        from public.supplier_invoices
        where tenant_id = ${tenantId} and status in ('open', 'partially_paid', 'overdue')`,
    ])
    const item = (r: { due_date: string; saldo: string }) => ({
      dueDate: new Date(`${r.due_date.slice(0, 10)}T12:00:00`),
      amount: Number(r.saldo),
    })
    const proyeccion = buildCashFlowProjection(
      vacio.efectivoEnBancos.total,
      cobrar.map(item).filter((r) => r.amount > 0),
      pagar.map(item).filter((r) => r.amount > 0),
      new Date(),
      8,
    )
    vacio.flujoEnRojo = {
      semana: firstShortfallWeek(proyeccion),
      efectivoFinal: proyeccion[proyeccion.length - 1]?.runningBalance ?? 0,
    }
  }

  if (pidieron('pending-reconciliation')) {
    vacio.conciliacionPendiente = (
      await tx<{ cuenta: string; pendientes: string; monto: string }[]>`
        select a.account_name as cuenta, count(*)::text as pendientes,
               coalesce(sum(abs(l.amount)), 0)::text as monto
        from public.bank_statement_lines l
        join public.bank_accounts a on a.id = l.bank_account_id
        where l.tenant_id = ${tenantId} and l.match_status = 'pending'
        group by a.account_name
        order by count(*) desc
        limit 5`
    ).map((r) => ({ cuenta: r.cuenta, pendientes: Number(r.pendientes), monto: Number(r.monto) }))
  }

  if (pidieron('last-import-status')) {
    const [u] = await tx<{ cuenta: string; hace: string }[]>`
      select a.account_name as cuenta,
             (current_date - i.period_end)::text as hace
      from public.bank_statement_imports i
      join public.bank_accounts a on a.id = i.bank_account_id
      where i.tenant_id = ${tenantId}
      order by i.period_end desc, i.created_at desc
      limit 1`
    vacio.ultimoImport = u ? { cuenta: u.cuenta, hace: Number(u.hace) } : null
  }

  if (pidieron('fixed-assets-book-value')) {
    const [a] = await tx<{ valor: string }[]>`
      select coalesce(sum(public.fixed_asset_book_value(id)), 0)::text as valor
      from public.fixed_assets where tenant_id = ${tenantId} and status = 'active'`
    vacio.activosValorLibros = Number(a?.valor ?? 0)
  }

  if (pidieron('fixed-assets-due-this-month')) {
    const finDeMes = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth() + 1, 0))
      .toISOString()
      .slice(0, 10)
    const [d] = await tx<{ n: string }[]>`
      select count(*)::text as n
      from public.fixed_assets a
      where a.tenant_id = ${tenantId} and a.status = 'active'
        and not exists (
          select 1 from public.fixed_asset_depreciations dep
          where dep.asset_id = a.id and dep.period_date = ${finDeMes}::date)
        and public.fixed_asset_monthly_depreciation(a.id) > 0`
    vacio.activosPorDepreciarEsteMes = Number(d?.n ?? 0)
  }

  if (pidieron('budget-alerts', 'budget-ytd-variance')) {
    const anoActual = new Date().getFullYear()
    const mesActual = new Date().getMonth() + 1
    const [b] = await tx<{ id: string }[]>`
      select id from public.budgets
      where tenant_id = ${tenantId} and fiscal_year = ${anoActual}
      order by (status = 'active') desc, created_at desc
      limit 1`

    if (b) {
      const filas = await tx<{
        account_id: string
        month: number
        budgeted: string
        total_debit: string
        total_credit: string
        type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
      }[]>`
        with lineas as (
          select account_id, period_month, amount
          from public.budget_lines where budget_id = ${b.id} and tenant_id = ${tenantId}
            and period_month <= ${mesActual}
        ),
        real as (
          select je.account_id, extract(month from e.entry_date)::int as mes,
                 sum(je.debit) as debito, sum(je.credit) as credito
          from public.journal_entry_lines je
          join public.journal_entries e on e.id = je.entry_id and e.status = 'posted'
          where je.tenant_id = ${tenantId} and extract(year from e.entry_date) = ${anoActual}
            and extract(month from e.entry_date) <= ${mesActual}
          group by je.account_id, mes
        ),
        combinado as (
          select coalesce(l.account_id, r.account_id) as account_id,
                 coalesce(l.period_month, r.mes) as month,
                 coalesce(l.amount, 0) as budgeted,
                 coalesce(r.debito, 0) as total_debit,
                 coalesce(r.credito, 0) as total_credit
          from lineas l
          full outer join real r on r.account_id = l.account_id and r.mes = l.period_month
        )
        select c.account_id, c.month, c.budgeted::text, c.total_debit::text, c.total_credit::text, a.type
        from combinado c
        join public.accounts a on a.id = c.account_id`

      const comparativo = buildBudgetVsActual(
        filas.map((f) => ({
          accountId: f.account_id,
          accountType: f.type,
          month: f.month,
          budgeted: Number(f.budgeted),
          totalDebit: Number(f.total_debit),
          totalCredit: Number(f.total_credit),
        })),
      )
      vacio.presupuestoAlertas = comparativo.filter((r) => r.status !== 'ok').length
      vacio.presupuestoYtd = {
        presupuestado: comparativo.reduce((a, r) => a + r.budgeted, 0),
        real: comparativo.reduce((a, r) => a + r.actual, 0),
      }
    }
  }

  if (pidieron('cost-center-top', 'cost-center-total')) {
    const filas = await tx<{ name: string; total: string }[]>`
      select cc.name, coalesce(sum(a.amount), 0)::text as total
      from public.cost_centers cc
      left join public.cost_center_allocations a on a.cost_center_id = cc.id
      where cc.tenant_id = ${tenantId} and cc.is_active
      group by cc.id, cc.name
      order by sum(a.amount) desc nulls last
      limit 5`
    vacio.centrosTop = filas.map((r) => ({ name: r.name, total: Number(r.total) }))

    const [t] = await tx<{ total: string }[]>`
      select coalesce(sum(a.amount), 0)::text as total
      from public.cost_center_allocations a
      where a.tenant_id = ${tenantId}`
    vacio.centrosTotal = Number(t?.total ?? 0)
  }

  if (pidieron('exchange-rate-today', 'rate-staleness')) {
    const filas = await tx<{ code: string; rate: string; rate_date: string }[]>`
      select distinct on (currency_code) currency_code as code, rate::text, rate_date::text
      from public.exchange_rates
      where tenant_id = ${tenantId}
      order by currency_code, rate_date desc`
    const hoy = new Date()
    vacio.tasasHoy = filas.map((f) => ({
      code: f.code,
      rate: Number(f.rate),
      dias: daysSinceRate(new Date(`${f.rate_date.slice(0, 10)}T12:00:00`), hoy),
    }))
    vacio.tasaMasVieja = vacio.tasasHoy.length > 0 ? Math.max(...vacio.tasasHoy.map((t) => t.dias)) : null
  }

  if (pidieron('payment-links-pending')) {
    vacio.linksPendientes = (
      await tx<{ description: string; amount: string }[]>`
        select description, amount::text from public.payment_links
        where tenant_id = ${tenantId} and status = 'pending'
        order by created_at desc
        limit 5`
    ).map((r) => ({ description: r.description, amount: Number(r.amount) }))
  }

  if (pidieron('recurring-charges-due')) {
    const [d] = await tx<{ n: string }[]>`
      select count(*)::text as n
      from public.recurring_charges
      where tenant_id = ${tenantId} and is_active and next_charge_date <= current_date`
    vacio.recurrentesVencidos = Number(d?.n ?? 0)
  }

  if (pidieron('headcount')) {
    const [h] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.employees
      where tenant_id = ${tenantId} and status = 'active'`
    vacio.headcount = Number(h?.n ?? 0)
  }

  if (pidieron('new-hires')) {
    vacio.nuevosIngresos = (
      await tx<{ name: string; hace: string }[]>`
        select first_name || ' ' || last_name as name,
               (current_date - hire_date)::text as hace
        from public.employees
        where tenant_id = ${tenantId} and status = 'active'
          and hire_date >= current_date - interval '30 days'
        order by hire_date desc
        limit 5`
    ).map((r) => ({ name: r.name, hace: Number(r.hace) }))
  }

  if (pidieron('payroll-next-run')) {
    const [p] = await tx<{ period_start: string; period_end: string; pay_date: string }[]>`
      select period_start::text, period_end::text, pay_date::text
      from public.payroll_periods
      where tenant_id = ${tenantId} and status = 'draft'
      order by period_end
      limit 1`
    vacio.proximaNomina = p
      ? {
          periodo: `${p.period_start.slice(0, 10)} – ${p.period_end.slice(0, 10)}`,
          diasFaltan: Math.round(
            (new Date(`${p.pay_date.slice(0, 10)}T00:00:00`).getTime() - Date.now()) / 86_400_000,
          ),
        }
      : null
  }

  if (pidieron('payroll-cost')) {
    const [c] = await tx<{ total: string }[]>`
      select coalesce(sum(l.net_salary), 0)::text as total
      from public.payroll_lines l
      join public.payroll_periods pp on pp.id = l.period_id
      where l.tenant_id = ${tenantId}
        and date_trunc('month', pp.period_end) = date_trunc('month', current_date)`
    vacio.costoNominaMesActual = Number(c?.total ?? 0)
  }

  if (pidieron('attendance-today')) {
    const [a] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.attendance_records
      where tenant_id = ${tenantId} and check_in >= date_trunc('day', now())`
    vacio.marcajesHoy = Number(a?.n ?? 0)
  }

  if (pidieron('late-arrivals')) {
    const filas = await tx<{ name: string; check_in: string }[]>`
      select e.first_name || ' ' || e.last_name as name, ar.check_in::text
      from public.attendance_records ar
      join public.employees e on e.id = ar.employee_id
      where ar.tenant_id = ${tenantId} and ar.check_in >= date_trunc('day', now())
      order by ar.check_in`
    vacio.tardanzasHoy = filas
      .map((f) => {
        const entrada = new Date(f.check_in)
        const esperado = horaEsperadaEnRD(entrada, 8)
        return { name: f.name, minutos: lateMinutes(entrada, esperado) }
      })
      .filter((f) => f.minutos > 0)
      .slice(0, 5)
  }

  if (pidieron('time-off-pending')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.time_off_requests
      where tenant_id = ${tenantId} and status = 'pending'`
    vacio.solicitudesPendientes = Number(p?.n ?? 0)
  }

  if (pidieron('team-out-today')) {
    const filas = await tx<{ name: string; leave_type: string; end_date: string }[]>`
      select e.first_name || ' ' || e.last_name as name, t.leave_type, t.end_date::text
      from public.time_off_requests t
      join public.employees e on e.id = t.employee_id
      where t.tenant_id = ${tenantId} and t.status = 'approved'
        and current_date between t.start_date and t.end_date
      order by t.end_date`
    vacio.fueraHoy = filas.map((f) => ({
      name: f.name,
      tipo: f.leave_type,
      regresa: f.end_date,
    }))
  }

  if (pidieron('expenses-pending')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.expenses
      where tenant_id = ${tenantId} and status = 'submitted'`
    vacio.gastosPorAprobar = Number(p?.n ?? 0)
  }

  if (pidieron('expenses-owed')) {
    const [o] = await tx<{ total: string }[]>`
      select coalesce(sum(amount), 0)::text as total from public.expenses
      where tenant_id = ${tenantId} and status = 'approved'`
    vacio.gastosPorReembolsar = Number(o?.total ?? 0)
  }

  if (pidieron('recent-announcements')) {
    const filas = await tx<{ title: string; published_at: string }[]>`
      select title, published_at::text from public.hr_announcements
      where tenant_id = ${tenantId} order by published_at desc limit 5`
    vacio.anunciosRecientes = filas.map((f) => ({ title: f.title, publicado: f.published_at }))
  }

  if (pidieron('loans-outstanding')) {
    const prestamos = await tx<{ id: string; principal: string }[]>`
      select id, principal::text from public.benefit_loans
      where tenant_id = ${tenantId} and status = 'active'`
    const pagos = await tx<{ loan_id: string; amount: string }[]>`
      select loan_id, amount::text from public.benefit_loan_payments
      where tenant_id = ${tenantId}`
    const pagosPorId = new Map<string, { amount: number }[]>()
    for (const p of pagos) {
      const lista = pagosPorId.get(p.loan_id) ?? []
      lista.push({ amount: Number(p.amount) })
      pagosPorId.set(p.loan_id, lista)
    }
    vacio.prestamosPendientes = prestamos.reduce(
      (acc, p) => acc + saldoPrestamo(Number(p.principal), pagosPorId.get(p.id) ?? []),
      0,
    )
  }

  if (pidieron('benefits-cost')) {
    const inscripciones = await tx<{ status: string; employer_contribution: string }[]>`
      select status, employer_contribution::text from public.benefit_enrollments
      where tenant_id = ${tenantId}`
    vacio.costoBeneficiosMensual = totalAportePatronal(
      inscripciones.map((i) => ({ status: i.status, employer_contribution: Number(i.employer_contribution) })),
    )
  }

  if (pidieron('open-positions')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.recruiting_positions
      where tenant_id = ${tenantId} and status = 'open'`
    vacio.vacantesAbiertas = Number(p?.n ?? 0)
  }

  if (pidieron('pipeline-summary')) {
    const filas = await tx<{ title: string; n: string }[]>`
      select p.title, count(a.id)::text as n
      from public.recruiting_positions p
      join public.recruiting_applications a on a.position_id = p.id
      where p.tenant_id = ${tenantId} and p.status = 'open'
        and a.stage not in ('hired', 'rejected')
      group by p.id, p.title
      order by count(a.id) desc
      limit 5`
    vacio.pipelinePorVacante = filas.map((f) => ({ title: f.title, n: Number(f.n) }))
  }

  if (pidieron('objectives-progress')) {
    const objetivos = await tx<{ id: string; title: string }[]>`
      select id, title from public.performance_objectives
      where tenant_id = ${tenantId} and status = 'active'
      order by created_at desc limit 5`
    const krs = await tx<{ objective_id: string; current_value: string; target_value: string }[]>`
      select objective_id, current_value::text, target_value::text from public.performance_key_results
      where tenant_id = ${tenantId}`
    const krsPorObjetivo = new Map<string, { current: number; target: number }[]>()
    for (const k of krs) {
      const lista = krsPorObjetivo.get(k.objective_id) ?? []
      lista.push({ current: Number(k.current_value), target: Number(k.target_value) })
      krsPorObjetivo.set(k.objective_id, lista)
    }
    vacio.objetivosConProgreso = objetivos.map((o) => ({
      title: o.title,
      progreso: progresoObjetivo(krsPorObjetivo.get(o.id) ?? []),
    }))
  }

  if (pidieron('improvement-plans-active')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.performance_improvement_plans
      where tenant_id = ${tenantId} and status = 'active'`
    vacio.planesDeMejoraActivos = Number(p?.n ?? 0)
  }

  if (pidieron('enrollments-in-progress')) {
    const [en] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.training_enrollments
      where tenant_id = ${tenantId} and status = 'enrolled'`
    vacio.inscripcionesEnCurso = Number(en?.n ?? 0)
  }

  if (pidieron('certificates-expiring')) {
    const filas = await tx<{ employee_name: string; course_title: string; expires_at: string | null }[]>`
      select e.first_name || ' ' || e.last_name as employee_name, c.title as course_title,
             cert.expires_at::text
      from public.training_certificates cert
      join public.training_enrollments en on en.id = cert.enrollment_id
      join public.employees e on e.id = en.employee_id
      join public.training_courses c on c.id = en.course_id
      where cert.tenant_id = ${tenantId} and cert.expires_at is not null
      order by cert.expires_at`
    const hoy = new Date()
    vacio.certificadosPorVencer = filas
      .filter((f) => certificadoVigente(new Date(f.expires_at!), hoy))
      .filter((f) => (new Date(f.expires_at!).getTime() - hoy.getTime()) / 86_400_000 <= 30)
      .map((f) => ({ name: `${f.employee_name} · ${f.course_title}`, vence: f.expires_at! }))
      .slice(0, 5)
  }

  if (pidieron('suppliers-pending-qualification')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.suppliers
      where tenant_id = ${tenantId} and is_active and qualification_status = 'pending'`
    vacio.proveedoresPendientes = Number(p?.n ?? 0)
  }

  if (pidieron('suppliers-expiring-docs')) {
    const filas = await tx<{ supplier_name: string; doc_type: string; expires_at: string | null }[]>`
      select s.name as supplier_name, d.doc_type, d.expires_at::text
      from public.supplier_documents d
      join public.suppliers s on s.id = d.supplier_id
      where d.tenant_id = ${tenantId} and d.expires_at is not null`
    const hoy = new Date()
    vacio.documentosProveedorPorVencer = filas
      .filter((f) => certificadoVigente(new Date(f.expires_at!), hoy))
      .filter((f) => (new Date(f.expires_at!).getTime() - hoy.getTime()) / 86_400_000 <= 30)
      .map((f) => ({ name: `${f.supplier_name} · ${f.doc_type}`, vence: f.expires_at! }))
      .slice(0, 5)
  }

  if (pidieron('active-price-lists')) {
    const filas = await tx<{
      id: string
      scope: string
      channel: string | null
      start_date: string
      end_date: string | null
      status: string
    }[]>`
      select id, scope, channel, start_date::text, end_date::text, status
      from public.price_lists where tenant_id = ${tenantId}`
    const hoy = new Date()
    vacio.listasPrecioVigentes = filas.filter((f) =>
      listaVigente(
        {
          id: f.id,
          scope: f.scope as 'customer' | 'channel' | 'general',
          customerId: null,
          channel: f.channel,
          startDate: new Date(`${f.start_date}T00:00:00`),
          endDate: f.end_date ? new Date(`${f.end_date}T00:00:00`) : null,
          status: f.status,
        },
        hoy,
      ),
    ).length
  }

  if (pidieron('requisitions-pending')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.purchase_requisitions
      where tenant_id = ${tenantId} and status = 'pending'`
    vacio.requisicionesPendientes = Number(p?.n ?? 0)
  }

  if (pidieron('rfqs-open')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.rfqs where tenant_id = ${tenantId} and status = 'open'`
    vacio.rfqsAbiertos = Number(p?.n ?? 0)
  }

  if (pidieron('receipts-with-discrepancies')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.goods_receipts
      where tenant_id = ${tenantId} and status = 'with_discrepancies'`
    vacio.recepcionesConDiscrepancias = Number(p?.n ?? 0)
  }

  if (pidieron('lots-expiring-soon')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.product_lots
      where tenant_id = ${tenantId} and expiry_date is not null
        and expiry_date >= current_date and expiry_date <= current_date + interval '30 days'`
    vacio.lotesPorVencer = Number(p?.n ?? 0)
  }

  if (pidieron('transfers-in-transit')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.transfer_orders
      where tenant_id = ${tenantId} and status = 'in_transit'`
    vacio.transferenciasEnTransito = Number(p?.n ?? 0)
  }

  if (pidieron('cycle-counts-pending-approval')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.cycle_counts
      where tenant_id = ${tenantId} and status = 'pending_approval'`
    vacio.conteosEsperandoAprobacion = Number(p?.n ?? 0)
  }

  if (pidieron('products-without-barcode')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.products
      where tenant_id = ${tenantId} and active and barcode is null`
    vacio.productosSinCodigoBarras = Number(p?.n ?? 0)
  }

  if (pidieron('fleet-maintenance-due')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.vehicles v
      join lateral (
        select next_due_km from public.maintenance_records m
        where m.vehicle_id = v.id and m.next_due_km is not null
        order by m.service_date desc limit 1
      ) ultimo on true
      where v.tenant_id = ${tenantId} and v.status != 'retired'
        and v.odometer_km >= ultimo.next_due_km`
    vacio.vehiculosMantenimientoVencido = Number(p?.n ?? 0)
  }

  if (pidieron('routes-in-progress')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.delivery_routes
      where tenant_id = ${tenantId} and status = 'in_progress'`
    vacio.rutasEnProgreso = Number(p?.n ?? 0)
  }

  if (pidieron('boms-active')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.bill_of_materials
      where tenant_id = ${tenantId} and status = 'active'`
    vacio.bomsActivos = Number(p?.n ?? 0)
  }

  if (pidieron('production-orders-in-progress')) {
    const [p] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.production_orders
      where tenant_id = ${tenantId} and status in ('released', 'in_progress')`
    vacio.ordenesProduccionEnProgreso = Number(p?.n ?? 0)
  }

  if (pidieron('catalog-completeness')) {
    const [c] = await tx<{ sin_precio: string; sin_categoria: string; total: string }[]>`
    select count(*) filter (where price is null or price = 0)::text as sin_precio,
           count(*) filter (where category_id is null)::text        as sin_categoria,
           count(*)::text                                           as total
      from public.products where tenant_id = ${tenantId} and active`
    vacio.catalogoIncompleto = {
      sinPrecio: Number(c?.sin_precio ?? 0),
      sinCategoria: Number(c?.sin_categoria ?? 0),
      total: Number(c?.total ?? 0),
    }
  }

  return vacio
}

function Vacio({ children }: { children: string }) {
  return <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">{children}</p>
}

function Fila({
  izq,
  der,
  sub,
  tono,
}: {
  izq: string
  der: string
  sub?: string
  tono?: 'danger' | 'warning'
}) {
  return (
    <li className="flex items-baseline justify-between gap-2 border-b border-[var(--color-border-subtle)] py-1.5 last:border-0">
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">
        {izq}
        {sub && <span className="ml-1.5 text-[var(--color-text-muted)]">{sub}</span>}
      </span>
      <span
        className={`tabular shrink-0 text-xs font-semibold ${
          tono === 'danger'
            ? 'text-[var(--color-semantic-text-danger)]'
            : tono === 'warning'
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
        }`}
      >
        {der}
      </span>
    </li>
  )
}

/** Clave declarada en el manifest → como se dibuja. */
const WIDGETS: Record<
  string,
  { titulo: string; icono: string; render: (d: DatosWidgets, qs: string) => React.ReactNode }
> = {
  'stock-alerts': {
    titulo: 'Bajo el punto de reorden',
    icono: 'inventory_2',
    render: (d) =>
      d.stockBajo.length === 0 ? (
        <Vacio>Nada por reponer. Asi debe verse.</Vacio>
      ) : (
        <ul>
          {d.stockBajo.map((p) => (
            <Fila
              key={p.sku}
              izq={p.name}
              sub={p.sku}
              der={`${p.qty} / ${p.punto}`}
              tono={p.qty <= 0 ? 'danger' : 'warning'}
            />
          ))}
        </ul>
      ),
  },

  'inventory-value': {
    titulo: 'Valor del inventario',
    icono: 'savings',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.valorInventario)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          a costo promedio ponderado
        </span>
      </p>
    ),
  },

  'sales-today': {
    titulo: 'Vendido hoy en caja',
    icono: 'point_of_sale',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.ventasHoy.total)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.ventasHoy.tickets} ticket{d.ventasHoy.tickets === 1 ? '' : 's'} desde medianoche
        </span>
      </p>
    ),
  },

  'open-shifts': {
    titulo: 'Turnos abiertos',
    icono: 'lock_clock',
    render: (d) =>
      d.turnosAbiertos.length === 0 ? (
        <Vacio>Ninguna caja abierta.</Vacio>
      ) : (
        <ul>
          {d.turnosAbiertos.map((t, i) => (
            <Fila
              key={i}
              izq={t.warehouse}
              sub={t.cajero}
              der={new Date(t.desde).toLocaleTimeString('es-DO', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            />
          ))}
        </ul>
      ),
  },

  'pending-orders': {
    titulo: 'Pedidos por entregar',
    icono: 'receipt_long',
    render: (d) =>
      d.pedidosPendientes.length === 0 ? (
        <Vacio>Todo entregado.</Vacio>
      ) : (
        <ul>
          {d.pedidosPendientes.map((p) => (
            <Fila key={p.number} izq={p.customer} sub={p.number} der={money(p.total)} />
          ))}
        </ul>
      ),
  },

  'backorder-list': {
    titulo: 'Lineas en backorder',
    icono: 'pending_actions',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.backorder > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.backorder}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.backorder === 0
            ? 'nada prometido sin existencia'
            : 'prometidas sin existencia para cubrirlas'}
        </span>
      </p>
    ),
  },

  'overdue-receivables': {
    titulo: 'Vencido por cobrar',
    icono: 'running_with_errors',
    render: (d) =>
      d.vencidas.length === 0 ? (
        <Vacio>Nadie en mora.</Vacio>
      ) : (
        <ul>
          {d.vencidas.map((v, i) => (
            <Fila
              key={i}
              izq={v.customer}
              sub={`${v.dias} d`}
              der={money(v.total)}
              tono={v.dias > 60 ? 'danger' : 'warning'}
            />
          ))}
        </ul>
      ),
  },

  'aging-summary': {
    titulo: 'Antiguedad de cartera',
    icono: 'monitoring',
    render: (d, qs) => (
      <div className="py-2">
        <p className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.vencidas.reduce((s, v) => s + v.total, 0))}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">vencido en total</p>
        <a
          href={`/cobrar/cartera${qs}`}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-text-link)] hover:underline"
        >
          Ver el reparto por tramo
          <Icon name="arrow_forward" size={14} />
        </a>
      </div>
    ),
  },

  'catalog-completeness': {
    titulo: 'Catalogo por completar',
    icono: 'fact_check',
    render: (d) => {
      const pendiente = d.catalogoIncompleto.sinPrecio + d.catalogoIncompleto.sinCategoria
      return pendiente === 0 ? (
        <Vacio>Catalogo completo.</Vacio>
      ) : (
        <ul>
          {d.catalogoIncompleto.sinPrecio > 0 && (
            <Fila izq="Sin precio" der={String(d.catalogoIncompleto.sinPrecio)} tono="danger" />
          )}
          {d.catalogoIncompleto.sinCategoria > 0 && (
            <Fila
              izq="Sin categoria"
              der={String(d.catalogoIncompleto.sinCategoria)}
              tono="warning"
            />
          )}
          <Fila izq="Productos activos" der={String(d.catalogoIncompleto.total)} />
        </ul>
      )
    },
  },

  'po-pending-receipt': {
    titulo: 'Compras por recibir',
    icono: 'local_shipping',
    render: (d) =>
      d.ordenesPorRecibir.length === 0 ? (
        <Vacio>Nada esperando en camino.</Vacio>
      ) : (
        <ul>
          {d.ordenesPorRecibir.map((o) => (
            <Fila
              key={o.number}
              izq={o.supplier}
              sub={o.number}
              der={money(o.total)}
              {...(o.estado === 'partially_received' ? { tono: 'warning' as const } : {})}
            />
          ))}
        </ul>
      ),
  },

  'po-top-suppliers': {
    titulo: 'Mejores proveedores (90 dias)',
    icono: 'groups',
    render: (d) =>
      d.mejoresProveedores.length === 0 ? (
        <Vacio>Sin compras confirmadas en los ultimos 90 dias.</Vacio>
      ) : (
        <ul>
          {d.mejoresProveedores.map((p) => (
            <Fila
              key={p.name}
              izq={p.name}
              sub={`${p.ordenes} orden${p.ordenes === 1 ? '' : 'es'}`}
              der={money(p.importe)}
            />
          ))}
        </ul>
      ),
  },

  'overdue-payables': {
    titulo: 'Vencido por pagar',
    icono: 'request_page',
    render: (d) =>
      d.porPagarVencido.length === 0 ? (
        <Vacio>Nadie te esta esperando.</Vacio>
      ) : (
        <ul>
          {d.porPagarVencido.map((v, i) => (
            <Fila
              key={i}
              izq={v.supplier}
              sub={`${v.dias} d`}
              der={money(v.total)}
              tono={v.dias > 30 ? 'danger' : 'warning'}
            />
          ))}
        </ul>
      ),
  },

  'due-this-week': {
    titulo: 'Vence esta semana',
    icono: 'event_upcoming',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.porPagarEstaSemana > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.porPagarEstaSemana}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          factura{d.porPagarEstaSemana === 1 ? '' : 's'} de proveedor en los proximos 7 dias
        </span>
      </p>
    ),
  },

  'cash-position': {
    titulo: 'Efectivo en bancos',
    icono: 'account_balance',
    render: (d) =>
      d.efectivoEnBancos.cuentas === 0 ? (
        <Vacio>Todavia no hay cuentas bancarias registradas.</Vacio>
      ) : (
        <p className="py-2">
          <span
            className={`tabular text-2xl font-semibold ${
              d.efectivoEnBancos.total < 0
                ? 'text-[var(--color-semantic-text-danger)]'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            RD$ {money(d.efectivoEnBancos.total)}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            en {d.efectivoEnBancos.cuentas} cuenta{d.efectivoEnBancos.cuentas === 1 ? '' : 's'}{' '}
            activa{d.efectivoEnBancos.cuentas === 1 ? '' : 's'}
          </span>
        </p>
      ),
  },

  'cash-flow-warning': {
    titulo: 'Flujo de caja a 8 semanas',
    icono: 'ssid_chart',
    render: (d) =>
      d.flujoEnRojo.semana === null ? (
        <p className="py-2">
          <span className="tabular text-2xl font-semibold text-[var(--color-semantic-text-success)]">
            RD$ {money(d.flujoEnRojo.efectivoFinal)}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            proyectado al cierre, sin semanas en rojo
          </span>
        </p>
      ) : (
        <p className="py-2">
          <span className="tabular text-2xl font-semibold text-[var(--color-semantic-text-danger)]">
            Semana {d.flujoEnRojo.semana + 1}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            el efectivo se pone en rojo: adelanta cobros o corre pagos
          </span>
        </p>
      ),
  },

  'pending-reconciliation': {
    titulo: 'Conciliacion pendiente',
    icono: 'compare_arrows',
    render: (d) =>
      d.conciliacionPendiente.length === 0 ? (
        <Vacio>Nada esperando conciliarse.</Vacio>
      ) : (
        <ul>
          {d.conciliacionPendiente.map((c, i) => (
            <Fila key={i} izq={c.cuenta} sub={`${c.pendientes} linea(s)`} der={money(c.monto)} tono="warning" />
          ))}
        </ul>
      ),
  },

  'last-import-status': {
    titulo: 'Ultimo estado importado',
    icono: 'history',
    render: (d) =>
      d.ultimoImport === null ? (
        <Vacio>Todavia no se ha importado ningun estado de cuenta.</Vacio>
      ) : (
        <p className="py-2">
          <span
            className={`tabular text-2xl font-semibold ${
              d.ultimoImport.hace > 35
                ? 'text-[var(--color-semantic-text-warning)]'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {d.ultimoImport.hace} dias
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            desde el cierre del ultimo import de {d.ultimoImport.cuenta}
          </span>
        </p>
      ),
  },

  'fixed-assets-book-value': {
    titulo: 'Activos fijos en libros',
    icono: 'directions_car',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.activosValorLibros)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          valor en libros de los activos activos
        </span>
      </p>
    ),
  },

  'fixed-assets-due-this-month': {
    titulo: 'Depreciacion pendiente este mes',
    icono: 'event_repeat',
    render: (d) =>
      d.activosPorDepreciarEsteMes === 0 ? (
        <Vacio>Nada pendiente por correr este mes.</Vacio>
      ) : (
        <p className="py-2">
          <span className="tabular text-2xl font-semibold text-[var(--color-semantic-text-warning)]">
            {d.activosPorDepreciarEsteMes}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            activo{d.activosPorDepreciarEsteMes === 1 ? '' : 's'} sin depreciar todavia este mes
          </span>
        </p>
      ),
  },

  'budget-alerts': {
    titulo: 'Cuentas cerca o sobre presupuesto',
    icono: 'warning',
    render: (d) =>
      d.presupuestoAlertas === 0 ? (
        <Vacio>Nada en alerta este ano.</Vacio>
      ) : (
        <p className="py-2">
          <span className="tabular text-2xl font-semibold text-[var(--color-semantic-text-warning)]">
            {d.presupuestoAlertas}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            cuenta-mes cerca o por encima de lo planeado
          </span>
        </p>
      ),
  },

  'budget-ytd-variance': {
    titulo: 'Presupuesto del ano hasta hoy',
    icono: 'savings',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-lg font-semibold text-[var(--color-text-primary)]">
          {money(d.presupuestoYtd.real)}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]"> de {money(d.presupuestoYtd.presupuestado)}</span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">real contra presupuestado</span>
      </p>
    ),
  },

  'cost-center-top': {
    titulo: 'Centros con mas gasto',
    icono: 'call_split',
    render: (d) =>
      d.centrosTop.length === 0 ? (
        <Vacio>Nada asignado todavia.</Vacio>
      ) : (
        <ul>
          {d.centrosTop.map((c, i) => (
            <Fila key={i} izq={c.name} der={money(c.total)} />
          ))}
        </ul>
      ),
  },

  'cost-center-total': {
    titulo: 'Total asignado a centros',
    icono: 'account_tree',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.centrosTotal)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          repartido entre {d.centrosTop.length} centro{d.centrosTop.length === 1 ? '' : 's'}
        </span>
      </p>
    ),
  },

  'exchange-rate-today': {
    titulo: 'Ultimas tasas capturadas',
    icono: 'currency_exchange',
    render: (d) =>
      d.tasasHoy.length === 0 ? (
        <Vacio>Ninguna tasa capturada todavia.</Vacio>
      ) : (
        <ul>
          {d.tasasHoy.map((t, i) => (
            <Fila key={i} izq={t.code} der={money(t.rate)} />
          ))}
        </ul>
      ),
  },

  'rate-staleness': {
    titulo: 'Tasa mas atrasada',
    icono: 'schedule',
    render: (d) =>
      d.tasaMasVieja === null ? (
        <Vacio>Sin tasas para medir.</Vacio>
      ) : (
        <p className="py-2">
          <span
            className={`tabular text-2xl font-semibold ${
              d.tasaMasVieja > 7
                ? 'text-[var(--color-semantic-text-warning)]'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {d.tasaMasVieja} dias
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            desde la captura mas atrasada
          </span>
        </p>
      ),
  },

  'payment-links-pending': {
    titulo: 'Links de cobro pendientes',
    icono: 'payments',
    render: (d) =>
      d.linksPendientes.length === 0 ? (
        <Vacio>Nada pendiente por cobrar.</Vacio>
      ) : (
        <ul>
          {d.linksPendientes.map((l, i) => (
            <Fila key={i} izq={l.description} der={money(l.amount)} tono="warning" />
          ))}
        </ul>
      ),
  },

  'recurring-charges-due': {
    titulo: 'Cobros recurrentes vencidos',
    icono: 'event_repeat',
    render: (d) =>
      d.recurrentesVencidos === 0 ? (
        <Vacio>Nada vencido todavia.</Vacio>
      ) : (
        <p className="py-2">
          <span className="tabular text-2xl font-semibold text-[var(--color-semantic-text-warning)]">
            {d.recurrentesVencidos}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            listo{d.recurrentesVencidos === 1 ? '' : 's'} para generar su link
          </span>
        </p>
      ),
  },

  'headcount': {
    titulo: 'Empleados activos',
    icono: 'badge',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.headcount}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">en nomina hoy</span>
      </p>
    ),
  },

  'new-hires': {
    titulo: 'Ingresos recientes',
    icono: 'person_add',
    render: (d) =>
      d.nuevosIngresos.length === 0 ? (
        <Vacio>Nadie nuevo en los ultimos 30 dias.</Vacio>
      ) : (
        <ul>
          {d.nuevosIngresos.map((n, i) => (
            <Fila key={i} izq={n.name} der={`hace ${n.hace} d`} />
          ))}
        </ul>
      ),
  },

  'payroll-next-run': {
    titulo: 'Proximo periodo de nomina',
    icono: 'event',
    render: (d) =>
      d.proximaNomina === null ? (
        <Vacio>Nada en borrador todavia.</Vacio>
      ) : (
        <p className="py-2">
          <span
            className={`tabular text-2xl font-semibold ${
              d.proximaNomina.diasFaltan <= 3
                ? 'text-[var(--color-semantic-text-warning)]'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {d.proximaNomina.diasFaltan} dias
          </span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            para pagar {d.proximaNomina.periodo}
          </span>
        </p>
      ),
  },

  'payroll-cost': {
    titulo: 'Costo de nomina este mes',
    icono: 'group',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.costoNominaMesActual)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">neto pagado este mes</span>
      </p>
    ),
  },

  'attendance-today': {
    titulo: 'Marcajes de hoy',
    icono: 'fingerprint',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.marcajesHoy}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">entradas y salidas hoy</span>
      </p>
    ),
  },

  'late-arrivals': {
    titulo: 'Tardanzas de hoy',
    icono: 'schedule',
    render: (d) =>
      d.tardanzasHoy.length === 0 ? (
        <Vacio>Nadie llego tarde hoy.</Vacio>
      ) : (
        <ul>
          {d.tardanzasHoy.map((t, i) => (
            <Fila key={i} izq={t.name} der={`${t.minutos} min`} tono="danger" />
          ))}
        </ul>
      ),
  },

  'time-off-pending': {
    titulo: 'Solicitudes por aprobar',
    icono: 'beach_access',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.solicitudesPendientes > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.solicitudesPendientes}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.solicitudesPendientes === 0 ? 'nada pendiente' : 'esperando aprobacion'}
        </span>
      </p>
    ),
  },

  'team-out-today': {
    titulo: 'Fuera hoy',
    icono: 'event_busy',
    render: (d) =>
      d.fueraHoy.length === 0 ? (
        <Vacio>Nadie del equipo esta fuera hoy.</Vacio>
      ) : (
        <ul>
          {d.fueraHoy.map((f, i) => (
            <Fila key={i} izq={f.name} der={`regresa ${fechaCortaUTC(f.regresa)}`} />
          ))}
        </ul>
      ),
  },

  'expenses-pending': {
    titulo: 'Gastos por aprobar',
    icono: 'receipt_long',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.gastosPorAprobar > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.gastosPorAprobar}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.gastosPorAprobar === 0 ? 'nada pendiente' : 'esperando aprobacion'}
        </span>
      </p>
    ),
  },

  'expenses-owed': {
    titulo: 'Por reembolsar',
    icono: 'payments',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.gastosPorReembolsar)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          aprobado, todavia sin pagar
        </span>
      </p>
    ),
  },

  'recent-announcements': {
    titulo: 'Anuncios recientes',
    icono: 'campaign',
    render: (d) =>
      d.anunciosRecientes.length === 0 ? (
        <Vacio>Todavia no hay ningun anuncio.</Vacio>
      ) : (
        <ul>
          {d.anunciosRecientes.map((a, i) => (
            <Fila key={i} izq={a.title} der={fechaCortaUTC(a.publicado.slice(0, 10))} />
          ))}
        </ul>
      ),
  },

  'loans-outstanding': {
    titulo: 'Prestamos pendientes',
    icono: 'volunteer_activism',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.prestamosPendientes)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">saldo activo total</span>
      </p>
    ),
  },

  'benefits-cost': {
    titulo: 'Costo de beneficios',
    icono: 'health_and_safety',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          RD$ {money(d.costoBeneficiosMensual)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">aporte patronal mensual</span>
      </p>
    ),
  },

  'open-positions': {
    titulo: 'Vacantes abiertas',
    icono: 'work',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.vacantesAbiertas}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.vacantesAbiertas === 0 ? 'ninguna vacante abierta' : 'buscando candidatos'}
        </span>
      </p>
    ),
  },

  'pipeline-summary': {
    titulo: 'Candidatos en proceso',
    icono: 'groups',
    render: (d) =>
      d.pipelinePorVacante.length === 0 ? (
        <Vacio>Ninguna vacante abierta tiene candidatos en proceso.</Vacio>
      ) : (
        <ul>
          {d.pipelinePorVacante.map((p, i) => (
            <Fila key={i} izq={p.title} der={String(p.n)} />
          ))}
        </ul>
      ),
  },

  'objectives-progress': {
    titulo: 'Progreso de objetivos',
    icono: 'trending_up',
    render: (d) =>
      d.objetivosConProgreso.length === 0 ? (
        <Vacio>Ningun objetivo activo todavia.</Vacio>
      ) : (
        <ul>
          {d.objetivosConProgreso.map((o, i) => (
            <Fila key={i} izq={o.title} der={`${o.progreso}%`} />
          ))}
        </ul>
      ),
  },

  'improvement-plans-active': {
    titulo: 'Planes de mejora activos',
    icono: 'assignment',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.planesDeMejoraActivos > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.planesDeMejoraActivos}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.planesDeMejoraActivos === 0 ? 'nadie en plan de mejora' : 'en seguimiento'}
        </span>
      </p>
    ),
  },

  'enrollments-in-progress': {
    titulo: 'Inscripciones en curso',
    icono: 'school',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.inscripcionesEnCurso}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">sin nota registrada todavia</span>
      </p>
    ),
  },

  'certificates-expiring': {
    titulo: 'Certificados por vencer',
    icono: 'workspace_premium',
    render: (d) =>
      d.certificadosPorVencer.length === 0 ? (
        <Vacio>Ningun certificado vence en los proximos 30 dias.</Vacio>
      ) : (
        <ul>
          {d.certificadosPorVencer.map((c, i) => (
            <Fila key={i} izq={c.name} der={fechaCortaUTC(c.vence.slice(0, 10))} tono="warning" />
          ))}
        </ul>
      ),
  },

  'suppliers-pending-qualification': {
    titulo: 'Proveedores por homologar',
    icono: 'local_shipping',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.proveedoresPendientes > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.proveedoresPendientes}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.proveedoresPendientes === 0 ? 'todos homologados' : 'pendientes de revisar'}
        </span>
      </p>
    ),
  },

  'suppliers-expiring-docs': {
    titulo: 'Documentos de proveedor por vencer',
    icono: 'description',
    render: (d) =>
      d.documentosProveedorPorVencer.length === 0 ? (
        <Vacio>Ningun documento vence en los proximos 30 dias.</Vacio>
      ) : (
        <ul>
          {d.documentosProveedorPorVencer.map((doc, i) => (
            <Fila key={i} izq={doc.name} der={fechaCortaUTC(doc.vence.slice(0, 10))} tono="warning" />
          ))}
        </ul>
      ),
  },

  'active-price-lists': {
    titulo: 'Listas de precio vigentes',
    icono: 'sell',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.listasPrecioVigentes}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">activas hoy</span>
      </p>
    ),
  },

  'requisitions-pending': {
    titulo: 'Requisiciones por aprobar',
    icono: 'assignment',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.requisicionesPendientes > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.requisicionesPendientes}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.requisicionesPendientes === 0 ? 'nada pendiente' : 'esperando aprobacion'}
        </span>
      </p>
    ),
  },

  'rfqs-open': {
    titulo: 'RFQ abiertos',
    icono: 'compare_arrows',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">{d.rfqsAbiertos}</span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">esperando cotizaciones</span>
      </p>
    ),
  },

  'receipts-with-discrepancies': {
    titulo: 'Recepciones con discrepancia',
    icono: 'inventory_2',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.recepcionesConDiscrepancias}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.recepcionesConDiscrepancias === 0 ? 'todo coincidio' : 'llego distinto a lo esperado'}
        </span>
      </p>
    ),
  },

  'lots-expiring-soon': {
    titulo: 'Lotes por vencer',
    icono: 'qr_code_2',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.lotesPorVencer}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.lotesPorVencer === 0 ? 'nada por vencer en 30 dias' : 'vencen en 30 dias o menos'}
        </span>
      </p>
    ),
  },

  'transfers-in-transit': {
    titulo: 'Transferencias en transito',
    icono: 'local_shipping',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.transferenciasEnTransito}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.transferenciasEnTransito === 0 ? 'nada en camino' : 'esperando confirmar recepcion'}
        </span>
      </p>
    ),
  },

  'cycle-counts-pending-approval': {
    titulo: 'Conteos esperando aprobacion',
    icono: 'checklist',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.conteosEsperandoAprobacion}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.conteosEsperandoAprobacion === 0 ? 'nada pendiente' : 'esperando revisar la diferencia'}
        </span>
      </p>
    ),
  },

  'products-without-barcode': {
    titulo: 'Productos sin codigo de barras',
    icono: 'qr_code_scanner',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.productosSinCodigoBarras}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.productosSinCodigoBarras === 0 ? 'todos tienen codigo' : 'listos para generar'}
        </span>
      </p>
    ),
  },

  'fleet-maintenance-due': {
    titulo: 'Vehiculos con mantenimiento vencido',
    icono: 'local_shipping',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.vehiculosMantenimientoVencido}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.vehiculosMantenimientoVencido === 0 ? 'todo al dia' : 'ya alcanzaron el kilometraje'}
        </span>
      </p>
    ),
  },

  'routes-in-progress': {
    titulo: 'Rutas en progreso',
    icono: 'route',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.rutasEnProgreso}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.rutasEnProgreso === 0 ? 'nada en reparto' : 'en reparto ahora'}
        </span>
      </p>
    ),
  },

  'boms-active': {
    titulo: 'Listas de materiales activas',
    icono: 'account_tree',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.bomsActivos}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">recetas en uso</span>
      </p>
    ),
  },

  'production-orders-in-progress': {
    titulo: 'Ordenes de produccion en progreso',
    icono: 'precision_manufacturing',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.ordenesProduccionEnProgreso}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.ordenesProduccionEnProgreso === 0 ? 'nada en piso' : 'produciendo ahora'}
        </span>
      </p>
    ),
  },

  'draft-entries-pending': {
    titulo: 'Asientos sin contabilizar',
    icono: 'edit_note',
    render: (d) => (
      <p className="py-2">
        <span
          className={`tabular text-2xl font-semibold ${
            d.asientosBorrador > 0
              ? 'text-[var(--color-semantic-text-warning)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {d.asientosBorrador}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          {d.asientosBorrador === 0
            ? 'todo lo capturado ya se contabilizo'
            : 'en borrador, sin afectar la balanza todavia'}
        </span>
      </p>
    ),
  },

  'monthly-entries-posted': {
    titulo: 'Asientos contabilizados este mes',
    icono: 'account_balance',
    render: (d) => (
      <p className="py-2">
        <span className="tabular text-2xl font-semibold text-[var(--color-text-primary)]">
          {d.asientosDelMes}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">desde el dia 1</span>
      </p>
    ),
  },

  'top-products': {
    titulo: 'Mas vendidos (30 dias)',
    icono: 'trending_up',
    render: (d) =>
      d.masVendidos.length === 0 ? (
        <Vacio>Todavia no hay ventas en los ultimos 30 dias.</Vacio>
      ) : (
        <ul>
          {d.masVendidos.map((p) => (
            <Fila key={p.name} izq={p.name} sub={`${p.unidades} u`} der={money(p.importe)} />
          ))}
        </ul>
      ),
  },

  'top-customers': {
    titulo: 'Mejores clientes (90 dias)',
    icono: 'groups',
    render: (d) =>
      d.mejoresClientes.length === 0 ? (
        <Vacio>Sin compras con cliente identificado. En mostrador es lo normal.</Vacio>
      ) : (
        <ul>
          {d.mejoresClientes.map((c) => (
            <Fila
              key={c.name}
              izq={c.name}
              sub={`${c.compras} compra${c.compras === 1 ? '' : 's'}`}
              der={money(c.importe)}
            />
          ))}
        </ul>
      ),
  },
}

/** Dibuja una clave de widget. Clave desconocida = aviso, nunca una caida. */
export function Widget({ clave, datos, qs }: { clave: string; datos: DatosWidgets; qs: string }) {
  const w = WIDGETS[clave]
  if (!w) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Mono>{clave}</Mono>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Badge tone="warning">sin renderizador</Badge>
        </CardBody>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon name={w.icono} size={18} className="text-[var(--color-text-muted)]" />
          {w.titulo}
        </CardTitle>
      </CardHeader>
      <CardBody>{w.render(datos, qs)}</CardBody>
    </Card>
  )
}

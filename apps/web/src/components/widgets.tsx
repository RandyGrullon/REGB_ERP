import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, Mono } from '@regb/ui'
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
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

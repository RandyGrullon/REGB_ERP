import Link from 'next/link'
import {
  EmptyState,
  FilterSelect,
  Icon,
  Mono,
  SearchField,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import { cargarInventarioDatos } from '@/lib/control-datos'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Todo el dato · REGB Control' }

/**
 * Inventario de datos: cuantas filas tiene cada cliente en cada tabla.
 *
 * Existe para responder una pregunta concreta que ninguna otra pantalla
 * responde: "¿este cliente esta usando de verdad lo que paga?". Un tenant
 * con el modulo de inventario activo y cero movimientos no es un cliente,
 * es una renovacion que se va a caer.
 *
 * La lista de tablas sale del catalogo de Postgres, no de una constante:
 * si manana aparece una tabla nueva con `tenant_id`, aparece aqui sola.
 * Una lista escrita a mano es justo el mecanismo por el que un dato acaba
 * invisible en el panel que promete ensenarlo todo.
 */

interface Params {
  q?: string
  tenant?: string
  vacias?: string
}

/** Agrupacion por prefijo: 30 tablas en una tabla plana no se leen. */
const GRUPOS: { titulo: string; icono: string; test: (t: string) => boolean }[] = [
  {
    titulo: 'Organizacion',
    icono: 'apartment',
    test: (t) =>
      [
        'companies',
        'branches',
        'roles',
        'memberships',
        'user_profiles',
        'tenant_settings',
      ].includes(t),
  },
  { titulo: 'Catálogo', icono: 'inventory_2', test: (t) => t.startsWith('product') },
  {
    titulo: 'Inventario',
    icono: 'warehouse',
    test: (t) => t.startsWith('stock') || t.startsWith('warehouse') || t.startsWith('inventory'),
  },
  {
    titulo: 'Pedidos',
    icono: 'receipt_long',
    test: (t) => t.startsWith('sales_order') || t === 'customers',
  },
  { titulo: 'Caja', icono: 'point_of_sale', test: (t) => t.startsWith('pos_') },
  {
    titulo: 'Cobros y fiscal',
    icono: 'request_quote',
    test: (t) => t.startsWith('customer_') || t === 'ncf_sequences',
  },
  {
    titulo: 'Plataforma',
    icono: 'settings',
    test: (t) =>
      [
        'files',
        'notifications',
        // Quien leyo que aviso (0125): una fila por persona y aviso de equipo.
        'notification_reads',
        'backups',
        'import_batches',
        'event_outbox',
        'tour_progress',
      ].includes(t),
  },
]

const bytes = (n: number): string => {
  if (n === 0) return '0'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1)
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

export default async function DatosPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireProvider()
  const p = await searchParams

  const inv = await cargarInventarioDatos()
  const tenants = await db()<
    { id: string; slug: string; legal_name: string; tier: string; status: string }[]
  >`
    select id::text, slug, legal_name, tier, status
    from regb.tenants where status <> 'archived' order by legal_name`

  const q = (p.q ?? '').trim().toLowerCase()
  const soloTenant = p.tenant ?? ''
  const ocultarVacias = p.vacias !== '1'

  const visibles = tenants.filter((t) => (soloTenant === '' ? true : t.slug === soloTenant))
  const tablasVisibles = inv.tablas.filter((t) => {
    if (q !== '' && !t.includes(q)) return false
    if (ocultarVacias && (inv.totalPorTabla.get(t) ?? 0) === 0) return false
    return true
  })

  const grupos = GRUPOS.map((g) => ({
    ...g,
    tablas: tablasVisibles.filter((t) => g.test(t)),
  })).filter((g) => g.tablas.length > 0)

  const yaAgrupadas = new Set(grupos.flatMap((g) => g.tablas))
  const sueltas = tablasVisibles.filter((t) => !yaAgrupadas.has(t))
  if (sueltas.length > 0) {
    grupos.push({ titulo: 'Otras', icono: 'table', test: () => false, tablas: sueltas })
  }

  const totalFilas = [...inv.totalPorTabla.values()].reduce((a, b) => a + b, 0)
  const totalBytes = [...inv.bytesPorTenant.values()].reduce((a, b) => a + b, 0)
  const totalAudit = [...inv.auditPorTenant.values()].reduce((a, b) => a + b, 0)
  const hayFiltro = Boolean(p.q || p.tenant || p.vacias)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Icon name="database" size={22} className="text-[var(--color-accent-plum)]" />
          Todo el dato
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Cuántos registros tiene cada cliente en cada tabla. Sirve para ver quién usa de verdad lo
          que paga: un módulo activo sin registros es una renovación que se va a caer.
        </p>
      </div>

      <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tablas de clientes"
          value={String(inv.tablas.length)}
          hint="todas las que guardan datos de un cliente"
        />
        <StatCard
          label="Registros"
          value={totalFilas.toLocaleString('es-DO')}
          hint="de todos los clientes"
        />
        <StatCard label="Archivos" value={bytes(totalBytes)} hint="lo que pesan sus archivos" />
        <StatCard
          label="Bitácora"
          value={totalAudit.toLocaleString('es-DO')}
          hint="movimientos auditados"
        />
      </section>

      <Toolbar>
        <SearchField
          name="q"
          defaultValue={p.q ?? ''}
          label="Buscar tabla"
          placeholder="products, pos_sales…"
        />
        <FilterSelect label="Cliente" name="tenant" defaultValue={soloTenant} className="w-56">
          <option value="">Todos los clientes</option>
          {tenants.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.legal_name}
            </option>
          ))}
        </FilterSelect>
        <label className="flex h-10 items-center gap-1.5 self-end text-xs text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            name="vacias"
            value="1"
            defaultChecked={p.vacias === '1'}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          Mostrar tablas vacias
        </label>
        <ToolbarActions hasFilters={hayFiltro} clearHref="/control/datos" />
      </Toolbar>

      {visibles.length === 0 || grupos.length === 0 ? (
        <EmptyState
          icon="filter_alt_off"
          title="Nada que mostrar con ese filtro"
          description="Si buscaste una tabla que existe pero esta vacia, marca 'Mostrar tablas vacias'."
        />
      ) : (
        <>
          <section aria-label="Resumen por cliente">
            <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
              Peso de cada cliente
            </h2>
            <Table>
              <THead>
                <TR>
                  <TH>Cliente</TH>
                  <TH>Tier</TH>
                  <TH numeric>Filas totales</TH>
                  <TH numeric>Tablas con datos</TH>
                  <TH numeric>Archivos</TH>
                  <TH numeric>Bitácora</TH>
                </TR>
              </THead>
              <TBody>
                {visibles.map((t) => {
                  const m = inv.porTenant.get(t.id) ?? new Map()
                  const filas = [...m.values()].reduce((a, b) => a + b, 0)
                  const conDatos = [...m.values()].filter((v) => v > 0).length
                  return (
                    <TR key={t.id}>
                      <TD>
                        <Link
                          href={`/control/${t.slug}`}
                          className="font-medium text-[var(--color-text-link)] hover:underline"
                        >
                          {t.legal_name}
                        </Link>
                      </TD>
                      <TD>{t.tier}</TD>
                      <TD numeric>
                        <span className="tabular font-semibold">
                          {filas.toLocaleString('es-DO')}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {conDatos}
                          <span className="text-[var(--color-text-muted)]">
                            /{inv.tablas.length}
                          </span>
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{bytes(inv.bytesPorTenant.get(t.id) ?? 0)}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {(inv.auditPorTenant.get(t.id) ?? 0).toLocaleString('es-DO')}
                        </span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </section>

          {grupos.map((g) => (
            <section key={g.titulo} aria-label={g.titulo}>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                <Icon name={g.icono} size={18} className="text-[var(--color-text-muted)]" />
                {g.titulo}
              </h2>
              <Table>
                <THead>
                  <TR>
                    <TH>Tabla</TH>
                    {visibles.map((t) => (
                      <TH key={t.id} numeric>
                        {t.legal_name.split(' ')[0]}
                      </TH>
                    ))}
                    <TH numeric>Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {g.tablas.map((tabla) => (
                    <TR key={tabla}>
                      <TD>
                        <Mono>{tabla}</Mono>
                      </TD>
                      {visibles.map((t) => {
                        const n = inv.porTenant.get(t.id)?.get(tabla) ?? 0
                        return (
                          <TD key={t.id} numeric>
                            <span
                              className={`tabular ${n === 0 ? 'text-[var(--color-text-muted)]' : ''}`}
                            >
                              {n === 0 ? '—' : n.toLocaleString('es-DO')}
                            </span>
                          </TD>
                        )
                      })}
                      <TD numeric>
                        <span className="tabular font-semibold">
                          {(inv.totalPorTabla.get(tabla) ?? 0).toLocaleString('es-DO')}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </section>
          ))}
        </>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        La lista de tablas se descubre en el momento: cualquier tabla nueva con datos de clientes
        aparece aquí sola, sin tocar código. Solo el equipo de REGB ve esta pantalla.
      </p>
    </div>
  )
}

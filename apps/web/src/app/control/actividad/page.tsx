import {
  Badge,
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
import { cargarBitacoraGlobal } from '@/lib/control-datos'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Actividad · REGB Control' }

/**
 * Bitacora de TODOS los clientes en una sola pantalla.
 *
 * `audit.log` ya deja leer al proveedor sin impersonar (§4): esta pantalla
 * solo lo pone donde se ve. Sirve para dos cosas muy distintas y las dos
 * importan — entender que hace un cliente antes de llamarlo, y reconstruir
 * que paso cuando alguien reclama.
 *
 * El `antes/despues` va completo, sin recortar: en una disputa, el detalle
 * es justo lo unico que sirve.
 */

interface Params {
  q?: string
  tenant?: string
  modulo?: string
  entidad?: string
  accion?: string
  dias?: string
}

const TONO_ACCION: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  create: 'success',
  update: 'warning',
  delete: 'danger',
  impersonate: 'danger',
}

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Que cambio, en palabras. Un jsonb crudo no lo lee nadie de un vistazo. */
function resumirCambio(antes: unknown, despues: unknown): string {
  if (!despues || typeof despues !== 'object') return '—'
  const d = despues as Record<string, unknown>
  if (!antes || typeof antes !== 'object') {
    const nombre = d.name ?? d.legal_name ?? d.number ?? d.sku ?? d.display_name
    return nombre ? String(nombre) : `${Object.keys(d).length} campos`
  }
  const a = antes as Record<string, unknown>
  const cambiados = Object.keys(d).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]) && k !== 'updated_at',
  )
  if (cambiados.length === 0) return 'sin cambios visibles'
  return cambiados
    .slice(0, 3)
    .map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(d[k])}`)
    .join(' · ')
    .slice(0, 160)
}

export default async function ActividadPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireProvider()
  const p = await searchParams

  const dias = Number(p.dias ?? '30')
  const desde =
    Number.isFinite(dias) && dias > 0
      ? new Date(Date.now() - dias * 86_400_000).toISOString()
      : undefined

  const { filas, total, modulos, entidades, acciones } = await cargarBitacoraGlobal({
    ...(p.tenant ? { tenant: p.tenant } : {}),
    ...(p.modulo ? { modulo: p.modulo } : {}),
    ...(p.entidad ? { entidad: p.entidad } : {}),
    ...(p.accion ? { accion: p.accion } : {}),
    ...(desde ? { desde } : {}),
    limite: 300,
  })

  const tenants = await db()<{ slug: string; legal_name: string }[]>`
    select slug, legal_name from regb.tenants where status <> 'archived' order by legal_name`

  // El texto libre se filtra en memoria: cae sobre las 300 ya traidas y
  // evita un `ilike` sobre una tabla particionada que crece sin techo.
  const q = (p.q ?? '').trim().toLowerCase()
  const visibles =
    q === ''
      ? filas
      : filas.filter((f) =>
          `${f.tenant ?? ''} ${f.entidad} ${f.usuario ?? ''} ${f.modulo ?? ''} ${JSON.stringify(f.despues ?? '')}`
            .toLowerCase()
            .includes(q),
        )

  const hayFiltro = Boolean(p.q || p.tenant || p.modulo || p.entidad || p.accion || p.dias)
  const porAccion = acciones.map((a) => ({
    accion: a,
    n: filas.filter((f) => f.accion === a).length,
  }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Icon name="history" size={22} className="text-[var(--color-accent-plum)]" />
          Actividad de todos los clientes
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Quien hizo que, en que cliente y cuando. Con el antes y el despues completos.
        </p>
      </div>

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Movimientos"
          value={total.toLocaleString('es-DO')}
          hint={desde ? `ultimos ${dias} dias` : 'todo el historial'}
        />
        <StatCard
          label="Mostrados"
          value={String(visibles.length)}
          hint="tope de 300 por consulta"
        />
        <StatCard
          label="Modulos con actividad"
          value={String(modulos.length)}
          hint="que dejan rastro"
        />
        <StatCard label="Tipos de accion" value={String(acciones.length)} hint="registrados" />
      </section>

      {porAccion.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {porAccion.map((a) => (
            <Badge key={a.accion} tone={TONO_ACCION[a.accion] ?? 'neutral'} dot={false}>
              {a.accion}: {a.n}
            </Badge>
          ))}
        </div>
      )}

      <Toolbar>
        <SearchField
          name="q"
          defaultValue={p.q ?? ''}
          placeholder="Cliente, tabla, usuario, valor…"
        />
        <FilterSelect label="Cliente" name="tenant" defaultValue={p.tenant ?? ''} className="w-52">
          <option value="">Todos</option>
          {tenants.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.legal_name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Modulo" name="modulo" defaultValue={p.modulo ?? ''} className="w-40">
          <option value="">Todos</option>
          {modulos.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Tabla" name="entidad" defaultValue={p.entidad ?? ''} className="w-44">
          <option value="">Todas</option>
          {entidades.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Accion" name="accion" defaultValue={p.accion ?? ''} className="w-36">
          <option value="">Todas</option>
          {acciones.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Periodo" name="dias" defaultValue={p.dias ?? '30'} className="w-36">
          <option value="1">Hoy</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
          <option value="0">Todo</option>
        </FilterSelect>
        <ToolbarActions hasFilters={hayFiltro} clearHref="/control/actividad" />
      </Toolbar>

      {total > filas.length && (
        <p className="text-xs text-[var(--color-semantic-text-warning)]">
          Hay {total.toLocaleString('es-DO')} movimientos que cumplen el filtro y se muestran los{' '}
          {filas.length} mas recientes. Acota el periodo o el cliente para verlos todos.
        </p>
      )}

      {visibles.length === 0 ? (
        <EmptyState
          icon="history_toggle_off"
          title="Sin movimientos con ese filtro"
          description="Prueba a ampliar el periodo. La bitacora solo registra creaciones, ediciones y borrados de las tablas auditadas."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Cuando</TH>
              <TH>Cliente</TH>
              <TH>Usuario</TH>
              <TH>Accion</TH>
              <TH>Tabla</TH>
              <TH>Modulo</TH>
              <TH>Que cambio</TH>
            </TR>
          </THead>
          <TBody>
            {visibles.map((f, i) => (
              <TR key={`${f.at}-${i}`}>
                <TD>
                  <span className="whitespace-nowrap text-xs">{cuando(f.at)}</span>
                </TD>
                <TD>{f.tenant ?? <span className="text-[var(--color-text-muted)]">—</span>}</TD>
                <TD>
                  <span className="text-xs">{f.usuario ?? '—'}</span>
                </TD>
                <TD>
                  <Badge tone={TONO_ACCION[f.accion] ?? 'neutral'} dot={false}>
                    {f.accion}
                  </Badge>
                </TD>
                <TD>
                  <Mono>{f.entidad}</Mono>
                </TD>
                <TD>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {f.modulo ?? '—'}
                  </span>
                </TD>
                <TD>
                  <details>
                    <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">
                      {resumirCambio(f.antes, f.despues)}
                    </summary>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] p-2 text-[10px] text-[var(--color-text-secondary)]">
                      {JSON.stringify({ antes: f.antes, despues: f.despues }, null, 1)}
                    </pre>
                  </details>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        Se auditan creaciones, ediciones y borrados de 16 tablas. <Mono>inventory_movements</Mono>{' '}
        no se audita porque ya es un libro inmutable, y <Mono>pos_sales</Mono> tampoco, por volumen:
        sus rastros estan en el kardex y en Cierres. Los campos <Mono>ip</Mono>,{' '}
        <Mono>user_agent</Mono> y <Mono>platform</Mono> existen en la tabla pero el trigger no los
        rellena todavia.
      </p>
    </div>
  )
}

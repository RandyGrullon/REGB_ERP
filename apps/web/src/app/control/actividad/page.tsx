import {
  Badge,
  EmptyState,
  FilterSelect,
  Icon,
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
import { nombreCampo, nombreEntidad, valor } from '@/app/auditoria/etiquetas'
import { cargarBitacoraGlobal, type FilaBitacora } from '@/lib/control-datos'
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

/** La accion del registro, en palabras: el enum de la bitacora esta en ingles. */
const ACCION_LABEL: Record<string, string> = {
  create: 'Creó',
  update: 'Cambió',
  delete: 'Borró',
  impersonate: 'Entró REGB',
}

/**
 * Qué cambió, en palabras. Un jsonb crudo no lo lee nadie de un vistazo, y
 * enseñaba `status: "draft" → "posted"`, `null` y uuids. Se usan los mismos
 * nombres que la Auditoría del cliente: campo en castellano y valor legible.
 */
function resumirCambio(antes: unknown, despues: unknown): string {
  const d = (despues && typeof despues === 'object' ? despues : null) as Record<
    string,
    unknown
  > | null
  const a = (antes && typeof antes === 'object' ? antes : null) as Record<string, unknown> | null
  const registro = d ?? a
  if (!registro) return '—'
  if (!a || !d) {
    const nombre =
      registro.name ??
      registro.legal_name ??
      registro.number ??
      registro.title ??
      registro.display_name ??
      registro.sku
    if (nombre) return String(nombre)
    const n = Object.keys(registro).length
    return `${n} dato${n === 1 ? '' : 's'}`
  }
  const cambiados = Object.keys(d).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]) && k !== 'updated_at',
  )
  if (cambiados.length === 0) return 'Sin cambios visibles'
  const texto = cambiados
    .slice(0, 3)
    .map((k) => `${nombreCampo(k)}: ${valor(a[k])} → ${valor(d[k])}`)
    .join(' · ')
  return texto.length > 160 ? `${texto.slice(0, 157)}…` : texto
}

/**
 * El antes y el después, campo por campo y en castellano, en UN bloque de
 * texto por fila. Una tabla por movimiento eran ~30 celdas × 300 filas y la
 * página pesaba casi 8 MB; el texto plano pesa una fracción y se copia
 * igual de fácil en una disputa.
 *
 * En un cambio se listan solo los campos que cambiaron (lo demás era ruido
 * que escondía lo que pasó); al crear o borrar, el registro completo.
 */
function detalleCambio(antes: unknown, despues: unknown): string {
  const a = (antes && typeof antes === 'object' ? antes : null) as Record<string, unknown> | null
  const d = (despues && typeof despues === 'object' ? despues : null) as Record<
    string,
    unknown
  > | null
  if (a && d) {
    const cambiados = Object.keys(d)
      .filter((k) => k !== 'updated_at' && JSON.stringify(a[k]) !== JSON.stringify(d[k]))
      .sort()
    if (cambiados.length === 0) return 'Sin cambios visibles.'
    return cambiados.map((k) => `${nombreCampo(k)}: ${valor(a[k])} → ${valor(d[k])}`).join('\n')
  }
  const registro = d ?? a
  if (!registro) return ''
  return Object.keys(registro)
    .sort()
    .map((k) => `${nombreCampo(k)}: ${valor(registro[k])}`)
    .join('\n')
}

/** Quién lo hizo: sin perfil no se enseña el id, se dice lo que se sabe. */
const quien = (f: FilaBitacora) => f.usuario ?? (f.conUsuario ? 'Usuario sin perfil' : 'Sistema')

export default async function ActividadPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireProvider()
  const p = await searchParams

  const dias = Number(p.dias ?? '30')
  const desde =
    Number.isFinite(dias) && dias > 0
      ? new Date(Date.now() - dias * 86_400_000).toISOString()
      : undefined

  const { filas, total, modulos, nombresModulo, entidades, acciones } = await cargarBitacoraGlobal({
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
          `${f.tenant ?? ''} ${f.entidad} ${nombreEntidad(f.entidad)} ${f.usuario ?? ''} ${f.modulo ?? ''} ${JSON.stringify(f.despues ?? '')}`
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
          Quién hizo qué, en qué cliente y cuándo. Con el antes y el después completos.
        </p>
      </div>

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Movimientos"
          value={total.toLocaleString('es-DO')}
          hint={desde ? `últimos ${dias} días` : 'todo el historial'}
        />
        <StatCard
          label="Mostrados"
          value={String(visibles.length)}
          hint="tope de 300 por consulta"
        />
        <StatCard
          label="Módulos con actividad"
          value={String(modulos.length)}
          hint="que dejan rastro"
        />
        <StatCard label="Tipos de acción" value={String(acciones.length)} hint="registrados" />
      </section>

      {porAccion.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {porAccion.map((a) => (
            <Badge key={a.accion} tone={TONO_ACCION[a.accion] ?? 'neutral'} dot={false}>
              {ACCION_LABEL[a.accion] ?? a.accion}: {a.n}
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
        <FilterSelect label="Módulo" name="modulo" defaultValue={p.modulo ?? ''} className="w-40">
          <option value="">Todos</option>
          {modulos.map((m) => (
            <option key={m} value={m}>
              {nombresModulo[m] ?? m}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Tabla" name="entidad" defaultValue={p.entidad ?? ''} className="w-44">
          <option value="">Todas</option>
          {entidades.map((e) => (
            <option key={e} value={e}>
              {nombreEntidad(e)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Acción" name="accion" defaultValue={p.accion ?? ''} className="w-36">
          <option value="">Todas</option>
          {acciones.map((a) => (
            <option key={a} value={a}>
              {ACCION_LABEL[a] ?? a}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Período" name="dias" defaultValue={p.dias ?? '30'} className="w-36">
          <option value="1">Hoy</option>
          <option value="7">7 días</option>
          <option value="30">30 días</option>
          <option value="90">90 días</option>
          <option value="0">Todo</option>
        </FilterSelect>
        <ToolbarActions hasFilters={hayFiltro} clearHref="/control/actividad" />
      </Toolbar>

      {total > filas.length && (
        <p className="text-xs text-[var(--color-semantic-text-warning)]">
          Hay {total.toLocaleString('es-DO')} movimientos que cumplen el filtro y se muestran los{' '}
          {filas.length} más recientes. Acota el período o el cliente para verlos todos.
        </p>
      )}

      {visibles.length === 0 ? (
        <EmptyState
          icon="history_toggle_off"
          title="Sin movimientos con ese filtro"
          description="Prueba a ampliar el período. La bitácora solo registra creaciones, ediciones y borrados de las tablas auditadas."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Cuándo</TH>
              <TH>Cliente</TH>
              <TH>Usuario</TH>
              <TH>Acción</TH>
              <TH>Tabla</TH>
              <TH>Módulo</TH>
              <TH>Qué cambió</TH>
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
                  <span className="text-xs">{quien(f)}</span>
                </TD>
                <TD>
                  <Badge tone={TONO_ACCION[f.accion] ?? 'neutral'} dot={false}>
                    {ACCION_LABEL[f.accion] ?? f.accion}
                  </Badge>
                </TD>
                <TD>
                  <span className="text-xs" title={f.entidad}>
                    {nombreEntidad(f.entidad)}
                  </span>
                </TD>
                <TD>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {f.modulo ? (nombresModulo[f.modulo] ?? f.modulo) : '—'}
                  </span>
                </TD>
                <TD>
                  <details>
                    <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">
                      {resumirCambio(f.antes, f.despues)}
                    </summary>
                    <pre className="mt-1 max-w-md whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] p-2 font-[inherit] text-[11px] text-[var(--color-text-secondary)]">
                      {detalleCambio(f.antes, f.despues)}
                    </pre>
                  </details>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        Se auditan las creaciones, ediciones y borrados de los registros del negocio. Los
        movimientos de inventario no se auditan porque ya son un libro que no se edita, y las ventas
        en caja tampoco, por volumen: su rastro está en el kardex y en los cierres de caja. Todavía
        no se guarda desde qué dirección IP, navegador ni aplicación se hizo cada cambio.
      </p>
    </div>
  )
}

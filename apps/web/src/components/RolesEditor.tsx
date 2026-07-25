'use client'

import { useMemo, useState } from 'react'
import { Badge, Card, cn } from '@regb/ui'
import { matchingPatterns } from '@regb/permissions'

/**
 * Editor de roles y permisos (§8.4).
 *
 * Tres bloques, en el orden en que un admin piensa:
 *   1. QUE MODULOS ve este rol en el sidebar
 *   2. QUE PUEDE HACER dentro de cada uno
 *   3. SOBRE QUE DATOS (alcance ABAC)
 *
 * Aviso permanente arriba: ocultar un modulo del sidebar es ergonomia, no
 * seguridad. Lo que de verdad protege es el permiso y la RLS (§8.3).
 */

interface RoleRow {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  visibleModules: string[]
  permissions: Record<string, boolean>
  scope: Record<string, unknown>
  memberCount: number
}

interface ModuleOption {
  id: string
  name: string
  category: string
  permissions: string[]
}

/** Como se ve un permiso concreto para un rol. */
type Estado = 'concedido' | 'denegado' | 'heredado' | 'sin-definir'

/**
 * Resuelve el estado de un permiso aplicando la MISMA logica que el
 * evaluador de servidor: la denegacion gana, y los comodines cuentan.
 */
function estadoDe(
  perm: string,
  permisos: Record<string, boolean>,
): { estado: Estado; via: string } {
  if (permisos[perm] === false) return { estado: 'denegado', via: perm }
  if (permisos[perm] === true) return { estado: 'concedido', via: perm }

  const patrones = matchingPatterns(perm).slice(1)
  for (const p of patrones) {
    if (permisos[p] === false) return { estado: 'denegado', via: p }
  }
  for (const p of patrones) {
    if (permisos[p] === true) return { estado: 'heredado', via: p }
  }
  return { estado: 'sin-definir', via: '' }
}

const ETIQUETA_ACCION: Record<string, string> = {
  view: 'Ver',
  create: 'Crear',
  edit: 'Editar',
  delete: 'Eliminar',
  export: 'Exportar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  adjust: 'Ajustar',
  transfer: 'Transferir',
  count: 'Contar',
  sell: 'Vender',
  void: 'Anular',
  discount: 'Descontar',
  run: 'Procesar',
  upload: 'Subir',
  review: 'Revisar',
  open: 'Abrir',
  close: 'Cerrar',
  own: 'Solo lo propio',
  invite: 'Invitar',
  remove: 'Quitar',
  start: 'Iniciar',
  request: 'Solicitar',
}

/** El objeto sobre el que actua el permiso, en espanol. */
const ETIQUETA_OBJETO: Record<string, string> = {
  cost: 'costos',
  price: 'precios',
  shift: 'turno',
  report: 'reportes',
  role: 'roles',
  member: 'miembros',
  branding: 'marca',
  trial: 'prueba',
  own: 'propio',
}

/** `inventory.cost.view` → "Ver costos" */
function etiqueta(perm: string): string {
  const partes = perm.split('.').slice(1)
  const accion = partes.at(-1) ?? ''
  const base = ETIQUETA_ACCION[accion] ?? accion

  if (partes.length > 1) {
    const objeto = partes
      .slice(0, -1)
      .map((p) => ETIQUETA_OBJETO[p] ?? p)
      .join(' ')
    return `${base} ${objeto}`
  }
  return base
}

export function RolesEditor({
  roles,
  modules,
  tenantName,
  backHref,
}: {
  roles: RoleRow[]
  modules: ModuleOption[]
  tenantName: string
  backHref: string
}) {
  const [activo, setActivo] = useState(roles[0]?.id ?? '')
  const rol = useMemo(() => roles.find((r) => r.id === activo), [roles, activo])

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Lista de roles ─────────────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-deep)]">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
          <a
            href={backHref}
            className="rounded-[var(--radius-md)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            ←
          </a>
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Roles</span>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActivo(r.id)}
              aria-current={r.id === activo ? 'true' : undefined}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left',
                'transition-colors duration-100',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
                r.id === activo
                  ? 'bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]',
              )}
            >
              <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
              {r.memberCount > 0 && (
                <span className="tabular text-[11px] text-[var(--color-text-muted)]">
                  {r.memberCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="shrink-0 border-t border-[var(--color-border)] p-2">
          <p className="px-2 py-1 text-[11px] text-[var(--color-text-muted)]">{tenantName}</p>
        </div>
      </aside>

      {/* ── Detalle del rol ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {!rol ? (
          <p className="py-16 text-center text-sm text-[var(--color-text-muted)]">
            Elige un rol a la izquierda.
          </p>
        ) : (
          <>
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{rol.name}</h1>
              {rol.isSystem && <Badge tone="neutral">predefinido</Badge>}
              <Badge tone="brand" dot={false}>
                {rol.memberCount} usuario{rol.memberCount === 1 ? '' : 's'}
              </Badge>
            </div>
            {rol.description && (
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{rol.description}</p>
            )}

            {/* El aviso de §8.3, permanente y no descartable */}
            <div className="mb-5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-semantic-info)_10%,transparent)] px-3 py-2">
              <p className="text-xs text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-semantic-text-info)]">Importante:</strong>{' '}
                ocultar un modulo del sidebar es comodidad, no seguridad. Lo que de verdad protege
                es el permiso: quien no lo tenga recibe un 403 aunque escriba la direccion a mano.
              </p>
            </div>

            {/* ── 1. Modulos visibles ──────────────────────────────── */}
            <Section
              titulo="Modulos visibles en el sidebar"
              ayuda="Lo que este rol ve al entrar. Los que no marques siguen existiendo, simplemente no aparecen."
            >
              {rol.visibleModules.includes('*') ? (
                <p className="text-sm text-[var(--color-semantic-text-success)]">
                  ✓ Ve todos los modulos que el cliente tenga activos
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {modules.map((m) => {
                    const visible = rol.visibleModules.includes(m.id)
                    return (
                      <span
                        key={m.id}
                        className={cn(
                          'rounded-[var(--radius-md)] px-2 py-1 text-xs',
                          visible
                            ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand-bright)]'
                            : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] line-through',
                        )}
                      >
                        {m.name}
                      </span>
                    )
                  })}
                  {modules.length === 0 && (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      El cliente no tiene modulos activos todavia.
                    </p>
                  )}
                </div>
              )}
            </Section>

            {/* ── 2. Permisos por modulo ───────────────────────────── */}
            <Section
              titulo="Que puede hacer"
              ayuda="Rojo tachado = denegado explicitamente. Una denegacion gana sobre cualquier permiso mas general."
            >
              <div className="space-y-3">
                {modules.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
                  >
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {m.name}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {m.permissions.map((p) => {
                        const { estado, via } = estadoDe(p, rol.permissions)
                        return <PermChip key={p} label={etiqueta(p)} estado={estado} via={via} />
                      })}
                    </div>
                  </div>
                ))}
                {modules.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Sin modulos activos no hay permisos que configurar.
                  </p>
                )}
              </div>
            </Section>

            {/* ── 3. Alcance ABAC ──────────────────────────────────── */}
            <Section
              titulo="Sobre que datos"
              ayuda="El alcance no dice que ACCIONES puede hacer, sino sobre QUE FILAS."
            >
              <ScopeView scope={rol.scope} />
            </Section>

            <p className="mt-6 text-xs text-[var(--color-text-muted)]">
              🚧 Esta pantalla es de solo lectura por ahora. La edicion llega con el modulo{' '}
              <code className="font-[family-name:var(--font-mono)]">rbac</code> completo.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Section({
  titulo,
  ayuda,
  children,
}: {
  titulo: string
  ayuda: string
  children: React.ReactNode
}) {
  return (
    <Card className="mb-4 p-4">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{titulo}</h2>
      <p className="mb-3 mt-0.5 text-xs text-[var(--color-text-muted)]">{ayuda}</p>
      {children}
    </Card>
  )
}

function PermChip({ label, estado, via }: { label: string; estado: Estado; via: string }) {
  const estilo: Record<Estado, string> = {
    concedido:
      'bg-[color-mix(in_srgb,var(--color-semantic-success)_18%,transparent)] text-[var(--color-semantic-text-success)]',
    heredado: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-bright)]',
    denegado:
      'bg-[color-mix(in_srgb,var(--color-semantic-danger)_18%,transparent)] text-[var(--color-semantic-text-danger)] line-through',
    'sin-definir': 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]',
  }

  const titulo =
    estado === 'heredado'
      ? `Heredado de "${via}"`
      : estado === 'denegado'
        ? `Denegado por "${via}"`
        : estado === 'concedido'
          ? 'Concedido explicitamente'
          : 'Sin conceder'

  return (
    <span
      title={titulo}
      className={cn('rounded-[var(--radius-sm)] px-2 py-1 text-xs', estilo[estado])}
    >
      {estado === 'heredado' && '↳ '}
      {label}
    </span>
  )
}

function ScopeView({ scope }: { scope: Record<string, unknown> }) {
  const entradas: { label: string; valor: string }[] = []

  if (scope.read_only) entradas.push({ label: 'Solo lectura', valor: 'No puede escribir nada' })
  if (scope.own_only)
    entradas.push({ label: 'Solo lo propio', valor: 'Unicamente los registros que creo' })
  if (scope.own_branches_only)
    entradas.push({ label: 'Su sucursal', valor: 'Solo las sucursales que tiene asignadas' })
  if (scope.own_warehouses_only)
    entradas.push({ label: 'Su almacen', valor: 'Solo los almacenes que tiene asignados' })
  if (scope.own_register_only)
    entradas.push({ label: 'Su caja', valor: 'Solo la caja y el turno donde esta' })
  if (typeof scope.max_amount === 'number')
    entradas.push({
      label: 'Tope de monto',
      valor: `Hasta ${scope.max_amount.toLocaleString('es-DO')} por operacion`,
    })
  if (typeof scope.hours === 'string')
    entradas.push({ label: 'Horario', valor: `Solo opera entre ${scope.hours}` })

  if (entradas.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Sin restricciones: alcanza todos los datos del cliente.
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {entradas.map((e) => (
        <li key={e.label} className="flex gap-2 text-sm">
          <span className="w-32 shrink-0 font-medium text-[var(--color-text-primary)]">
            {e.label}
          </span>
          <span className="text-[var(--color-text-secondary)]">{e.valor}</span>
        </li>
      ))}
    </ul>
  )
}

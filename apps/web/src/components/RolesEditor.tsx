'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Card, cn } from '@regb/ui'
import { matchingPatterns } from '@regb/permissions'
import {
  createRole,
  deleteRole,
  setPermission,
  setScope,
  toggleModuleVisibility,
} from '@/app/roles/actions'

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
  demo,
  canEdit,
}: {
  roles: RoleRow[]
  modules: ModuleOption[]
  tenantName: string
  backHref: string
  /** Contexto de la demostracion. En produccion va undefined. */
  demo?: { tenantSlug: string; roleName: string } | undefined
  /** El rol de quien mira, ¿puede editar? La UI lo respeta; el servidor
   *  lo vuelve a comprobar de todos modos (§8.3). */
  canEdit: boolean
}) {
  const [activo, setActivo] = useState(roles[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [guardando, empezar] = useTransition()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const router = useRouter()

  const rol = useMemo(() => roles.find((r) => r.id === activo), [roles, activo])

  /** Envuelve una accion: limpia el error, refresca y reporta si fallo. */
  const ejecutar = (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    empezar(async () => {
      const r = await accion()
      if (!r.ok) setError(r.error ?? 'No se pudo guardar.')
      else router.refresh()
    })
  }

  /** Ciclo del chip: sin definir → concedido → denegado → sin definir. */
  const ciclar = (perm: string, estado: Estado) => {
    if (!canEdit || !rol) return
    const siguiente: boolean | null =
      estado === 'concedido' ? false : estado === 'denegado' ? null : true
    ejecutar(() => setPermission({ roleId: rol.id, permission: perm, value: siguiente, demo }))
  }

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
          {canEdit && (
            <>
              {creando ? (
                <div className="mb-2 space-y-1.5">
                  <input
                    autoFocus
                    value={nuevoNombre}
                    onChange={(e) => setNuevoNombre(e.target.value)}
                    placeholder="Nombre del rol"
                    className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      loading={guardando}
                      onClick={() =>
                        ejecutar(async () => {
                          const r = await createRole({
                            name: nuevoNombre,
                            copyFrom: activo,
                            demo,
                          })
                          if (r.ok) {
                            setCreando(false)
                            setNuevoNombre('')
                          }
                          return r
                        })
                      }
                    >
                      Crear
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCreando(false)}>
                      Cancelar
                    </Button>
                  </div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    Copia los permisos de {rol?.name ?? 'el rol actual'} como punto de partida.
                  </p>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mb-2 w-full"
                  onClick={() => setCreando(true)}
                >
                  + Nuevo rol
                </Button>
              )}
            </>
          )}
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
              <div className="flex-1" />
              {guardando && (
                <span className="text-xs text-[var(--color-text-muted)]">Guardando…</span>
              )}
              {canEdit && !rol.isSystem && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => ejecutar(() => deleteRole({ roleId: rol.id, demo }))}
                >
                  Borrar rol
                </Button>
              )}
            </div>
            {rol.description && (
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{rol.description}</p>
            )}

            {error && (
              <p
                role="alert"
                className="mb-4 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_15%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]"
              >
                {error}
              </p>
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
                      <button
                        key={m.id}
                        type="button"
                        disabled={!canEdit || guardando}
                        aria-pressed={visible}
                        onClick={() =>
                          ejecutar(() =>
                            toggleModuleVisibility({
                              roleId: rol.id,
                              moduleId: m.id,
                              visible: !visible,
                              demo,
                            }),
                          )
                        }
                        className={cn(
                          'rounded-[var(--radius-md)] px-2 py-1 text-xs transition-colors duration-100',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
                          canEdit && 'cursor-pointer hover:brightness-110',
                          !canEdit && 'cursor-default',
                          visible
                            ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-brand-bright)]'
                            : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] line-through',
                        )}
                      >
                        {m.name}
                      </button>
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
              ayuda={
                canEdit
                  ? 'Toca un permiso para ciclarlo: sin definir → concedido → denegado. Una denegacion gana sobre cualquier permiso mas general.'
                  : 'Rojo tachado = denegado explicitamente. Una denegacion gana sobre cualquier permiso mas general.'
              }
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
                        return (
                          <PermChip
                            key={p}
                            label={etiqueta(p)}
                            estado={estado}
                            via={via}
                            editable={canEdit && !guardando}
                            onClick={() => ciclar(p, estado)}
                          />
                        )
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
              <ScopeEditor
                scope={rol.scope}
                editable={canEdit && !guardando}
                onChange={(key, value) =>
                  ejecutar(() => setScope({ roleId: rol.id, key, value, demo }))
                }
              />
            </Section>

            {!canEdit && (
              <p className="mt-6 text-xs text-[var(--color-text-muted)]">
                Estas viendo esto como <strong>{tenantName}</strong> con un rol que no puede editar
                permisos. Cambia a Owner o Admin para modificarlos.
              </p>
            )}
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

function PermChip({
  label,
  estado,
  via,
  editable,
  onClick,
}: {
  label: string
  estado: Estado
  via: string
  editable: boolean
  onClick: () => void
}) {
  const estilo: Record<Estado, string> = {
    concedido:
      'bg-[color-mix(in_srgb,var(--color-semantic-success)_18%,transparent)] text-[var(--color-semantic-text-success)]',
    heredado: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-bright)]',
    denegado:
      'bg-[color-mix(in_srgb,var(--color-semantic-danger)_18%,transparent)] text-[var(--color-semantic-text-danger)] line-through',
    'sin-definir': 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]',
  }

  const explicacion: Record<Estado, string> = {
    heredado: `Heredado de "${via}"`,
    denegado: `Denegado por "${via}"`,
    concedido: 'Concedido explicitamente',
    'sin-definir': 'Sin conceder',
  }

  const siguiente: Record<Estado, string> = {
    'sin-definir': 'conceder',
    heredado: 'conceder explicitamente',
    concedido: 'denegar',
    denegado: 'dejar sin definir',
  }

  const titulo = editable
    ? `${explicacion[estado]} · toca para ${siguiente[estado]}`
    : explicacion[estado]

  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      title={titulo}
      className={cn(
        'rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-all duration-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
        editable ? 'cursor-pointer hover:brightness-110 active:translate-y-px' : 'cursor-default',
        estilo[estado],
      )}
    >
      {estado === 'heredado' && '↳ '}
      {label}
    </button>
  )
}

type ScopeKey = 'own_only' | 'read_only' | 'max_amount' | 'hours'

function ScopeEditor({
  scope,
  editable,
  onChange,
}: {
  scope: Record<string, unknown>
  editable: boolean
  onChange: (key: ScopeKey, value: boolean | number | string | null) => void
}) {
  // Alcances que se derivan de la asignacion del usuario (sus sucursales,
  // sus almacenes) y no se editan aqui: solo se informan.
  const derivados: string[] = []
  if (scope.own_branches_only) derivados.push('Solo las sucursales que tenga asignadas')
  if (scope.own_warehouses_only) derivados.push('Solo los almacenes que tenga asignados')
  if (scope.own_register_only) derivados.push('Solo la caja y el turno donde este')

  return (
    <div className="space-y-3">
      <Interruptor
        label="Solo lectura"
        ayuda="Lee y exporta, pero no escribe nada. Es lo que hace a un Auditor."
        activo={Boolean(scope.read_only)}
        editable={editable}
        onToggle={(v) => onChange('read_only', v ? true : null)}
      />
      <Interruptor
        label="Solo lo propio"
        ayuda="Unicamente los registros que esa persona creo."
        activo={Boolean(scope.own_only)}
        editable={editable}
        onToggle={(v) => onChange('own_only', v ? true : null)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="w-40 shrink-0 text-sm font-medium text-[var(--color-text-primary)]">
          Tope de monto
        </label>
        <input
          type="number"
          min={0}
          step={1000}
          disabled={!editable}
          defaultValue={typeof scope.max_amount === 'number' ? scope.max_amount : ''}
          placeholder="sin tope"
          onBlur={(e) => {
            const v = e.target.value.trim()
            onChange('max_amount', v === '' ? null : Number(v))
          }}
          className="tabular h-9 w-36 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-60"
        />
        <span className="text-xs text-[var(--color-text-muted)]">
          por operacion. Vacio = sin limite.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="w-40 shrink-0 text-sm font-medium text-[var(--color-text-primary)]">
          Horario
        </label>
        <input
          type="text"
          disabled={!editable}
          defaultValue={typeof scope.hours === 'string' ? scope.hours : ''}
          placeholder="07:00-19:00"
          onBlur={(e) => {
            const v = e.target.value.trim()
            onChange('hours', v === '' ? null : v)
          }}
          className="h-9 w-36 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-60"
        />
        <span className="text-xs text-[var(--color-text-muted)]">
          Un turno nocturno como 22:00-06:00 cruza la medianoche.
        </span>
      </div>

      {derivados.length > 0 && (
        <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Derivado de la asignacion
          </p>
          <ul className="mt-1 space-y-0.5">
            {derivados.map((d) => (
              <li key={d} className="text-xs text-[var(--color-text-secondary)]">
                · {d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Interruptor({
  label,
  ayuda,
  activo,
  editable,
  onToggle,
}: {
  label: string
  ayuda: string
  activo: boolean
  editable: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="w-40 shrink-0 text-sm font-medium text-[var(--color-text-primary)]">
        {label}
      </label>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={label}
        disabled={!editable}
        onClick={() => onToggle(!activo)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
          activo ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-surface-overlay)]',
          !editable && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-100',
            activo ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className="text-xs text-[var(--color-text-muted)]">{ayuda}</span>
    </div>
  )
}

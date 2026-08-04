import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi cuenta · REGB ERP' }

/**
 * Mi cuenta (core 1, `auth`).
 *
 * La ruta estaba declarada en el manifiesto desde el principio y la pagina
 * no existia: cualquiera que llegara a `/perfil` recibia un 404 dentro de
 * su propio ERP.
 *
 * Lo mas util que puede enseñar no son los datos personales —esos ya los
 * sabe— sino QUE PUEDE HACER y que no. "No me deja" es la consulta de
 * soporte numero uno de un ERP, y casi siempre la respuesta es un permiso
 * que el rol no tiene. Aqui la puede ver el propio usuario sin llamar a
 * nadie.
 */

interface Perfil {
  display_name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
}

const fecha = (iso: string | null) =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })

/** `pos.discount.max: 10` se lee mucho mejor como "hasta 10". */
function valorLegible(v: unknown): { texto: string; tono: 'success' | 'danger' | 'warning' } {
  if (v === true) return { texto: 'Si', tono: 'success' }
  if (v === false) return { texto: 'No', tono: 'danger' }
  if (typeof v === 'number') return { texto: `hasta ${v}`, tono: 'warning' }
  if (Array.isArray(v)) return { texto: v.join(', '), tono: 'warning' }
  return { texto: String(v), tono: 'warning' }
}

export default async function PerfilPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'auth')

  const [perfil] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<Perfil[]>`
      select display_name, email, phone, created_at::text
      from public.user_profiles
      where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}`,
  )

  // Los permisos del rol salen del contexto ya resuelto, no de otra
  // consulta: es exactamente lo mismo que evalua el servidor al decidir si
  // te deja hacer algo, asi que lo que se ve aqui no puede mentir.
  const permisos = Object.entries(ctx.role.permissions)
    .filter(([k]) => k !== '*')
    .sort(([a], [b]) => a.localeCompare(b))
  const esTodopoderoso = ctx.role.permissions['*'] === true

  const porModulo = new Map<string, [string, boolean][]>()
  for (const [clave, valor] of permisos) {
    const modulo = clave.split('.')[0] ?? 'otros'
    porModulo.set(modulo, [...(porModulo.get(modulo) ?? []), [clave, valor]])
  }

  // El alcance es lo que mas confunde: el permiso dice SI puedes, el
  // alcance dice SOBRE QUE. Un vendedor con `sales-orders.view` y
  // `own_only` ve la pantalla y no ve los pedidos de sus companeros — y
  // eso, sin explicarlo, parece un error del sistema.
  const alcance = Object.entries(ctx.role.scope ?? {}).filter(([, v]) => v !== undefined)
  const ALCANCE_TEXTO: Record<string, (v: unknown) => string> = {
    own_only: () => 'Solo ves lo que tu creaste, no lo de tus companeros.',
    read_only: () => 'Puedes mirarlo todo pero no cambiar nada.',
    max_amount: (v) => `No puedes aprobar ni crear montos sobre ${v}.`,
    branches: (v) => `Limitado a ${Array.isArray(v) ? v.length : 0} sucursal(es).`,
    companies: (v) => `Limitado a ${Array.isArray(v) ? v.length : 0} empresa(s).`,
    hours: (v) => `Solo puedes entrar en el horario ${v}.`,
    own_branches_only: () => 'Solo la sucursal a la que perteneces.',
    own_register_only: () => 'Solo la caja en la que abriste turno.',
    own_warehouses_only: () => 'Solo los almacenes que tienes asignados.',
  }

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/perfil">
      <div className="space-y-5">
        <PageHeader
          icon="shield_person"
          title="Mi cuenta"
          description="Tus datos, tu rol y exactamente que te deja hacer el sistema."
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Tus datos</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-text-secondary)]">Nombre</dt>
                  <dd className="font-medium text-[var(--color-text-primary)]">
                    {perfil?.display_name ?? shell.data.user.name}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-text-secondary)]">Correo</dt>
                  <dd className="truncate">{perfil?.email ?? shell.data.user.email ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-text-secondary)]">Telefono</dt>
                  <dd>{perfil?.phone ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-text-secondary)]">En el sistema desde</dt>
                  <dd>{fecha(perfil?.created_at ?? null)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-[var(--color-border)] pt-2">
                  <dt className="text-[var(--color-text-secondary)]">Empresa</dt>
                  <dd className="font-medium text-[var(--color-text-primary)]">
                    {shell.data.tenant.name}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-text-secondary)]">Tu rol</dt>
                  <dd>
                    <Badge tone="info" dot={false}>
                      {ctx.roleName}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Para cambiar tu nombre o tu correo, pideselo a quien administra los usuarios de tu
                empresa: los datos de acceso los gestiona{' '}
                <a
                  href={`/usuarios${qs}`}
                  className="text-[var(--color-text-link)] hover:underline"
                >
                  Usuarios
                </a>
                , no esta pantalla.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Seguridad</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                <li className="flex items-start gap-2">
                  <Icon
                    name="key"
                    size={18}
                    className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                  />
                  <span>
                    <strong className="text-[var(--color-text-primary)]">Tu clave es tuya.</strong>{' '}
                    Nunca la compartas, ni con un companero ni con soporte. Dos personas en el mismo
                    usuario dejan la bitacora inservible: cuando algo falla, nadie puede saber quien
                    fue.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon
                    name="visibility"
                    size={18}
                    className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                  />
                  <span>
                    <strong className="text-[var(--color-text-primary)]">
                      Soporte puede entrar a tu empresa
                    </strong>{' '}
                    para ayudarte, pero solo dejando escrito el motivo y con la sesion registrada.
                    Si ves el aviso de acompanamiento en la barra, es eso.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Icon
                    name="history"
                    size={18}
                    className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                  />
                  <span>
                    <strong className="text-[var(--color-text-primary)]">
                      Todo queda grabado.
                    </strong>{' '}
                    Cada creacion, edicion y borrado guarda quien, cuando y que cambio. No es
                    vigilancia: es lo que permite deshacer un error sin discutir de memoria.
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Cambiar la contrasena y activar la verificacion en dos pasos se hacen desde el
                proveedor de identidad. Llegan cuando se conecte el inicio de sesion real.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Que puedes hacer</CardTitle>
          </CardHeader>
          <CardBody>
            {esTodopoderoso ? (
              <p className="flex items-center gap-2 py-2 text-sm">
                <Icon
                  name="shield"
                  size={20}
                  filled
                  className="text-[var(--color-semantic-text-success)]"
                />
                <span className="text-[var(--color-text-secondary)]">
                  Tu rol{' '}
                  <strong className="text-[var(--color-text-primary)]">{ctx.roleName}</strong> tiene
                  acceso completo: todos los modulos y todas las acciones de tu empresa.
                </span>
              </p>
            ) : porModulo.size === 0 ? (
              <p className="py-2 text-sm text-[var(--color-text-muted)]">
                Tu rol no tiene ningun permiso asignado. Habla con quien administra los usuarios.
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
                  Si una pantalla no te aparece o un boton no te deja, la razon esta aqui. Enseñale
                  esta lista a quien administra los usuarios y sabra exactamente que activarte.
                </p>
                <Table>
                  <THead>
                    <TR>
                      <TH>Modulo</TH>
                      <TH>Permiso</TH>
                      <TH>Puedes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {[...porModulo.entries()].map(([modulo, claves]) =>
                      claves.map(([clave, valor], i) => {
                        const v = valorLegible(valor)
                        return (
                          <TR key={clave}>
                            <TD>
                              {i === 0 ? (
                                <span className="font-medium text-[var(--color-text-primary)]">
                                  {modulo}
                                </span>
                              ) : (
                                ''
                              )}
                            </TD>
                            <TD>
                              <Mono>{clave}</Mono>
                            </TD>
                            <TD>
                              <Badge tone={v.tono} dot={false}>
                                {v.texto}
                              </Badge>
                            </TD>
                          </TR>
                        )
                      }),
                    )}
                  </TBody>
                </Table>
              </>
            )}
            {alcance.length > 0 && (
              <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                  <Icon name="tune" size={18} className="text-[var(--color-text-muted)]" />
                  Ademas, tu rol tiene limites de alcance
                </p>
                <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">
                  {alcance.map(([clave, valor]) => (
                    <li key={clave} className="flex items-start gap-2">
                      <Icon
                        name="chevron_right"
                        size={16}
                        className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
                      />
                      <span>
                        {ALCANCE_TEXTO[clave]?.(valor) ?? `${clave}: ${JSON.stringify(valor)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}

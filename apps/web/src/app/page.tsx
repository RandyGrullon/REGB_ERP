import { Badge, Icon, StatCard } from '@regb/ui'
import { redirect } from 'next/navigation'
import { asUser, db } from '@/lib/db'
import { exigir, modulePage, primeraRutaVisible, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { Widget, cargarDatosWidgets, ordenarWidgets, type DatosWidgets } from '@/components/widgets'

export const dynamic = 'force-dynamic'

/**
 * Inicio — el modulo `dashboard` (S10).
 *
 * Indicadores reales del tenant, accesos rapidos y los widgets que cada
 * modulo declara en su manifest. Nada cableado: si un modulo se apaga,
 * su widget desaparece solo.
 */
/**
 * El saludo va con la hora de RD, no la del servidor: "Buenos dias" a las
 * 8 de la noche le dice al dueño que el sistema no sabe donde esta.
 */
function saludo(ahora = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat('es-DO', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/Santo_Domingo',
    }).format(ahora),
  )
  if (hora < 12) return 'Buenos días'
  if (hora < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { impersonando?: string; diagnostico?: string }>
}) {
  const params = await searchParams

  // Sin datos no hay demo que mostrar: instrucciones de arranque.
  const [algunTenant] = await db()<{ id: string }[]>`select id from regb.tenants limit 1`
  if (!algunTenant) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <Icon name="database" size={48} className="text-[var(--color-text-muted)]" />
          <h1 className="mt-4 text-xl font-semibold">No hay ningún cliente todavía</h1>
          <pre className="mt-4 rounded-lg bg-[var(--color-surface-raised)] p-4 text-left text-xs">
            docker start regb-test-db{'\n'}
            pnpm --filter @regb/db migrate{'\n'}
            pnpm --filter @regb/db seed:demo
          </pre>
        </div>
      </main>
    )
  }

  // Un cajero no tiene `dashboard.view` y no lo necesita: lo que necesita
  // es la caja. Sin esto su primera pantalla del dia era un 404 —el error
  // mas desmoralizante posible para alguien que acaba de entrar al sistema.
  // Se le manda a la primera ruta que SI puede abrir.
  const puerta = await primeraRutaVisible(params, 'dashboard')
  if (puerta) {
    const qsDemo = params.tenant
      ? `?tenant=${params.tenant}&rol=${encodeURIComponent(params.rol ?? '')}`
      : ''
    redirect(`${puerta}${qsDemo}`)
  }

  const { ctx, shell } = await modulePage(params, 'dashboard')

  const [stats, datosWidgets] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [row] = await tx<
      {
        usuarios: string
        sucursales: string
        productos: string
        empresas: string
        nombre_comercial: boolean
        tour_hecho: boolean
        modulos: string
      }[]
    >`
      select
        (select count(*) from public.memberships
          where tenant_id = ${ctx.tenantId} and is_active)                    as usuarios,
        (select count(*) from public.branches
          where tenant_id = ${ctx.tenantId} and is_active and deleted_at is null) as sucursales,
        (select count(*) from public.products
          where tenant_id = ${ctx.tenantId} and active)                       as productos,
        (select count(*) from public.companies
          where tenant_id = ${ctx.tenantId} and deleted_at is null)           as empresas,
        exists (select 1 from public.tenant_settings
          where tenant_id = ${ctx.tenantId}
            and coalesce(trim(trade_name), '') <> '')                         as nombre_comercial,
        exists (select 1 from public.tour_progress
          where tenant_id = ${ctx.tenantId} and user_id = ${ctx.userId}
            and completed)                                                    as tour_hecho,
        -- Mismo criterio que el marketplace (lib/marketplace.ts): activos y
        -- pruebas vigentes. Antes se contaban los módulos con manifest y el
        -- inicio decia 18 donde el marketplace, un clic después, decia 20.
        (select count(*) from regb.tenant_modules tm
          where tm.tenant_id = ${ctx.tenantId}
            and (tm.status = 'active'
                 or (tm.status = 'trial' and tm.trial_ends_at >= current_date)))  as modulos`
    const s = {
      usuarios: Number(row?.usuarios ?? 0),
      sucursales: Number(row?.sucursales ?? 0),
      productos: Number(row?.productos ?? 0),
      empresas: Number(row?.empresas ?? 0),
      nombreComercial: row?.nombre_comercial ?? false,
      tourHecho: row?.tour_hecho ?? false,
      modulos: Number(row?.modulos ?? 0),
    }
    // Los widgets van en el mismo `asUser`: una sola sesion de RLS para
    // toda la pantalla de inicio, que es la que mas se abre del ERP. Las
    // claves salen del registry —el dashboard no sabe de que modulo vino
    // cada una, ni le hace falta.
    // `veCosto` se decide aqui, con el mismo `can()` que el resto de la
    // web, y no dentro de la consulta: `asUser` no lleva `role_id` en los
    // claims, asi que `rls.has_perm()` diria que si para cualquiera.
    const w: DatosWidgets = await cargarDatosWidgets(
      tx,
      ctx.tenantId,
      shell.data.widgets,
      exigir(ctx, 'inventory', 'inventory.cost.view').ok,
    )
    return [s, w] as const
  })

  const qs = ctx.demoQs

  /**
   * Primeros pasos, con su estado REAL. Antes eran cuatro tarjetas fijas
   * que salian igual el primer dia que el dia 200, con el equipo ya
   * invitado y el catalogo cargado. Ahora cada paso sabe si ya se hizo y el
   * bloque entero desaparece cuando no queda ninguno.
   *
   * Solo pasos del core (configuracion, productos, usuarios, tutorial): el
   * inicio no conoce los modulos. Y solo los que este rol puede hacer.
   */
  const pasos = [
    {
      hecho: stats.nombreComercial,
      puede: exigir(ctx, 'settings', 'settings.view').ok,
      href: `/configuracion${qs}`,
      icon: 'storefront',
      title: 'Pon el nombre de tu negocio',
      desc: 'Es el que sale en tus tickets y facturas.',
    },
    {
      hecho: stats.productos > 0,
      puede: exigir(ctx, 'imports', 'imports.view').ok,
      href: `/importar${qs}`,
      icon: 'upload_file',
      title: 'Trae tu catálogo',
      desc: 'Sube tus productos desde Excel (CSV). Si algo no cuadra, te dice qué fila y por qué.',
    },
    {
      hecho: stats.usuarios > 1,
      puede: exigir(ctx, 'users', 'users.view').ok,
      href: `/usuarios${qs}`,
      icon: 'group_add',
      title: 'Invita a tu equipo',
      desc: 'Cada quien con su rol: el cajero ve la caja, el contador los números.',
    },
    {
      hecho: stats.tourHecho,
      puede: exigir(ctx, 'tour', 'tour.view').ok,
      href: `/tutorial${qs}`,
      icon: 'school',
      title: 'Haz el recorrido guiado',
      desc: 'Cinco minutos, dentro de la propia pantalla.',
    },
  ].filter((p) => p.puede)
  const hechos = pasos.filter((p) => p.hecho).length
  const verDiagnostico = params.diagnostico === '1'

  return (
    <Shell {...shell} activePath="/" impersonating={params.impersonando === '1'}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {saludo()}, {shell.data.user.name.split(' ')[0]}
          </h1>
          <Badge tone={shell.data.tenant.status === 'active' ? 'success' : 'warning'}>
            {shell.data.tenant.tier.toUpperCase()}
          </Badge>
        </div>

        {pasos.length > 0 && hechos < pasos.length && (
          <section
            aria-labelledby="primeros-pasos"
            className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2
                id="primeros-pasos"
                className="text-sm font-semibold text-[var(--color-text-primary)]"
              >
                Deja tu negocio listo
              </h2>
              <span className="text-xs text-[var(--color-text-muted)]">
                {hechos} de {pasos.length} hechos
              </span>
              <div
                role="progressbar"
                aria-label="Avance de los primeros pasos"
                aria-valuemin={0}
                aria-valuemax={pasos.length}
                aria-valuenow={hechos}
                className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface-overlay)]"
              >
                <div
                  className="h-full rounded-[var(--radius-full)] bg-[var(--color-brand)]"
                  style={{ width: `${(hechos / pasos.length) * 100}%` }}
                />
              </div>
            </div>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {/* Lo pendiente primero. En el telefono lo hecho se esconde: la
                  barra ya dice cuantos van, y lo que queda se ve sin bajar. */}
              {[...pasos.filter((p) => !p.hecho), ...pasos.filter((p) => p.hecho)].map((p) => (
                <li key={p.href} className={p.hecho ? 'hidden sm:block' : undefined}>
                  <a
                    href={p.href}
                    className="flex h-full items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                  >
                    <span
                      aria-hidden
                      className={
                        p.hecho
                          ? 'grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-full)] bg-[color-mix(in_srgb,var(--color-semantic-success)_18%,transparent)]'
                          : 'grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-full)] bg-[var(--color-brand-soft)]'
                      }
                    >
                      <Icon
                        name={p.hecho ? 'check' : p.icon}
                        size={18}
                        className={
                          p.hecho
                            ? 'text-[var(--color-semantic-text-success)]'
                            : 'text-[var(--color-brand-bright)]'
                        }
                      />
                    </span>
                    <span className="min-w-0">
                      <span
                        className={
                          p.hecho
                            ? 'block text-sm font-semibold text-[var(--color-text-muted)] line-through'
                            : 'block text-sm font-semibold text-[var(--color-text-primary)]'
                        }
                      >
                        {p.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
                        {p.hecho ? 'Hecho.' : p.desc}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Lo del negocio primero: ventas, caja, inventario, cartera. Cada
            modulo declara sus widgets; el inicio solo los pinta. */}
        {shell.data.widgets.length > 0 && (
          <section aria-label="Tu negocio hoy" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ordenarWidgets(shell.data.widgets).map((w) => (
              <Widget key={w} clave={w} datos={datosWidgets} qs={qs} />
            ))}
          </section>
        )}

        <section aria-label="Tu cuenta" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Usuarios activos" value={String(stats.usuarios)} hint="con acceso hoy" />
          <StatCard
            label="Sucursales"
            value={String(stats.sucursales)}
            hint={`${stats.empresas} empresa${stats.empresas === 1 ? '' : 's'}`}
          />
          <StatCard label="Productos" value={String(stats.productos)} hint="en el catálogo" />
          <a
            href={`/marketplace${qs}`}
            className="rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <StatCard
              label="Módulos activos"
              value={String(stats.modulos)}
              hint="Ver qué más puedes encender"
            />
          </a>
        </section>

        {/* Solo para soporte: `?diagnostico=1`. Un cliente no tiene por que
            leer "rbac — El manifest no esta disponible en este bundle". */}
        {verDiagnostico && (
          <details open className="rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            <summary className="cursor-pointer px-4 py-3 text-sm text-[var(--color-text-muted)]">
              Diagnóstico del registry: {shell.data.sidebar.length} módulos visibles ·{' '}
              {shell.data.routeCount} rutas con permiso · {shell.data.unavailable.length} no
              cargados
            </summary>
            <div className="space-y-1 px-4 pb-4 text-xs text-[var(--color-text-secondary)]">
              {shell.data.unavailable.map((u) => (
                <p key={u.moduleId}>
                  <code className="font-[family-name:var(--font-mono)] text-[var(--color-semantic-text-warning)]">
                    {u.moduleId}
                  </code>{' '}
                  — {u.reason}
                </p>
              ))}
              {shell.data.unavailable.length === 0 && <p>Todo lo licenciado pudo cargarse.</p>}
            </div>
          </details>
        )}
      </div>
    </Shell>
  )
}

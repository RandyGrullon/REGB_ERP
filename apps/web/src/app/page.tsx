import { Badge, Icon, StatCard } from '@regb/ui'
import { redirect } from 'next/navigation'
import { asUser, db } from '@/lib/db'
import { modulePage, primeraRutaVisible, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { Widget, cargarDatosWidgets, type DatosWidgets } from '@/components/widgets'

export const dynamic = 'force-dynamic'

/**
 * Inicio — el modulo `dashboard` (S10).
 *
 * Indicadores reales del tenant, accesos rapidos y los widgets que cada
 * modulo declara en su manifest. Nada cableado: si un modulo se apaga,
 * su widget desaparece solo.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { impersonando?: string }>
}) {
  const params = await searchParams

  // Sin datos no hay demo que mostrar: instrucciones de arranque.
  const [algunTenant] = await db()<{ id: string }[]>`select id from regb.tenants limit 1`
  if (!algunTenant) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <Icon name="database" size={48} className="text-[var(--color-text-muted)]" />
          <h1 className="mt-4 text-xl font-semibold">No hay ningun cliente todavia</h1>
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
      { usuarios: string; sucursales: string; productos: string; empresas: string }[]
    >`
      select
        (select count(*) from public.memberships
          where tenant_id = ${ctx.tenantId} and is_active)                    as usuarios,
        (select count(*) from public.branches
          where tenant_id = ${ctx.tenantId} and is_active and deleted_at is null) as sucursales,
        (select count(*) from public.products
          where tenant_id = ${ctx.tenantId} and active)                       as productos,
        (select count(*) from public.companies
          where tenant_id = ${ctx.tenantId} and deleted_at is null)           as empresas`
    const s = {
      usuarios: Number(row?.usuarios ?? 0),
      sucursales: Number(row?.sucursales ?? 0),
      productos: Number(row?.productos ?? 0),
      empresas: Number(row?.empresas ?? 0),
    }
    // Los widgets van en el mismo `asUser`: una sola sesion de RLS para
    // toda la pantalla de inicio, que es la que mas se abre del ERP. Las
    // claves salen del registry —el dashboard no sabe de que modulo vino
    // cada una, ni le hace falta.
    const w: DatosWidgets = await cargarDatosWidgets(tx, ctx.tenantId, shell.data.widgets)
    return [s, w] as const
  })

  const qs = ctx.demoQs
  const accesos = [
    {
      href: `/usuarios${qs}`,
      icon: 'group_add',
      title: 'Invita a tu equipo',
      desc: 'Cada quien con su rol: el cajero ve la caja, el contador los numeros.',
    },
    {
      href: `/marketplace${qs}`,
      icon: 'extension',
      title: 'Activa modulos',
      desc: 'Empieza con lo minimo y agrega piezas cuando el negocio las pida.',
    },
    {
      href: `/importar${qs}`,
      icon: 'upload_file',
      title: 'Trae tus datos',
      desc: 'Sube tu catalogo desde CSV con validacion previa y deshacer.',
    },
    {
      href: `/tutorial${qs}`,
      icon: 'school',
      title: 'Aprende con el tour',
      desc: 'Primeros pasos guiados, dentro de la propia pantalla.',
    },
  ]

  return (
    <Shell {...shell} activePath="/" impersonating={params.impersonando === '1'}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            Buenos dias, {shell.data.user.name.split(' ')[0]}
          </h1>
          <Badge tone={shell.data.tenant.status === 'active' ? 'success' : 'warning'}>
            {shell.data.tenant.tier.toUpperCase()}
          </Badge>
        </div>

        <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Usuarios activos" value={String(stats.usuarios)} hint="con acceso hoy" />
          <StatCard
            label="Sucursales"
            value={String(stats.sucursales)}
            hint={`${stats.empresas} empresa${stats.empresas === 1 ? '' : 's'}`}
          />
          <StatCard label="Productos" value={String(stats.productos)} hint="en el catalogo" />
          <StatCard
            label="Modulos activos"
            value={String(shell.data.activeModules.length)}
            hint="licenciados y encendidos"
          />
        </section>

        <section aria-label="Accesos rapidos" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accesos.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <span
                aria-hidden
                className="grid h-10 w-10 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)]"
              >
                <Icon name={a.icon} size={22} className="text-[var(--color-brand-bright)]" />
              </span>
              <p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">
                {a.title}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{a.desc}</p>
            </a>
          ))}
        </section>

        {shell.data.widgets.length > 0 && (
          <section
            aria-label="Widgets de modulos"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {shell.data.widgets.map((w) => (
              <Widget key={w} clave={w} datos={datosWidgets} qs={qs} />
            ))}
          </section>
        )}

        <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <summary className="cursor-pointer px-4 py-3 text-sm text-[var(--color-text-muted)]">
            Diagnostico del registry: {shell.data.sidebar.length} modulos visibles ·{' '}
            {shell.data.routeCount} rutas con permiso · {shell.data.unavailable.length} no cargados
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
      </div>
    </Shell>
  )
}

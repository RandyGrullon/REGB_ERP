import { Card, CardBody, CardHeader, CardTitle } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { guardarConfiguracionForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Configuracion · REGB ERP' }

interface SettingsRow {
  trade_name: string | null
  timezone: string
  currency: string
  date_format: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] disabled:opacity-50'

/** Configuracion (S9): nombre comercial, zona horaria, moneda y formato. */
export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'settings')

  const [settings] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<SettingsRow[]>`
      select trade_name, timezone, currency, date_format
      from public.tenant_settings where tenant_id = ${ctx.tenantId}`,
  )

  const puedeEditar = exigir(ctx, 'settings', 'settings.edit').ok

  return (
    <Shell {...shell} activePath="/configuracion">
      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Configuracion</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Preferencias de {shell.data.tenant.name}. Aplican a todas tus empresas y usuarios.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Identidad y regional</CardTitle>
          </CardHeader>
          <CardBody>
            <form action={guardarConfiguracionForm} className="space-y-4">
              <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
              <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />

              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Nombre comercial (como te conocen tus clientes)
                <input
                  name="tradeName"
                  defaultValue={settings?.trade_name ?? ''}
                  disabled={!puedeEditar}
                  placeholder="La Esperanza"
                  className={inputCls}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Zona horaria
                  <select
                    name="timezone"
                    defaultValue={settings?.timezone ?? 'America/Santo_Domingo'}
                    disabled={!puedeEditar}
                    className={inputCls}
                  >
                    <option value="America/Santo_Domingo">Santo Domingo</option>
                    <option value="America/New_York">New York</option>
                    <option value="America/Mexico_City">Ciudad de Mexico</option>
                    <option value="America/Bogota">Bogota</option>
                    <option value="Europe/Madrid">Madrid</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Moneda
                  <select
                    name="currency"
                    defaultValue={settings?.currency ?? 'DOP'}
                    disabled={!puedeEditar}
                    className={inputCls}
                  >
                    <option value="DOP">Peso dominicano (DOP)</option>
                    <option value="USD">Dolar (USD)</option>
                    <option value="EUR">Euro (EUR)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Formato de fecha
                  <select
                    name="dateFormat"
                    defaultValue={settings?.date_format ?? 'DD/MM/YYYY'}
                    disabled={!puedeEditar}
                    className={inputCls}
                  >
                    <option value="DD/MM/YYYY">31/12/2026</option>
                    <option value="MM/DD/YYYY">12/31/2026</option>
                    <option value="YYYY-MM-DD">2026-12-31</option>
                  </select>
                </label>
              </div>

              {puedeEditar ? (
                <BotonEnvio
                  
                  className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Guardar cambios
                </BotonEnvio>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Tu rol &quot;{ctx.roleName}&quot; puede ver la configuracion pero no cambiarla.
                </p>
              )}
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan y modulos</CardTitle>
          </CardHeader>
          <CardBody className="text-sm text-[var(--color-text-secondary)]">
            <p>
              Estas en el plan <strong>{shell.data.tenant.tier.toUpperCase()}</strong> con{' '}
              {shell.data.activeModules.length} modulos activos. Activar o apagar modulos se hace
              desde el{' '}
              <a
                href={`/marketplace${ctx.demoQs}`}
                className="text-[var(--color-text-link)] hover:underline"
              >
                Marketplace
              </a>
              ; subir de plan, desde tu asesor REGB.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}

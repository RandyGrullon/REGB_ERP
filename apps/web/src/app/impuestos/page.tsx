import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { TIPOS_RETENCION_ISR_606 } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import {
  alternarReglaForm,
  alternarTasaForm,
  crearReglaForm,
  crearTasaForm,
  sembrarTasasForm,
} from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Impuestos · REGB ERP' }

interface TasaRow {
  id: string
  code: string
  name: string
  kind: string
  rate: string
  is_default: boolean
  is_active: boolean
  effective_from: string
}

interface ReglaRow {
  id: string
  code: string
  name: string
  tax: string
  party_type: string
  base: string
  rate: string
  dgii_isr_type: string | null
  is_active: boolean
}

const pct = (fraccion: string) =>
  `${(Number(fraccion) * 100).toLocaleString('es-DO', { maximumFractionDigits: 2 })}%`

const TIPO_PARTE: Record<string, string> = {
  fisica: 'Persona fisica',
  juridica: 'Persona juridica',
  ambas: 'Ambas',
}

const claseInput =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/**
 * Configuracion fiscal (modulo 24): las tasas de ITBIS y las reglas de
 * retencion que hasta hoy estaban cableadas o no existian.
 */
export default async function ImpuestosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'taxes')

  const [tasas, reglas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const t = await tx<TasaRow[]>`
      select id, code, name, kind, rate::text, is_default, is_active, effective_from::text
      from public.tax_rates
      where tenant_id = ${ctx.tenantId}
      order by is_active desc, kind, rate desc`
    const r = await tx<ReglaRow[]>`
      select id, code, name, tax, party_type, base, rate::text, dgii_isr_type, is_active
      from public.tax_withholding_rules
      where tenant_id = ${ctx.tenantId}
      order by is_active desc, tax, party_type`
    return [t, r] as const
  })

  const puedeTasas = exigir(ctx, 'taxes', 'taxes.rate.manage').ok
  const puedeReglas = exigir(ctx, 'taxes', 'taxes.rule.manage').ok
  const porDefecto = tasas.find((t) => t.is_active && t.is_default && t.kind === 'itbis')
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/impuestos">
      <div className="space-y-5">
        <PageHeader
          icon="percent"
          title="Impuestos"
          description="El catalogo de tasas de ITBIS de tu negocio y las reglas de retencion de tus proveedores, nombradas una vez y en un solo sitio."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="ITBIS por defecto"
            value={porDefecto ? pct(porDefecto.rate) : 'sin definir'}
            {...(porDefecto ? { hint: porDefecto.name } : {})}
          />
          <StatCard label="Tasas activas" value={String(tasas.filter((t) => t.is_active).length)} />
          <StatCard
            label="Reglas de retencion"
            value={String(reglas.filter((r) => r.is_active).length)}
            hint="activas"
          />
        </section>

        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-semantic-warning)] p-3 text-sm"
        >
          <Icon
            name="info"
            size={20}
            className="shrink-0 text-[var(--color-semantic-text-warning)]"
          />
          <p className="text-[var(--color-text-secondary)]">
            El 18%, el 16% y los dias de vencimiento vienen{' '}
            <strong className="text-[var(--color-text-primary)]">
              como punto de partida, no verificados contra una norma publicada este año
            </strong>
            . Por eso son una tabla que puedes editar y no un numero escondido en el sistema:
            revisalos con tu contador antes de tu primera declaracion.
          </p>
        </div>

        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-sm"
        >
          <Icon name="link_off" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
          <p className="text-[var(--color-text-secondary)]">
            Este catalogo{' '}
            <strong className="text-[var(--color-text-primary)]">
              todavia no alimenta a la facturacion
            </strong>
            . Cambiar la tasa por defecto aqui no cambia lo que cobra la caja: productos, pedidos,
            cotizaciones y ordenes de compra siguen llevando su propia tasa por linea, y esa se
            edita en Productos. Engancharlos es el paso siguiente y esta declarado, no escondido.
          </p>
        </div>

        <section aria-labelledby="tasas" className="space-y-2">
          <h2 id="tasas" className="text-sm font-semibold text-[var(--color-text-primary)]">
            Tasas
          </h2>
          {tasas.length === 0 ? (
            <EmptyState
              icon="percent"
              title="Todavia no hay ninguna tasa"
              description="Siembra las tres de la DGII -18% general, 16% reducida y exento- y ajustalas, o registra la tuya abajo."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Tasa</TH>
                  <TH>Tipo</TH>
                  <TH numeric>Porcentaje</TH>
                  <TH>Vigente desde</TH>
                  {puedeTasas && <TH>&nbsp;</TH>}
                </TR>
              </THead>
              <TBody>
                {tasas.map((t) => (
                  <TR key={t.id} className={t.is_active ? '' : 'opacity-50'}>
                    <TD>
                      <span className="font-medium text-[var(--color-text-primary)]">{t.name}</span>
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        <Mono>{t.code}</Mono>
                        {t.is_default && (
                          <Badge tone="brand" dot={false} className="ml-2">
                            por defecto
                          </Badge>
                        )}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-xs uppercase text-[var(--color-text-secondary)]">
                        {t.kind}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{pct(t.rate)}</span>
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {t.effective_from}
                      </span>
                    </TD>
                    {puedeTasas && (
                      <TD>
                        <form action={alternarTasaForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="id" value={t.id} />
                          <BotonEnvio className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                            {t.is_active ? 'Desactivar' : 'Activar'}
                          </BotonEnvio>
                        </form>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        {puedeTasas && tasas.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Empezar con las tasas de la DGII</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={sembrarTasasForm} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="download" size={18} />
                  Sembrar 18%, 16% y exento
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Se crean como punto de partida y quedan editables. Nada las vuelve a escribir
                  despues.
                </p>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeTasas && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar una tasa</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearTasaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input name="code" required placeholder="ITBIS-18" className={claseInput} />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    placeholder="ITBIS general 18%"
                    className={claseInput}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Impuesto
                  <select name="kind" defaultValue="itbis" className={claseInput}>
                    <option value="itbis">ITBIS</option>
                    <option value="isc">ISC</option>
                    <option value="propina">Propina legal</option>
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Porcentaje (%)
                  <input
                    name="rate"
                    required
                    inputMode="decimal"
                    placeholder="18"
                    title="En porcentaje: 18 es el 18%. Se guarda en fraccion (0.18), que es la convencion de la tabla."
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex items-center gap-2 pb-2.5 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" name="isDefault" />
                  Por defecto
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        <section aria-labelledby="reglas" className="space-y-2">
          <h2 id="reglas" className="text-sm font-semibold text-[var(--color-text-primary)]">
            Reglas de retencion
          </h2>
          {reglas.length === 0 ? (
            <EmptyState
              icon="account_balance_wallet"
              title="Todavia no hay reglas de retencion"
              description="Aqui se define cuanto se le retiene a un proveedor de ITBIS y de ISR. Cuentas por pagar tiene el campo, pero el numero que va dentro lo decides tu."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Regla</TH>
                  <TH>Impuesto</TH>
                  <TH>Proveedor</TH>
                  <TH>Se aplica sobre</TH>
                  <TH numeric>Porcentaje</TH>
                  <TH>Codigo DGII</TH>
                  {puedeReglas && <TH>&nbsp;</TH>}
                </TR>
              </THead>
              <TBody>
                {reglas.map((r) => (
                  <TR key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                    <TD>
                      <span className="font-medium text-[var(--color-text-primary)]">{r.name}</span>
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        <Mono>{r.code}</Mono>
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={r.tax === 'itbis' ? 'info' : 'brand'} dot={false}>
                        {r.tax.toUpperCase()}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {TIPO_PARTE[r.party_type]}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {r.base === 'itbis' ? 'el ITBIS facturado' : 'el subtotal pagado'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{pct(r.rate)}</span>
                    </TD>
                    <TD>
                      {r.dgii_isr_type ? (
                        <>
                          <Mono>{r.dgii_isr_type}</Mono>{' '}
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {TIPOS_RETENCION_ISR_606[r.dgii_isr_type]}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">no aplica</span>
                      )}
                    </TD>
                    {puedeReglas && (
                      <TD>
                        <form action={alternarReglaForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="id" value={r.id} />
                          <BotonEnvio className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                            {r.is_active ? 'Desactivar' : 'Activar'}
                          </BotonEnvio>
                        </form>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        {puedeReglas && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar una regla de retencion</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearReglaForm} className="space-y-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Codigo
                    <input name="code" required placeholder="ISR-HON" className={claseInput} />
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Nombre
                    <input
                      name="name"
                      required
                      placeholder="ISR honorarios 10%"
                      className={claseInput}
                    />
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Impuesto
                    <select name="tax" defaultValue="isr" className={claseInput}>
                      <option value="itbis">ITBIS</option>
                      <option value="isr">ISR</option>
                    </select>
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Se le aplica a
                    <select name="partyType" defaultValue="fisica" className={claseInput}>
                      <option value="fisica">Persona fisica</option>
                      <option value="juridica">Persona juridica</option>
                      <option value="ambas">Ambas</option>
                    </select>
                  </label>
                  <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Porcentaje (%)
                    <input
                      name="rate"
                      required
                      inputMode="decimal"
                      placeholder="10"
                      title="En porcentaje: 10 es el 10%, y 1 es el 1%. Antes un 1 se guardaba como 100%."
                      className={`tabular text-right ${claseInput}`}
                    />
                  </label>
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Codigo DGII (solo ISR)
                    <select name="dgiiIsrType" defaultValue="" className={claseInput}>
                      <option value="">— sin codigo —</option>
                      {Object.entries(TIPOS_RETENCION_ISR_606).map(([codigo, texto]) => (
                        <option key={codigo} value={codigo}>
                          {codigo} · {texto}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="add" size={18} />
                  Registrar regla
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  La base no se elige: el ITBIS se retiene sobre el ITBIS facturado y el ISR sobre
                  el subtotal pagado. Poder cambiarlo seria poder equivocarse por seis.
                </p>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}

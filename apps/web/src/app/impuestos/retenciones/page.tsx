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
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import {
  TIPOS_RETENCION_ISR_606,
  calcularRetenciones,
  desglosarItbis,
  type ReglaRetencion,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { asignarPerfilForm } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Retenciones · REGB ERP' }

interface ProveedorRow {
  id: string
  name: string
  tax_id: string | null
  party_type: string | null
  is_exempt: boolean | null
  itbis_rule_id: string | null
  isr_rule_id: string | null
  itbis_rule_name: string | null
  isr_rule_name: string | null
  notes: string | null
}

interface ReglaRow {
  id: string
  code: string
  name: string
  tax: 'itbis' | 'isr'
  party_type: 'fisica' | 'juridica' | 'ambas'
  base: 'itbis' | 'subtotal'
  rate: string
  dgii_isr_type: string | null
  /** Solo para desempatar entre varias candidatas, de forma explicita. */
  effective_from: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pct = (fraccion: string) =>
  `${(Number(fraccion) * 100).toLocaleString('es-DO', { maximumFractionDigits: 2 })}%`

const num = (raw: string | undefined): number | null => {
  if (raw === undefined) return null
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const claseInput =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

type Params = DemoParams & {
  proveedor?: string
  subtotal?: string
  itbis?: string
  servicios?: string
}

/**
 * Retenciones (modulo 24): quien es cada proveedor a ojos de la DGII y
 * cuanto hay que retenerle.
 *
 * La calculadora es un formulario GET a proposito: calcular no cambia
 * nada, el resultado se puede compartir por enlace y sobrevive a recargar.
 * Y se calcula ANTES de guardar cualquier cosa, porque el usuario tiene
 * que VER el numero para aceptarlo -escribirlo en la factura sigue siendo
 * cosa de /pagar, que es de otro dueño-.
 */
export default async function RetencionesPage({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'taxes')

  // Sin `suppliers` activo no hay proveedores que perfilar. Se dice, no se
  // pinta una tabla vacia que parece un error del sistema.
  const veProveedores = exigir(ctx, 'suppliers', 'suppliers.view').ok

  const [proveedores, reglas, tasaDefecto] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = veProveedores
      ? await tx<ProveedorRow[]>`
          select s.id, s.name, s.tax_id,
                 p.party_type, p.is_exempt, p.itbis_rule_id, p.isr_rule_id, p.notes,
                 ri.name as itbis_rule_name, rr.name as isr_rule_name
          from public.suppliers s
          left join public.supplier_tax_profiles p on p.supplier_id = s.id
          left join public.tax_withholding_rules ri on ri.id = p.itbis_rule_id
          left join public.tax_withholding_rules rr on rr.id = p.isr_rule_id
          where s.tenant_id = ${ctx.tenantId} and s.is_active
          order by s.name`
      : []

    const r = await tx<ReglaRow[]>`
      select id, code, name, tax, party_type, base, rate::text, dgii_isr_type,
             effective_from::text
      from public.tax_withholding_rules
      where tenant_id = ${ctx.tenantId} and is_active
      order by tax, party_type`
    // La tasa por defecto del catalogo, para CONTRASTAR el ITBIS tecleado.
    // Es el unico sitio donde tax_rates alimenta un calculo; el resto del
    // sistema todavia no la lee, y la pantalla de Impuestos lo dice.
    const [t] = await tx<{ rate: string }[]>`
      select rate::text
      from public.tax_rates
      where tenant_id = ${ctx.tenantId} and kind = 'itbis' and is_active and is_default`
    return [p, r, t ? Number(t.rate) : null] as const
  })

  const puedeAsignar = exigir(ctx, 'taxes', 'taxes.profile.assign').ok
  const qs = ctx.demoQs

  const conPerfil = proveedores.filter((p) => p.party_type !== null)
  const reglasItbis = reglas.filter((r) => r.tax === 'itbis')
  const reglasIsr = reglas.filter((r) => r.tax === 'isr')

  // ── Calculadora ──────────────────────────────────────────────────────
  const elegido = proveedores.find((p) => p.id === params.proveedor)
  const subtotal = num(params.subtotal)
  const itbis = num(params.itbis)
  const servicios = num(params.servicios)
  const aDomain = (r: ReglaRow, comodin: boolean): ReglaRetencion => ({
    tax: r.tax,
    // Una regla asignada A MANO a este proveedor ya expreso la intencion
    // de quien la asigno: se marca comodin para que aplique aunque su
    // party_type diga otra cosa. Las reglas generales conservan el suyo.
    partyType: comodin ? 'ambas' : r.party_type,
    base: r.base,
    rate: Number(r.rate),
    dgiiIsrType: r.dgii_isr_type,
    // El desempate entre varias candidatas se decide con estos dos, no
    // con el orden en que Postgres las devuelva.
    code: r.code,
    effectiveFrom: r.effective_from,
  })

  const reglasDelCalculo: ReglaRetencion[] = []
  if (elegido) {
    const asignadaItbis = reglas.find((r) => r.id === elegido.itbis_rule_id)
    const asignadaIsr = reglas.find((r) => r.id === elegido.isr_rule_id)
    if (asignadaItbis) reglasDelCalculo.push(aDomain(asignadaItbis, true))
    else reglasDelCalculo.push(...reglasItbis.map((r) => aDomain(r, false)))
    if (asignadaIsr) reglasDelCalculo.push(aDomain(asignadaIsr, true))
    else reglasDelCalculo.push(...reglasIsr.map((r) => aDomain(r, false)))
  }

  const resultado =
    elegido && elegido.party_type !== null && subtotal !== null && itbis !== null
      ? calcularRetenciones(
          {
            subtotal,
            itbis,
            partyType: elegido.party_type === 'juridica' ? 'juridica' : 'fisica',
            isExempt: elegido.is_exempt === true,
            // Se OMITE cuando no se dijo: pasar undefined no es lo mismo
            // que no pasarlo, y sin el la base del ISR es el subtotal
            // completo, que es el caso del proveedor de puro servicio.
            ...(servicios !== null ? { servicios } : {}),
          },
          reglasDelCalculo,
        )
      : null

  // El ITBIS se teclea a mano y no se contrasta con nada: si viene mal
  // -o el proveedor lo calculo mal-, la retencion de ITBIS sale mal en la
  // misma proporcion. desglosarItbis() ya sabe cual deberia ser.
  const itbisEsperado =
    tasaDefecto !== null && subtotal !== null && tasaDefecto > 0
      ? desglosarItbis(subtotal * (1 + tasaDefecto), tasaDefecto).itbis
      : null
  const itbisSospechoso =
    itbisEsperado !== null && itbis !== null && Math.abs(itbis - itbisEsperado) > 0.01

  return (
    <Shell {...shell} activePath="/impuestos/retenciones">
      <div className="space-y-5">
        <PageHeader
          icon="account_balance_wallet"
          title="Retenciones"
          description="Que es cada proveedor a ojos de la DGII y cuanto hay que retenerle. El numero se ve antes de aceptarlo."
          crumbs={[{ label: 'Impuestos', href: `/impuestos${qs}` }, { label: 'Retenciones' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Proveedores con perfil" value={String(conPerfil.length)} />
          <StatCard
            label="Exentos"
            value={String(conPerfil.filter((p) => p.is_exempt).length)}
            hint="zona franca o regimen especial"
          />
          <StatCard label="Reglas disponibles" value={String(reglas.length)} />
        </section>

        <div
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm"
          role="note"
        >
          <Icon name="info" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
          <p className="text-[var(--color-text-secondary)]">
            Esto <strong className="text-[var(--color-text-primary)]">calcula</strong> la
            retencion; no la escribe en la factura. El monto retenido y su codigo se siguen
            guardando en <strong className="text-[var(--color-text-primary)]">Cuentas por pagar</strong>,
            que es donde vive la factura del proveedor. Conectar las dos cosas es el paso siguiente
            y esta declarado, no escondido.
          </p>
        </div>

        {reglas.length === 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] p-3 text-sm"
          >
            <Icon
              name="warning"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-warning)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              No hay ninguna regla de retencion activa, asi que la calculadora va a dar cero
              siempre. Registra la primera en{' '}
              <a
                href={`/impuestos${qs}`}
                className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                Impuestos
              </a>
              .
            </p>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Cuanto le retengo a este proveedor</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
              <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Proveedor
                <select name="proveedor" defaultValue={params.proveedor ?? ''} className={claseInput}>
                  <option value="">— elige —</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.party_type === null ? ' (sin perfil)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Subtotal
                <input
                  name="subtotal"
                  inputMode="decimal"
                  defaultValue={params.subtotal ?? ''}
                  placeholder="10000.00"
                  className={`tabular text-right ${claseInput}`}
                />
              </label>
              <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                ITBIS facturado
                <input
                  name="itbis"
                  inputMode="decimal"
                  defaultValue={params.itbis ?? ''}
                  placeholder="1800.00"
                  className={`tabular text-right ${claseInput}`}
                />
              </label>
              <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                De eso, servicios
                <input
                  name="servicios"
                  inputMode="decimal"
                  defaultValue={params.servicios ?? ''}
                  placeholder="todo"
                  title="El ISR se retiene sobre los servicios, no sobre los bienes. En blanco = todo el subtotal es servicios."
                  className={`tabular text-right ${claseInput}`}
                />
              </label>
              <ToolbarActions
                label="Calcular"
                hasFilters={params.proveedor !== undefined}
                clearHref={`/impuestos/retenciones${qs}`}
              />
            </Toolbar>

            {resultado === null ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Elige un proveedor que ya tenga perfil fiscal y escribe el subtotal y el ITBIS de
                la factura. Un proveedor sin perfil no se le retiene nada, porque nadie ha dicho
                todavia si es persona fisica o juridica.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard
                    label="Retencion de ITBIS"
                    value={`RD$ ${money(resultado.itbisRetenido)}`}
                    hint="sobre el ITBIS facturado"
                  />
                  <StatCard
                    label="Retencion de ISR"
                    value={`RD$ ${money(resultado.isrRetenido)}`}
                    hint={servicios === null ? 'sobre el subtotal' : 'sobre los servicios'}
                  />
                  <StatCard
                    label="Total retenido"
                    value={`RD$ ${money(resultado.totalRetenido)}`}
                    {...(resultado.tipoRetencionIsr
                      ? {
                          hint: `codigo DGII ${resultado.tipoRetencionIsr} · ${
                            TIPOS_RETENCION_ISR_606[resultado.tipoRetencionIsr] ?? ''
                          }`,
                        }
                      : {})}
                  />
                  <StatCard
                    label="Neto al proveedor"
                    value={`RD$ ${money(resultado.netoAPagar)}`}
                    hint="lo que se le paga"
                  />
                </div>
                {servicios !== null && subtotal !== null && servicios < subtotal && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    El ISR se calculo sobre{' '}
                    <strong className="text-[var(--color-text-secondary)]">
                      RD$ {money(Math.min(servicios, subtotal))}
                    </strong>{' '}
                    de servicios, no sobre el subtotal completo: a una persona fisica se le retiene
                    por la mano de obra, no por las piezas. Es el mismo numero que despues va en
                    el campo de servicios de la factura, para el 606.
                  </p>
                )}
                {itbisSospechoso && itbisEsperado !== null && (
                  <p className="text-xs text-[var(--color-semantic-text-warning)]">
                    Con la tasa por defecto de tu catalogo, el ITBIS de un subtotal de{' '}
                    RD$ {money(subtotal ?? 0)} daria{' '}
                    <strong>RD$ {money(itbisEsperado)}</strong> y escribiste RD$ {money(itbis ?? 0)}
                    . Puede estar bien -hay lineas exentas y tasas reducidas-, pero si es un
                    dedazo la retencion de ITBIS sale mal en la misma proporcion.
                  </p>
                )}
                {(resultado.candidatas.isr > 1 || resultado.candidatas.itbis > 1) && (
                  <p className="text-xs text-[var(--color-semantic-text-warning)]">
                    Este proveedor no tiene una regla asignada y habia{' '}
                    {resultado.candidatas.isr > 1
                      ? `${resultado.candidatas.isr} reglas de ISR`
                      : `${resultado.candidatas.itbis} reglas de ITBIS`}{' '}
                    que le podian aplicar. Se uso{' '}
                    <Mono>
                      {resultado.candidatas.isr > 1
                        ? (resultado.reglaAplicada.isr ?? '—')
                        : (resultado.reglaAplicada.itbis ?? '—')}
                    </Mono>{' '}
                    -la de vigencia mas reciente-. Asignale su regla en el formulario de abajo para
                    que no lo decida un desempate.
                  </p>
                )}
                {elegido?.is_exempt === true && (
                  <p className="text-xs text-[var(--color-semantic-text-warning)]">
                    Este proveedor esta marcado como exento, asi que no se le retiene nada. Si eso
                    ya no es cierto, quitale la marca abajo.
                  </p>
                )}
                {resultado.isrRetenido > 0 && resultado.tipoRetencionIsr === null && (
                  <p className="text-xs text-[var(--color-semantic-text-danger)]">
                    La regla de ISR no trae codigo de la DGII. Sin el, la factura no puede llenar
                    su tipo de retencion y el 606 del periodo rebota entero.
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>

        {!veProveedores ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] p-3 text-sm"
          >
            <Icon
              name="warning"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-warning)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              El modulo de <strong className="text-[var(--color-text-primary)]">Proveedores</strong>{' '}
              no esta activo, asi que no hay a quien asignarle un perfil fiscal. Las tasas y las
              reglas siguen funcionando.
            </p>
          </div>
        ) : proveedores.length === 0 ? (
          <EmptyState
            icon="local_shipping"
            title="Todavia no hay proveedores"
            description="Registra tus proveedores y despues vuelve aqui a decir cuales son personas fisicas y cuales juridicas."
          />
        ) : (
          <section aria-labelledby="perfiles" className="space-y-2">
            <h2 id="perfiles" className="text-sm font-semibold text-[var(--color-text-primary)]">
              Perfil fiscal por proveedor
            </h2>
            <Table>
              <THead>
                <TR>
                  <TH>Proveedor</TH>
                  <TH>Tipo</TH>
                  <TH>Regla de ITBIS</TH>
                  <TH>Regla de ISR</TH>
                </TR>
              </THead>
              <TBody>
                {proveedores.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <span className="font-medium text-[var(--color-text-primary)]">{p.name}</span>
                      {p.tax_id && (
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          <Mono>{p.tax_id}</Mono>
                        </span>
                      )}
                    </TD>
                    <TD>
                      {p.party_type === null ? (
                        <Badge tone="warning">sin perfil</Badge>
                      ) : p.is_exempt ? (
                        <Badge tone="info" dot={false}>
                          exento
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot={false}>
                          {p.party_type === 'fisica' ? 'persona fisica' : 'persona juridica'}
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {p.itbis_rule_name ?? '—'}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {p.isr_rule_name ?? '—'}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        )}

        {puedeAsignar && veProveedores && proveedores.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Asignar perfil fiscal</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={asignarPerfilForm} className="space-y-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Proveedor
                    <select name="supplierId" required className={claseInput}>
                      {proveedores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Es una
                    <select name="partyType" defaultValue="juridica" className={claseInput}>
                      <option value="juridica">Persona juridica</option>
                      <option value="fisica">Persona fisica</option>
                    </select>
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Regla de ITBIS
                    <select name="itbisRuleId" defaultValue="" className={claseInput}>
                      <option value="">— la que toque por tipo —</option>
                      {reglasItbis.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({pct(r.rate)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Regla de ISR
                    <select name="isrRuleId" defaultValue="" className={claseInput}>
                      <option value="">— la que toque por tipo —</option>
                      {reglasIsr.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({pct(r.rate)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 pb-2.5 text-xs text-[var(--color-text-muted)]">
                    <input type="checkbox" name="isExempt" />
                    Exento
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nota
                  <input
                    name="notes"
                    placeholder="Zona franca, certificacion vigente hasta..."
                    className={claseInput}
                  />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="save" size={18} />
                  Guardar perfil
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Marcar exento borra las reglas asignadas: un proveedor exento con regla es una
                  contradiccion que se descubre cuando ya se le retuvo dinero que no tocaba.
                </p>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}

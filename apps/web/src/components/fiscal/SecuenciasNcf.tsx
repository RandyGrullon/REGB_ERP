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
import { NCF_LABELS, fechaFiscal, sequenceHealth, type NcfType } from '@regb/operations'
import { asUser } from '@/lib/db'
import type { ModulePageCtx } from '@/lib/module-page'
import { BotonEnvio } from '@/components/BotonEnvio'
import { ajustarSecuenciaForm, registrarSecuenciaForm } from '@/app/cobrar/ncf/actions'

interface SeqRow {
  id: string
  ncf_type: NcfType
  range_from: number
  range_to: number
  next_number: number
  expires_on: string
  authorization_ref: string | null
  is_active: boolean
  adjusted_reason: string | null
}

type Estado = 'en uso' | 'en espera' | 'agotada' | 'vencida' | 'desactivada'

const TONO: Record<Estado, 'success' | 'info' | 'danger' | 'neutral'> = {
  'en uso': 'success',
  'en espera': 'info',
  agotada: 'danger',
  vencida: 'danger',
  desactivada: 'neutral',
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'
const inputChico =
  'h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/**
 * Secuencias NCF (base fiscal DGII), la pantalla que comparten Por cobrar
 * y la Caja.
 *
 * Lo primero que configura un cliente dominicano: sin una autorizacion
 * cargada no puede emitir una sola factura valida. La pantalla insiste en
 * lo que de verdad duele -cuantos quedan y cuando vence- porque pedirle a
 * la DGII una autorizacion nueva toma dias y quedarse sin NCF detiene el
 * negocio.
 *
 * Desde la 0129 pueden convivir varias del mismo tipo: se dice cual esta
 * EN USO (la que da el proximo numero) y cuales esperan su turno.
 */
export async function SecuenciasNcf({
  ctx,
  puedeGestionar,
  crumbs,
}: {
  ctx: ModulePageCtx
  puedeGestionar: boolean
  crumbs: { label: string; href?: string }[]
}) {
  const secuencias = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<SeqRow[]>`
      select s.id, s.ncf_type, s.range_from, s.range_to, s.next_number,
             s.expires_on::text, s.authorization_ref, s.is_active, s.adjusted_reason
      from public.ncf_sequences s
      where s.tenant_id = ${ctx.tenantId}
      order by s.is_active desc, s.ncf_type, s.range_from, s.created_at`,
  )

  const qs = ctx.demoQs
  // El dia de hoy en RD, a medianoche: una autorizacion vale hasta el
  // final de su ultimo dia (assign_ncf compara con hoy_fiscal()).
  const hoy = new Date(`${fechaFiscal(new Date())}T00:00:00`)

  // La que da el proximo numero de cada tipo: la vigente de rango mas bajo
  // con numeros, igual que assign_ncf() en la 0129.
  const enUso = new Set<string>()
  const salud = secuencias.map((s) => {
    const h = sequenceHealth(
      {
        tipo: s.ncf_type,
        desde: s.range_from,
        hasta: s.range_to,
        proximo: s.next_number,
        vence: new Date(`${s.expires_on}T12:00:00`),
      },
      hoy,
    )
    return { fila: s, h }
  })
  // `salud` ya viene en el orden de assign_ncf (tipo, rango, alta): la
  // primera util de cada tipo es la que esta en uso.
  const tiposEnUso = new Set<string>()
  for (const { fila, h } of salud) {
    if (!fila.is_active || h.agotada || h.vencida || tiposEnUso.has(fila.ncf_type)) continue
    tiposEnUso.add(fila.ncf_type)
    enUso.add(fila.id)
  }
  const estado = (s: SeqRow, h: (typeof salud)[number]['h']): Estado =>
    !s.is_active
      ? 'desactivada'
      : h.agotada
        ? 'agotada'
        : h.vencida
          ? 'vencida'
          : enUso.has(s.id)
            ? 'en uso'
            : 'en espera'

  const activas = salud.filter((s) => s.fila.is_active)
  const utiles = activas.filter((s) => !s.h.agotada && !s.h.vencida)
  const enRiesgo = activas.filter((s) => s.h.agotada || s.h.vencida || s.h.porAgotarse)

  const fecha = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const ocultos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        icon="verified"
        title="Comprobantes fiscales (NCF)"
        description="Los rangos que te autorizo la DGII. Sin una secuencia vigente no puedes emitir una factura ni un ticket con comprobante valido."
        crumbs={crumbs}
      />

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Secuencias utiles"
          value={String(utiles.length)}
          hint="vigentes y con numeros"
        />
        <StatCard
          label="NCF disponibles"
          value={String(utiles.reduce((a, s) => a + s.h.restantes, 0))}
          hint="antes de pedir mas"
        />
        <StatCard
          label="Requieren atencion"
          value={String(enRiesgo.length)}
          hint="agotadas, vencidas o por agotarse"
        />
      </section>

      {enRiesgo.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_12%,transparent)] p-4 text-sm"
        >
          <Icon
            name="warning"
            size={20}
            filled
            className="shrink-0 text-[var(--color-semantic-text-warning)]"
          />
          <p className="text-[var(--color-text-secondary)]">
            Hay {enRiesgo.length} secuencia{enRiesgo.length === 1 ? '' : 's'} que necesita atencion.
            Pedirle a la DGII una autorizacion nueva toma dias:{' '}
            <strong className="text-[var(--color-text-primary)]">gestionala ahora</strong>, no
            cuando se acabe. Quedarte sin NCF significa no poder facturar.
          </p>
        </div>
      )}

      {secuencias.length === 0 ? (
        <EmptyState
          icon="verified"
          title="Todavia no has cargado ninguna autorizacion"
          description="Registra abajo el rango que te dio la DGII. Es lo primero: sin esto no se puede emitir factura."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Tipo</TH>
              <TH>Rango autorizado</TH>
              <TH numeric>Próximo</TH>
              <TH numeric>Quedan</TH>
              <TH>Vence</TH>
              <TH>Autorizacion</TH>
              <TH>Estado</TH>
            </TR>
          </THead>
          <TBody>
            {salud.map(({ fila: s, h }) => {
              const e = estado(s, h)
              return (
                <TR key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                  <TD>
                    <Mono>{s.ncf_type}</Mono>{' '}
                    <span className="text-[var(--color-text-secondary)]">
                      {NCF_LABELS[s.ncf_type]}
                    </span>
                  </TD>
                  <TD>
                    <span className="tabular text-xs">
                      {s.range_from} – {s.range_to}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{s.next_number}</span>
                  </TD>
                  <TD numeric>
                    <span
                      className={`tabular font-semibold ${
                        h.restantes === 0
                          ? 'text-[var(--color-semantic-text-danger)]'
                          : h.porAgotarse
                            ? 'text-[var(--color-semantic-text-warning)]'
                            : ''
                      }`}
                    >
                      {h.restantes}
                    </span>
                  </TD>
                  <TD>{fecha(s.expires_on)}</TD>
                  <TD>{s.authorization_ref ? <Mono>{s.authorization_ref}</Mono> : '—'}</TD>
                  <TD>
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={TONO[e]}>{e}</Badge>
                        {e === 'en uso' && h.porAgotarse && (
                          <Badge tone="warning">por agotarse</Badge>
                        )}
                      </span>
                      {s.adjusted_reason && (
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {s.adjusted_reason}
                        </span>
                      )}
                      {puedeGestionar && s.is_active && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-[var(--color-text-link)]">
                            Corregir
                          </summary>
                          <div className="mt-2 space-y-2">
                            <form
                              action={ajustarSecuenciaForm}
                              className="flex flex-wrap items-end gap-1"
                            >
                              {ocultos}
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="accion" value="vencimiento" />
                              <input
                                name="expiresOn"
                                type="date"
                                required
                                defaultValue={s.expires_on}
                                aria-label={`Vencimiento correcto de ${s.ncf_type} ${s.range_from}-${s.range_to}`}
                                className={inputChico}
                              />
                              <input
                                name="reason"
                                required
                                minLength={4}
                                placeholder="Motivo"
                                aria-label="Motivo de la correccion"
                                className={`w-36 ${inputChico}`}
                              />
                              <BotonEnvio className="h-8 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                Cambiar vencimiento
                              </BotonEnvio>
                            </form>
                            <form
                              action={ajustarSecuenciaForm}
                              className="flex flex-wrap items-end gap-1"
                            >
                              {ocultos}
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="accion" value="baja" />
                              <input
                                name="reason"
                                required
                                minLength={4}
                                placeholder="Motivo de la baja"
                                aria-label="Motivo para desactivar"
                                className={`w-44 ${inputChico}`}
                              />
                              <BotonEnvio
                                title="Deja de emitir con ella. Los numeros ya emitidos no cambian."
                                className="h-8 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]"
                              >
                                Desactivar
                              </BotonEnvio>
                            </form>
                          </div>
                        </details>
                      )}
                    </span>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {puedeGestionar && (
        <Card data-tour="ncf-autorizacion">
          <CardHeader>
            <CardTitle>Registrar autorizacion de la DGII</CardTitle>
          </CardHeader>
          <CardBody>
            <form action={registrarSecuenciaForm} className="flex flex-wrap items-end gap-3">
              {ocultos}
              <label className="flex w-56 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Tipo de comprobante
                <select name="ncfType" required defaultValue="B02" className={inputCls}>
                  {(Object.keys(NCF_LABELS) as NcfType[]).map((t) => (
                    <option key={t} value={t}>
                      {t} — {NCF_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Desde
                <input
                  name="rangeFrom"
                  required
                  inputMode="numeric"
                  defaultValue="1"
                  className={inputCls}
                />
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Hasta
                <input
                  name="rangeTo"
                  required
                  inputMode="numeric"
                  placeholder="1000"
                  className={inputCls}
                />
              </label>
              <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Vence
                <input name="expiresOn" required type="date" className={inputCls} />
              </label>
              <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                No. de autorizacion
                <input name="authRef" placeholder="AUT-2026-001" className={inputCls} />
              </label>
              <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                <Icon name="add" size={18} />
                Registrar
              </BotonEnvio>
            </form>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Una secuencia nueva <strong>no apaga</strong> la anterior: conviven y se usa primero
              la vigente de rango más bajo que tenga números. Un rango que se cruza con otro, o que
              repite números ya emitidos, se rechaza. El vencimiento se corrige y una secuencia se
              da de baja con motivo, sin tocar lo ya emitido: un NCF consumido nunca vuelve, ni
              aunque se anule la factura -la DGII espera verlo reportado como anulado en el 608-.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

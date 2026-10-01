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
import { formatTaxId, tieneDocumentoVencido } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  cambiarHomologacionForm,
  crearCuentaBancariaForm,
  crearDocumentoForm,
  registrarEvaluacionForm,
} from './actions'
import { ESTADO_HOMOLOGACION, TIPO_DOCUMENTO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Homologación de proveedores · REGB ERP' }

interface SupplierRow {
  id: string
  name: string
  tax_id: string | null
  qualification_status: string
  cuentas: string
}

interface DocumentoRow {
  id: string
  supplier_id: string
  doc_type: string
  expires_at: string | null
}

interface EvaluacionRow {
  supplier_id: string
  score: number
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' => {
  if (estado === 'qualified') return 'success'
  if (estado === 'disqualified') return 'danger'
  return 'warning'
}

/** Homologacion de proveedores (modulo 42): documentos con vigencia calculada, cuentas bancarias, evaluacion. */
export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'suppliers')

  const { proveedores, documentos, evaluaciones } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const p = await tx<SupplierRow[]>`
      select s.id, s.name, s.tax_id, s.qualification_status,
             (select count(*) from public.supplier_bank_accounts b
               where b.supplier_id = s.id)::text as cuentas
      from public.suppliers s
      where s.tenant_id = ${ctx.tenantId} and s.is_active order by s.name`

      const d = await tx<DocumentoRow[]>`
      select id, supplier_id, doc_type, expires_at::text from public.supplier_documents
      where tenant_id = ${ctx.tenantId}`

      const ev = await tx<EvaluacionRow[]>`
      select supplier_id, score from public.supplier_evaluations where tenant_id = ${ctx.tenantId}`

      return { proveedores: p, documentos: d, evaluaciones: ev }
    },
  )

  const hoy = new Date()
  const documentosPorProveedor = new Map<string, DocumentoRow[]>()
  for (const d of documentos) {
    const lista = documentosPorProveedor.get(d.supplier_id) ?? []
    lista.push(d)
    documentosPorProveedor.set(d.supplier_id, lista)
  }
  const evaluacionesPorProveedor = new Map<string, number[]>()
  for (const e of evaluaciones) {
    const lista = evaluacionesPorProveedor.get(e.supplier_id) ?? []
    lista.push(e.score)
    evaluacionesPorProveedor.set(e.supplier_id, lista)
  }

  const pendientes = proveedores.filter((p) => p.qualification_status === 'pending').length
  const conVencidos = proveedores.filter((p) =>
    tieneDocumentoVencido(
      (documentosPorProveedor.get(p.id) ?? []).map((d) => ({
        expiresAt: d.expires_at ? new Date(d.expires_at) : null,
      })),
      hoy,
    ),
  ).length
  // Fecha sin hora: en UTC para que no salga un día antes.
  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const puedeVerCompras = exigir(ctx, 'purchase-orders', 'purchase-orders.suppliers.manage').ok
  const puedeGestionar = exigir(ctx, 'suppliers', 'suppliers.manage').ok
  const puedeDocumentos = exigir(ctx, 'suppliers', 'suppliers.manage-documents').ok
  const puedeEvaluar = exigir(ctx, 'suppliers', 'suppliers.evaluate').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/proveedores">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title="Homologación de proveedores"
          description="Antes de comprarle a alguien, sus papeles en regla: certificado del RNC, estar al día con la DGII, seguro y contrato, cada uno con su vencimiento. También sus cuentas de banco y cómo ha cumplido."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Pendientes de homologar"
            value={String(pendientes)}
            hint="falta revisar sus papeles"
          />
          <StatCard
            label="Con documentos vencidos"
            value={String(conVencidos)}
            hint="pedirles la renovación"
          />
          <StatCard label="Proveedores activos" value={String(proveedores.length)} />
        </section>

        {proveedores.length === 0 ? (
          <EmptyState
            icon="local_shipping"
            title="Todavía no hay ningún proveedor"
            description="La homologación trabaja sobre la ficha del proveedor. Regístralo primero en Órdenes de compra, en Proveedores, y vuelve aquí para sus papeles."
            action={
              puedeVerCompras ? (
                <a
                  href={`/compras/proveedores${qs}`}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Registrar un proveedor
                </a>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proveedor</TH>
                <TH>Homologación</TH>
                <TH numeric>Documentos</TH>
                <TH>Vigencia</TH>
                <TH numeric>Cuentas de banco</TH>
                <TH numeric>Evaluación</TH>
              </TR>
            </THead>
            <TBody>
              {proveedores.map((p) => {
                const docs = documentosPorProveedor.get(p.id) ?? []
                const vencido = tieneDocumentoVencido(
                  docs.map((d) => ({ expiresAt: d.expires_at ? new Date(d.expires_at) : null })),
                  hoy,
                )
                const scores = evaluacionesPorProveedor.get(p.id) ?? []
                const promedio =
                  scores.length > 0
                    ? `${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)} de 5`
                    : 'Sin evaluar'
                // El que vence primero entre los que todavía no han vencido.
                const proximo = docs
                  .filter((d) => d.expires_at && new Date(d.expires_at) >= hoy)
                  .map((d) => d.expires_at!)
                  .sort()[0]
                return (
                  <TR key={p.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      {p.name}
                      {p.tax_id && (
                        <span className="block text-xs text-[var(--color-text-muted)]">
                          RNC <Mono>{formatTaxId(p.tax_id)}</Mono>
                        </span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Badge tone={badgeTono(p.qualification_status)}>
                          {ESTADO_HOMOLOGACION[p.qualification_status] ?? p.qualification_status}
                        </Badge>
                        {puedeGestionar && (
                          <form
                            action={cambiarHomologacionForm}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="supplierId" value={p.id} />
                            <select
                              name="status"
                              defaultValue={p.qualification_status}
                              aria-label={`Cambiar homologación de ${p.name}`}
                              className={claseInput}
                            >
                              {Object.entries(ESTADO_HOMOLOGACION).map(([id, label]) => (
                                <option key={id} value={id}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <BotonEnvio
                              aria-label={`Guardar homologación de ${p.name}`}
                              className="flex h-9 items-center rounded-full border border-[var(--color-border)] px-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                            >
                              <Icon name="save" size={14} />
                            </BotonEnvio>
                          </form>
                        )}
                      </div>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{docs.length}</span>
                    </TD>
                    <TD>
                      {docs.length === 0 ? (
                        '—'
                      ) : vencido ? (
                        <Badge tone="danger">Vencido</Badge>
                      ) : (
                        <Badge tone="success">Al día</Badge>
                      )}
                      {proximo && !vencido && (
                        <span className="block pt-1 text-xs text-[var(--color-text-muted)]">
                          próximo vence {dia(proximo)}
                        </span>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">{p.cuentas}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{promedio}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeDocumentos && proveedores.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar documento</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearDocumentoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proveedor
                  <select name="supplierId" required className={claseInput}>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select
                    name="docType"
                    required
                    defaultValue="rnc_certificate"
                    className={claseInput}
                  >
                    {Object.entries(TIPO_DOCUMENTO).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Número
                  <input name="docNumber" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Emitido
                  <input type="date" name="issuedAt" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vence
                  <input type="date" name="expiresAt" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeGestionar && proveedores.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar cuenta bancaria</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCuentaBancariaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proveedor
                  <select name="supplierId" required className={claseInput}>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Banco
                  <input name="bankName" required className={claseInput} />
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Número de cuenta
                  <input name="accountNumber" required className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="accountType" defaultValue="checking" className={claseInput}>
                    <option value="checking">Corriente</option>
                    <option value="savings">Ahorro</option>
                  </select>
                </label>
                <label className="flex w-20 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Moneda
                  <input name="currency" defaultValue="DOP" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="account_balance" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeEvaluar && proveedores.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar evaluación</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarEvaluacionForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proveedor
                  <select name="supplierId" required className={claseInput}>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nota del 1 al 5
                  <input
                    name="score"
                    inputMode="numeric"
                    required
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Evaluado por
                  <input name="evaluatedBy" className={claseInput} />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Comentarios
                  <input name="comments" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="star" size={14} />
                  Evaluar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}

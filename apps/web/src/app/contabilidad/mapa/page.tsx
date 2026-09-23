import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { PROPOSITOS_CONTABLES } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import { crearCuentasPorDefectoForm, guardarMapaCuentaForm } from '../actions'
import { TIPO_CUENTA } from '../estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mapa de cuentas · REGB ERP' }

interface Asignada {
  purpose: string
  account_id: string
  code: string
  name: string
  is_active: boolean
}

interface Cuenta {
  id: string
  code: string
  name: string
  type: string
}

const inputCls =
  'h-9 w-full min-w-48 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]'

/**
 * Mapa de cuentas (ADR 0001): a que cuenta del catalogo va cada parte de
 * los asientos automaticos. El primer asiento automatico lo llena solo con
 * el catalogo minimo; aqui se ve y se cambia.
 */
export default async function MapaContablePage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'accounting')

  const [asignadas, cuentas, automaticos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const a = await tx<Asignada[]>`
      select m.purpose, m.account_id, a.code, a.name, a.is_active
      from public.accounting_account_map m
      join public.accounts a on a.id = m.account_id
      where m.tenant_id = ${ctx.tenantId}`
    const c = await tx<Cuenta[]>`
      select id, code, name, type from public.accounts
      where tenant_id = ${ctx.tenantId} and is_active
      order by code`
    const [n] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.journal_entries
      where tenant_id = ${ctx.tenantId} and source_type <> 'manual'`
    return [a, c, Number(n?.n ?? 0)] as const
  })

  const porUso = new Map(asignadas.map((a) => [a.purpose, a]))
  const faltan = PROPOSITOS_CONTABLES.filter((p) => !porUso.has(p.proposito)).length
  const puedeGestionar = exigir(ctx, 'accounting', 'accounting.accounts.manage').ok
  const qs = ctx.demoQs
  const ocultos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  return (
    <Shell {...shell} activePath="/contabilidad">
      <div className="space-y-5">
        <PageHeader
          icon="alt_route"
          title="Mapa de cuentas"
          description="A que cuenta de tu catalogo va cada parte de los asientos que se generan solos: ventas de caja, facturas a credito, cobros, compras y pagos."
          crumbs={[{ label: 'Contabilidad', href: `/contabilidad${qs}` }, { label: 'Mapa de cuentas' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Usos asignados" value={`${PROPOSITOS_CONTABLES.length - faltan} de ${PROPOSITOS_CONTABLES.length}`} />
          <StatCard label="Asientos automaticos" value={String(automaticos)} />
        </section>

        {faltan > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-text-secondary)]"
          >
            <Icon name="info" size={18} />
            {faltan} uso(s) sin cuenta. Con la primera venta, cobro o compra se crean solas las
            cuentas del catalogo minimo; si prefieres verlas antes, crealas ahora.
          </p>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Uso</TH>
              <TH>Cuenta asignada</TH>
              <TH>Tipo que exige</TH>
              {puedeGestionar && <TH>Cambiar a</TH>}
            </TR>
          </THead>
          <TBody>
            {PROPOSITOS_CONTABLES.map((p) => {
              const a = porUso.get(p.proposito)
              const opciones = cuentas.filter((c) => c.type === p.tipo)
              return (
                <TR key={p.proposito}>
                  <TD>
                    <div className="font-medium text-[var(--color-text-primary)]">{p.etiqueta}</div>
                    <div className="max-w-md text-xs text-[var(--color-text-muted)]">{p.ayuda}</div>
                  </TD>
                  <TD>
                    {a ? (
                      <>
                        <Mono>{a.code}</Mono> {a.name}
                        {!a.is_active && (
                          <Badge tone="danger" dot={false} className="ml-1" title="Los asientos que la usan fallan hasta que la reactives o cambies">
                            desactivada
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">
                        Sin asignar · por defecto <Mono>{p.codigo}</Mono> {p.nombre}
                      </span>
                    )}
                  </TD>
                  <TD>{TIPO_CUENTA[p.tipo] ?? p.tipo}</TD>
                  {puedeGestionar && (
                    <TD>
                      <form action={guardarMapaCuentaForm} className="flex items-center gap-1.5">
                        {ocultos}
                        <input type="hidden" name="purpose" value={p.proposito} />
                        <select
                          name="accountId"
                          defaultValue={a?.account_id ?? ''}
                          aria-label={`Cuenta para ${p.etiqueta}`}
                          className={inputCls}
                        >
                          <option value="" disabled>
                            Elige una cuenta de {(TIPO_CUENTA[p.tipo] ?? p.tipo).toLowerCase()}
                          </option>
                          {opciones.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} {c.name}
                            </option>
                          ))}
                        </select>
                        <BotonEnvio className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                          Guardar
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
              )
            })}
          </TBody>
        </Table>

        {puedeGestionar && faltan > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Catalogo minimo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCuentasPorDefectoForm} className="flex flex-wrap items-center gap-3">
                {ocultos}
                <p className="flex-1 text-sm text-[var(--color-text-secondary)]">
                  Crea las cuentas que falten con los codigos por defecto y asigna los usos vacios.
                  No toca ninguna asignacion que ya hayas hecho.
                </p>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="playlist_add" size={18} />
                  Crear las que faltan
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}

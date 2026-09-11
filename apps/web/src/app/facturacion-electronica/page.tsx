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
} from '@regb/ui'
import {
  DIAS_MAX_SIN_SISTEMA,
  HORAS_PARA_REMITIR,
  LEYENDA_CONTINGENCIA,
  horasRestantesParaRemitir,
  urlsParaDeclarar,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'
import {
  asegurarConfigForm,
  cambiarAmbienteForm,
  cambiarContingenciaForm,
  rotarTokenForm,
} from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Facturacion electronica · REGB ERP' }

interface Config {
  ambiente: string
  endpoint_token: string
  certificado: boolean
  contingencia: string | null
  contingencia_desde: string | null
}

interface Pendiente {
  encf: string
  emitido_en: string
}

const AMBIENTES: { id: string; label: string; detalle: string }[] = [
  { id: 'testecf', label: 'Pre-certificacion', detalle: 'Pruebas libres. Los envios se guardan 60 dias.' },
  { id: 'certecf', label: 'Certificacion', detalle: 'El set de pruebas formal de la DGII.' },
  { id: 'ecf', label: 'Produccion', detalle: 'Validez fiscal real.' },
]

const CONTINGENCIAS: { id: string; label: string; detalle: string }[] = [
  {
    id: 'sin-conexion',
    label: 'Sin conexion',
    detalle: `Hay sistema pero no internet. Se siguen emitiendo e-CF y hay ${HORAS_PARA_REMITIR} horas para remitirlos.`,
  },
  {
    id: 'sin-sistema',
    label: 'Sin sistema',
    detalle: `No se puede emitir e-CF. Se vuelve al papel de la serie B, maximo ${DIAS_MAX_SIN_SISTEMA} dias, y hay que avisar a la DGII por la Oficina Virtual.`,
  },
]

const inputClase =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] disabled:opacity-60'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] disabled:opacity-60'

/**
 * Facturacion electronica (modulo 25).
 *
 * La pantalla existe sobre todo por UNA cosa: enseñar las tres URL que
 * el contribuyente tiene que copiar al formulario de postulacion de la
 * DGII. Si una se escribe a mano y queda mal, la DGII le pega a una ruta
 * que no existe y la certificacion se cae en el paso 8 sin explicacion.
 */
export default async function FacturacionElectronicaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'e-invoice')

  const { config, emitidos, recibidos, pendientes } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [c] = await tx<Config[]>`
        select ambiente, endpoint_token, certificado, contingencia, contingencia_desde::text
        from public.ecf_config where tenant_id = ${ctx.tenantId}`

      const [e] = await tx<{ n: string }[]>`
        select count(*)::text as n from public.ecf_emitidos where tenant_id = ${ctx.tenantId}`
      const [r] = await tx<{ n: string }[]>`
        select count(*)::text as n from public.ecf_recibidos where tenant_id = ${ctx.tenantId}`

      const p = await tx<Pendiente[]>`
        select encf, emitido_en::text from public.ecf_emitidos
        where tenant_id = ${ctx.tenantId} and en_contingencia and remitido_en is null
        order by emitido_en limit 20`

      return { config: c ?? null, emitidos: Number(e?.n ?? 0), recibidos: Number(r?.n ?? 0), pendientes: p }
    },
  )

  const puedeGestionar = exigir(ctx, 'e-invoice', 'e-invoice.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  // La base publica sale del entorno: en desarrollo es localhost, y eso
  // NO sirve para declararlo a la DGII -la pantalla lo advierte-.
  const base = process.env['NEXT_PUBLIC_URL_BASE'] ?? 'http://localhost:3100'
  const urls = config ? urlsParaDeclarar(base, config.endpoint_token) : null
  const baseEsLocal = /localhost|127\.0\.0\.1/.test(base)
  const ahora = new Date()

  return (
    <Shell {...shell} activePath="/facturacion-electronica">
      <div className="space-y-5">
        <PageHeader
          icon="receipt_long"
          title="Facturacion electronica"
          description="e-CF de la DGII. Obligatorio para un negocio pequeño desde el 15 de noviembre de 2026."
        />

        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-semantic-warning)] p-3 text-sm"
        >
          <Icon name="draft" size={20} className="shrink-0 text-[var(--color-semantic-text-warning)]" />
          <p className="text-[var(--color-text-secondary)]">
            Este modulo <strong className="text-[var(--color-text-primary)]">todavia no emite</strong>. Lo
            que hay listo es la configuracion, el enrutado de lo que entra y las reglas de negocio. Falta
            el certificado digital, la firma XAdES y la transmision, y{' '}
            <strong className="text-[var(--color-text-primary)]">
              nada se ha probado contra los servidores de la DGII
            </strong>
            .
          </p>
        </div>

        {config === null ? (
          <Card>
            <CardBody>
              <EmptyState
                icon="receipt_long"
                title="Todavia no has configurado la facturacion electronica"
                description="Al activarla generamos el token de tus URL publicas. Son las tres direcciones que la DGII te va a pedir en la postulacion."
              />
              {puedeGestionar && (
                <form action={asegurarConfigForm} className="mt-4 flex justify-center">
                  {campos}
                  <BotonEnvio className={botonClase}>
                    <Icon name="add" size={14} />
                    Configurar
                  </BotonEnvio>
                </form>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Ambiente"
                value={AMBIENTES.find((a) => a.id === config.ambiente)?.label ?? config.ambiente}
              />
              <StatCard label="Certificado" value={config.certificado ? 'Si' : 'No'} />
              <StatCard label="Emitidos" value={String(emitidos)} />
              <StatCard label="Recibidos" value={String(recibidos)} />
            </section>

            {config.contingencia !== null && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-danger)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_10%,transparent)] p-3 text-sm"
              >
                <Icon
                  name="warning"
                  size={20}
                  filled
                  className="shrink-0 text-[var(--color-semantic-text-danger)]"
                />
                <div className="text-[var(--color-text-secondary)]">
                  <p>
                    Contingencia activa:{' '}
                    <strong className="text-[var(--color-text-primary)]">
                      {CONTINGENCIAS.find((c) => c.id === config.contingencia)?.label}
                    </strong>
                    {config.contingencia_desde !== null &&
                      ` desde ${new Date(config.contingencia_desde).toLocaleString('es-DO')}`}
                    .
                  </p>
                  {config.contingencia === 'sin-conexion' && (
                    <p className="mt-1 text-xs">
                      Leyenda obligatoria en la representacion impresa:{' '}
                      <em className="text-[var(--color-text-primary)]">{LEYENDA_CONTINGENCIA}</em>
                    </p>
                  )}
                </div>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Las tres URL que declaras a la DGII</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                  La DGII no solo recibe: tambien te llama a ti. Copia estas tres tal cual al formulario
                  de postulacion. Llevan un token que es solo tuyo -tratalo como una contraseña-.
                </p>

                {baseEsLocal && (
                  <p className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-semantic-warning)] p-2 text-xs text-[var(--color-semantic-text-warning)]">
                    Estas URL apuntan a <Mono>{base}</Mono>, que es esta maquina. No sirven para declarar
                    nada: la DGII tiene que poder alcanzarlas desde internet.
                  </p>
                )}

                <dl className="space-y-2">
                  {urls !== null &&
                    (
                      [
                        ['Recepcion', urls.recepcion, 'Donde recibes los e-CF que otros te emiten.'],
                        ['Aprobacion', urls.aprobacion, 'Donde recibes aprobaciones o rechazos comerciales.'],
                        ['Autenticacion', urls.autenticacion, 'Tu propio servicio semilla → token.'],
                      ] as const
                    ).map(([titulo, url, detalle]) => (
                      <div key={titulo} className="rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-2">
                        <dt className="text-xs font-medium text-[var(--color-text-primary)]">{titulo}</dt>
                        <dd className="mt-0.5 break-all font-[family-name:var(--font-mono)] text-xs text-[var(--color-text-secondary)]">
                          {url}
                        </dd>
                        <dd className="text-[11px] text-[var(--color-text-muted)]">{detalle}</dd>
                      </div>
                    ))}
                </dl>

                {puedeGestionar && (
                  <form action={rotarTokenForm} className="mt-4">
                    {campos}
                    <BotonEnvio className={botonSecundarioClase}>
                      <Icon name="refresh" size={14} />
                      Rotar el token
                    </BotonEnvio>
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Despues de rotar hay que volver a declarar las tres URL en la DGII. Hasta que lo
                      hagas, le estara pegando a una ruta que ya no responde.
                    </p>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ambiente</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="mb-3 space-y-1 text-xs text-[var(--color-text-muted)]">
                  {AMBIENTES.map((a) => (
                    <li key={a.id}>
                      <Badge tone={a.id === config.ambiente ? 'brand' : 'neutral'} dot={false}>
                        {a.label}
                      </Badge>{' '}
                      {a.detalle}
                    </li>
                  ))}
                </ul>
                {puedeGestionar && (
                  <form action={cambiarAmbienteForm} className="flex flex-wrap items-end gap-3">
                    {campos}
                    <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Cambiar a
                      <select name="ambiente" defaultValue={config.ambiente} className={inputClase}>
                        {AMBIENTES.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <BotonEnvio className={botonClase}>Guardar</BotonEnvio>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contingencia</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="mb-3 space-y-1 text-xs text-[var(--color-text-muted)]">
                  {CONTINGENCIAS.map((c) => (
                    <li key={c.id}>
                      <strong className="text-[var(--color-text-primary)]">{c.label}:</strong> {c.detalle}
                    </li>
                  ))}
                </ul>
                {puedeGestionar && (
                  <form action={cambiarContingenciaForm} className="flex flex-wrap items-end gap-3">
                    {campos}
                    <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Estado
                      <select name="contingencia" defaultValue={config.contingencia ?? ''} className={inputClase}>
                        <option value="">Operando normal</option>
                        {CONTINGENCIAS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <BotonEnvio className={botonClase}>Guardar</BotonEnvio>
                  </form>
                )}
              </CardBody>
            </Card>

            {pendientes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Emitidos sin conexion, sin remitir</CardTitle>
                </CardHeader>
                <CardBody>
                  <ul className="divide-y divide-[var(--color-border)]">
                    {pendientes.map((p) => {
                      const horas = horasRestantesParaRemitir(new Date(p.emitido_en), ahora)
                      return (
                        <li key={p.encf} className="flex items-center justify-between gap-3 py-2">
                          <Mono>{p.encf}</Mono>
                          <Badge tone={horas < 0 ? 'danger' : horas < 12 ? 'warning' : 'neutral'}>
                            {horas < 0 ? 'Vencido' : `${horas} h restantes`}
                          </Badge>
                        </li>
                      )
                    })}
                  </ul>
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

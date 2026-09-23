import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { datosDeRespaldos, estadoDeRespaldos } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearRespaldo } from './actions'
import { alcanceDelRespaldo, nombreDeModulo } from './alcance'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Respaldos · REGB ERP' }

interface BackupRow {
  id: string
  kind: string
  formato: number
  size_bytes: number
  filas: number | null
  created_by_name: string | null
  created_at: string
  downloaded_at: string | null
}

/** El indice de un respaldo completo (0122): lo mismo que lleva arriba el archivo. */
interface Indice {
  filas: number
  modulos: string[]
  tablas: Record<string, number>
  fuera: { tabla: string; modulos: string[]; motivo: string; detalle: string | null }[]
  /** Tablas que entran solo con las filas de quien lo creo (p. ej. notificaciones). */
  personales: string[]
  omitido: { tabla: string; columna: string; motivo: string }[]
  no_incluye: string[]
}

const numero = (n: number) => n.toLocaleString('es-DO')
const tamano = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const unicos = (xs: string[]) => [...new Set(xs)].sort()

/** Respaldos (S11): tu informacion es tuya, llevatela cuando quieras. */
export default async function RespaldosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'backup')

  // Sin `payload`: en los respaldos del formato 1 ES el respaldo entero,
  // y aqui solo hace falta saber de que formato es y cuantas filas trae.
  const backups = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<BackupRow[]>`
      select b.id, b.kind, b.formato, b.size_bytes::float8 as size_bytes,
             case when b.formato = 2 then (b.payload ->> 'filas')::float8 end as filas,
             p.display_name as created_by_name, b.created_at::text,
             b.downloaded_at::text
      from public.backups b
      left join public.user_profiles p
        on p.tenant_id = b.tenant_id and p.user_id = b.created_by
      where b.tenant_id = ${ctx.tenantId}
      order by b.created_at desc
      limit 50`,
  )

  const puedeCrear = exigir(ctx, 'backup', 'backup.create').ok
  const puedeExportar = exigir(ctx, 'backup', 'backup.export').ok
  const alcance = alcanceDelRespaldo(ctx)

  // El estado se mide sobre el ultimo respaldo COMPLETO que SALIO de aqui:
  // el que sigue dentro de la base se pierde con ella, y uno del formato
  // viejo no trae las ventas. Ver `estadoDeRespaldos`.
  //
  // Se calcula sobre las 50 filas que ya se leyeron, no con otra consulta:
  // si el ultimo que salio fuese mas viejo que las 50 ultimas, el aviso
  // solo se queda corto en el sentido seguro -avisa de mas, nunca de menos-.
  const estado = estadoDeRespaldos(
    datosDeRespaldos(
      backups.map((b) => ({
        creado: new Date(b.created_at),
        salio: b.downloaded_at ? new Date(b.downloaded_at) : null,
        completo: b.formato === 2,
      })),
    ),
    new Date(),
  )
  const tonoAviso: Record<string, string> = {
    'sin-respaldo': 'danger',
    'solo-parciales': 'danger',
    'nunca-salio': 'danger',
    'muy-viejo': 'danger',
    viejo: 'warning',
    'al-dia': 'success',
  }
  const tono = tonoAviso[estado.nivel] ?? 'neutral'

  // De que respaldo habla "Que trae": del mismo que mide el aviso -el
  // ultimo completo que salio- y, si ninguno salio, del ultimo completo.
  const completos = backups.filter((b) => b.formato === 2)
  const referencia = completos.find((b) => b.downloaded_at !== null) ?? completos[0] ?? null
  const [indice] = referencia
    ? await asUser(
        ctx.userId,
        ctx.tenantId,
        (tx) => tx<{ payload: Indice }[]>`
          select payload from public.backups
          where id = ${referencia.id} and tenant_id = ${ctx.tenantId}`,
      )
    : []

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/respaldos">
      <div className="max-w-3xl space-y-5">
        <PageHeader
          icon="backup"
          title="Respaldos"
          description="Una copia completa de tus datos en JSON, para guardarla fuera de aqui. Se arma con tus permisos: no puede traer lo que tu rol no ve."
          actions={
            puedeCrear ? (
              <form action={crearRespaldo}>
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="cloud_sync" size={18} />
                  Crear respaldo ahora
                </BotonEnvio>
              </form>
            ) : undefined
          }
        />

        {/*
          El aviso va ARRIBA y con color, no como una nota al pie. Es la
          unica linea de esta pantalla que puede cambiar lo que el cliente
          hace hoy; la lista de abajo solo confirma lo que ya sabe.

          El estado nunca se comunica solo por color: lleva icono y texto,
          y el texto dice el numero de dias -"12 dias" mueve a alguien,
          "desactualizado" no-.
        */}
        <div
          role={tono === 'danger' ? 'alert' : undefined}
          className="flex items-start gap-3 rounded-[var(--radius-lg)] border p-4"
          style={{
            // `color-mix` sobre el token: el fondo se adapta solo al tema
            // claro y al oscuro sin definir un token por variante.
            borderColor: `var(--color-semantic-${tono})`,
            background: `color-mix(in srgb, var(--color-semantic-${tono}) 14%, var(--color-surface-raised))`,
          }}
        >
          <Icon
            name={
              tono === 'danger' ? 'gpp_maybe' : tono === 'warning' ? 'schedule' : 'verified_user'
            }
            size={22}
            className="mt-0.5 shrink-0 text-[var(--color-text-primary)]"
          />
          <div className="min-w-0">
            <p className="font-semibold text-[var(--color-text-primary)]">{estado.titulo}</p>
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{estado.detalle}</p>
          </div>
        </div>

        {referencia && indice ? (
          <QueTrae
            indice={indice.payload}
            titulo={`Que trae el respaldo del ${fecha(referencia.created_at)}`}
            subtitulo={
              referencia.downloaded_at
                ? 'Es el ultimo que salio de aqui: lo que no este en el, lo perderias.'
                : 'Todavia no ha salido de aqui.'
            }
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Que trae un respaldo</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              {alcance.bloqueo ? (
                <p>{alcance.bloqueo}</p>
              ) : (
                <>
                  <p>
                    Todas las tablas de los modulos que tienes activos y que tu rol ve completos:{' '}
                    {alcance.modulos.map(nombreDeModulo).join(', ')}.
                  </p>
                  {alcance.fuera.length > 0 && (
                    <p className="text-[var(--color-semantic-text-warning)]">
                      No traeria:{' '}
                      {alcance.fuera.map((f) => `${f.nombre} (${f.motivo})`).join(', ')}.
                    </p>
                  )}
                  <p>
                    Arriba del archivo va la lista exacta de lo que trae y de lo que queda fuera.
                  </p>
                </>
              )}
            </CardBody>
          </Card>
        )}

        {backups.length === 0 ? (
          <EmptyState
            icon="backup"
            title="Todavia no hay respaldos"
            description='Pulsa "Crear respaldo ahora" y descargalo. No se generan solos: si nadie lo hace, no hay.'
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Contenido</TH>
                <TH numeric>Tamano</TH>
                <TH>Creado por</TH>
                <TH>Fuera de aqui</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {backups.map((b) => (
                <TR key={b.id}>
                  <TD className="font-semibold text-[var(--color-text-primary)]">
                    {fecha(b.created_at)}
                  </TD>
                  <TD>
                    {b.formato === 2 ? (
                      <Badge tone="info">Completo · {numero(b.filas ?? 0)} filas</Badge>
                    ) : (
                      <Badge tone="warning">Parcial: sin ventas</Badge>
                    )}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{tamano(b.size_bytes)}</span>
                  </TD>
                  <TD>{b.created_by_name ?? '—'}</TD>
                  <TD>
                    {b.downloaded_at === null ? (
                      <Badge tone="warning">Solo aqui</Badge>
                    ) : (
                      <Badge tone="success">Descargado</Badge>
                    )}
                  </TD>
                  <TD>
                    {puedeExportar && (
                      <a
                        href={`/respaldos/${b.id}/descargar${ctx.demoQs}`}
                        className="whitespace-nowrap rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-brand-bright)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        Descargar JSON
                      </a>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}

/**
 * Lo que trae un respaldo y lo que NO, leido de su propio indice -el mismo
 * que va arriba del archivo-. Nada de esto se redacta aparte: si la
 * pantalla y el archivo pudieran decir cosas distintas, alguna mentiria.
 */
function QueTrae({
  indice,
  titulo,
  subtitulo,
}: {
  indice: Indice
  titulo: string
  subtitulo: string
}) {
  const nTablas = Object.keys(indice.tablas).length
  const de = (motivo: string) => indice.fuera.filter((f) => f.motivo === motivo)
  const apagados = unicos(de('modulo-apagado').flatMap((f) => f.modulos))
  const sinPermiso = unicos(de('sin-permiso').flatMap((f) => f.modulos))
  const sinModulo = de('sin-modulo').map((f) => f.tabla)
  const porDiseno = de('por-diseno')
  const noContratadas = de('no-contratado').length
  const avisos = apagados.length + sinPermiso.length + sinModulo.length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{subtitulo}</p>
      </CardHeader>
      <CardBody className="space-y-4 text-sm">
        <div>
          <p className="flex items-center gap-1.5 font-semibold text-[var(--color-text-primary)]">
            <Icon name="check_circle" size={18} className="text-[var(--color-semantic-text-success)]" />
            Trae {numero(nTablas)} tablas de {numero(indice.modulos.length)} modulos ·{' '}
            {numero(indice.filas)} filas
          </p>
          <p className="mt-1 text-[var(--color-text-secondary)]">
            {indice.modulos.map(nombreDeModulo).join(', ')}.
          </p>
        </div>

        <div>
          <p className="flex items-center gap-1.5 font-semibold text-[var(--color-text-primary)]">
            <Icon
              name={avisos ? 'warning' : 'info'}
              size={18}
              className={
                avisos
                  ? 'text-[var(--color-semantic-text-warning)]'
                  : 'text-[var(--color-text-secondary)]'
              }
            />
            No trae
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--color-text-secondary)]">
            {apagados.length > 0 && (
              <li className="text-[var(--color-semantic-text-warning)]">
                {apagados.map(nombreDeModulo).join(', ')}: el modulo esta apagado. Tus datos
                siguen en la base, pero no salen en el respaldo hasta que lo enciendas.
              </li>
            )}
            {sinPermiso.length > 0 && (
              <li className="text-[var(--color-semantic-text-warning)]">
                {sinPermiso.map(nombreDeModulo).join(', ')}: quien lo creo no los ve completos.
                Para llevartelos, que lo cree alguien que si.
              </li>
            )}
            {sinModulo.length > 0 && (
              <li className="text-[var(--color-semantic-text-warning)]">
                {sinModulo.join(', ')}: tablas sin modulo conocido. Avisale a soporte.
              </li>
            )}
            {indice.personales.length > 0 && (
              <li>
                Lo personal de los demas usuarios (
                <code className="text-xs">{indice.personales.join(', ')}</code>): cada quien ve
                solo lo suyo, asi que trae solo lo de quien lo creo.
              </li>
            )}
            {indice.no_incluye.map((t) => (
              <li key={t}>{t}</li>
            ))}
            {porDiseno.map((f) => (
              <li key={f.tabla}>
                <code className="text-xs">{f.tabla}</code>: {f.detalle}
              </li>
            ))}
            {noContratadas > 0 && (
              <li>Las {numero(noContratadas)} tablas de los modulos que no tienes contratados.</li>
            )}
          </ul>
        </div>

        {indice.omitido.length > 0 && (
          <details className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
            <summary className="cursor-pointer font-semibold text-[var(--color-text-primary)]">
              {numero(indice.omitido.length)} columnas que no salen nunca (credenciales y datos
              protegidos)
            </summary>
            <ul className="mt-2 space-y-1.5 text-[var(--color-text-secondary)]">
              {indice.omitido.map((o) => (
                <li key={`${o.tabla}.${o.columna}`}>
                  <code className="text-xs text-[var(--color-text-primary)]">
                    {o.tabla}.{o.columna}
                  </code>{' '}
                  — {o.motivo}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  )
}

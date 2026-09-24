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
import { PRODUCT_COLUMNS, STOCK_COLUMNS, type ImportError } from '@regb/core'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  deshacerExistencias,
  deshacerImportacion,
  importarExistencias,
  importarProductos,
} from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Importar · REGB ERP' }

/** Lo que dice la pantalla de cada columna: la clave interna no le sirve a nadie. */
const ETIQUETA_COLUMNA: Record<string, string> = {
  sku: 'codigo',
  name: 'nombre',
  category: 'categoria',
  unit: 'unidad',
  price: 'precio',
  cost: 'costo',
  barcode: 'código de barras',
  taxRate: 'tasa de ITBIS',
  exempt: 'exento',
  warehouse: 'almacen',
  qty: 'cantidad',
  unitCost: 'costo unitario',
}

/**
 * Plantillas para descargar. El dueño de un colmado no sabe que es un CSV:
 * sabe llenar una hoja. Le damos una ya armada con los encabezados que
 * reconocemos y dos filas de ejemplo; la abre en Excel, la llena y la sube.
 * El BOM hace que Excel lea bien las tildes; el lector lo ignora.
 */
function plantilla(filas: string[]): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + filas.join('\r\n') + '\r\n')}`
}
const PLANTILLA_PRODUCTOS = plantilla([
  'código,nombre,categoría,unidad,precio,costo,código de barras,tasa de ITBIS',
  'ARZ-001,Arroz selecto 5 lb,Granos,funda,215.00,180.00,,exento',
  'ACE-002,Aceite de soya 1 gal,Aceites,galon,525.00,450.00,,16%',
  'REF-003,Refresco 2 litros,Bebidas,unidad,120.00,95.00,,18%',
])
const PLANTILLA_EXISTENCIAS = plantilla([
  'código,almacén,cantidad,costo',
  'ARZ-001,,24,180.00',
  'ACE-002,,12,450.00',
])

const BOTON_PLANTILLA =
  'inline-flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'

const CAMPO_ARCHIVO =
  'text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--color-surface-raised)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[var(--color-text-primary)]'
const BOTON_PRIMARIO =
  'inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-50'

interface BatchRow {
  id: string
  /** products: creo productos. stock: cargo existencias iniciales (0133). */
  target: string
  file_name: string
  total_rows: number
  inserted: number
  rejected: number
  /** Rechazos y, con `kind: 'skipped'`, las filas cuyo codigo ya existia. */
  errors: ImportError[]
  undone_at: string | null
  created_at: string
  created_by_name: string | null
}

const yaExistian = (b: BatchRow) => b.errors.filter((e) => e.kind === 'skipped')
const rechazos = (b: BatchRow) => b.errors.filter((e) => e.kind !== 'skipped')
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Importar (S12): CSV con mapeo automatico, validacion previa y deshacer. */
export default async function ImportarPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'imports')

  const batches = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<BatchRow[]>`
      select b.id, b.target, b.file_name, b.total_rows, b.inserted, b.rejected, b.errors,
             b.undone_at::text, b.created_at::text, p.display_name as created_by_name
      from public.import_batches b
      left join public.user_profiles p
        on p.tenant_id = b.tenant_id and p.user_id = b.created_by
      where b.tenant_id = ${ctx.tenantId}
      order by b.created_at desc
      limit 25`,
  )

  const puedeImportar =
    exigir(ctx, 'imports', 'imports.create').ok && exigir(ctx, 'products', 'products.create').ok
  const puedeDeshacer =
    exigir(ctx, 'imports', 'imports.edit').ok && exigir(ctx, 'products', 'products.delete').ok
  // Existencias: el permiso del destino es ajustar inventario. Sin el
  // modulo de existencias, exigir() lo niega y la tarjeta no sale.
  const ajustaInventario = exigir(ctx, 'inventory', 'inventory.adjust').ok
  const puedeCargarExistencias = exigir(ctx, 'imports', 'imports.create').ok && ajustaInventario
  const puedeDeshacerExistencias = exigir(ctx, 'imports', 'imports.edit').ok && ajustaInventario
  const esDeExistencias = (b: BatchRow) => b.target === 'stock'
  const deProductos = batches.filter((b) => !esDeExistencias(b))
  const deExistencias = batches.filter(esDeExistencias)

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/importar">
      <div className="space-y-5">
        <PageHeader
          icon="upload_file"
          title="Importar"
          description="Sube tu catálogo y tus existencias desde una hoja de Excel guardada como CSV. Reconocemos los encabezados solos, cada fila dudosa se rechaza con su motivo -un número nunca se adivina- y toda importación se puede deshacer."
          crumbs={[{ label: 'Catálogo', href: `/products${ctx.demoQs}` }, { label: 'Importar' }]}
        />

        {batches.length > 0 && (
          <section
            aria-label="Resumen"
            className={`grid grid-cols-2 gap-3 ${deExistencias.length > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}
          >
            <StatCard label="Importaciones" value={String(batches.length)} hint="en el historial" />
            <StatCard
              label="Productos creados"
              value={String(
                deProductos.filter((b) => !b.undone_at).reduce((a, b) => a + b.inserted, 0),
              )}
              hint="sin contar las deshechas"
            />
            {deExistencias.length > 0 && (
              <StatCard
                label="Existencias cargadas"
                value={String(
                  deExistencias.filter((b) => !b.undone_at).reduce((a, b) => a + b.inserted, 0),
                )}
                hint="lineas con costo"
              />
            )}
            <StatCard
              label="Ya existian"
              value={String(batches.reduce((a, b) => a + yaExistian(b).length, 0))}
              hint="no se tocaron"
            />
            <StatCard
              label="Rechazadas"
              value={String(batches.reduce((a, b) => a + b.rejected, 0))}
              hint="con su motivo"
            />
          </section>
        )}

        {puedeImportar && (
          <Card data-tour="importar-csv">
            <CardHeader>
              <CardTitle>Productos</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={importarProductos} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <input
                  type="file"
                  name="archivo"
                  accept=".csv,text/csv"
                  required
                  aria-label="Archivo CSV con los productos"
                  className={CAMPO_ARCHIVO}
                />
                <BotonEnvio className={BOTON_PRIMARIO}>Importar productos</BotonEnvio>
                <a
                  href={PLANTILLA_PRODUCTOS}
                  download="plantilla-productos.csv"
                  className={BOTON_PLANTILLA}
                >
                  <Icon name="download" size={16} />
                  Descargar plantilla
                </a>
              </form>
              <p className="mt-3 max-w-prose text-xs text-[var(--color-text-secondary)]">
                <span className="font-semibold text-[var(--color-text-primary)]">
                  ¿Lo tienes en Excel?
                </span>{' '}
                Descarga la plantilla, pega tus productos debajo de los encabezados y guárdala con{' '}
                <em>Archivo → Guardar como → CSV UTF-8 (delimitado por comas)</em>. Luego súbela
                aquí.
              </p>

              <div className="mt-4 text-xs text-[var(--color-text-secondary)]">
                <p className="mb-1 font-semibold text-[var(--color-text-primary)]">
                  Columnas que reconocemos (en cualquier orden, con o sin acentos):
                </p>
                <ul className="space-y-0.5">
                  {(Object.keys(PRODUCT_COLUMNS) as (keyof typeof PRODUCT_COLUMNS)[]).map((k) => (
                    <li key={k}>
                      <Mono>{ETIQUETA_COLUMNA[k] ?? k}</Mono> — {PRODUCT_COLUMNS[k].join(' · ')}
                      {(k === 'sku' || k === 'name') && (
                        <Badge tone="warning" dot={false} className="ml-2">
                          obligatoria
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 max-w-prose">
                  <span className="font-semibold text-[var(--color-text-primary)]">Numeros:</span>{' '}
                  <Mono>1,234.56</Mono> y <Mono>1.234,56</Mono> se leen igual; <Mono>RD$</Mono>,
                  espacios y negativos también. Si un número se puede leer de dos maneras —
                  <Mono>1.234</Mono> puede ser mil o uno con decimales— la fila se rechaza y te
                  decimos por qué. Un código que ya existe no se sobrescribe.
                </p>
                <p className="mt-2 max-w-prose">
                  <span className="font-semibold text-[var(--color-text-primary)]">ITBIS:</span>{' '}
                  <Mono>18%</Mono>, <Mono>16%</Mono>, <Mono>0</Mono> o <Mono>exento</Mono> (tambien
                  una columna <Mono>exento</Mono> con si/no). Vacio = la tasa por defecto de tu
                  empresa.
                </p>
                <p className="mt-2 max-w-prose">
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    Codigo de barras:
                  </span>{' '}
                  formatea esa columna como <em>Texto</em> en Excel antes de exportar; si no, un
                  codigo largo se vuelve <Mono>7.46E+12</Mono> y pierde digitos (lo rechazamos). Un
                  código que ya tiene otro producto también se rechaza, en su fila.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        {puedeCargarExistencias && (
          <Card id="existencias" data-tour="importar-existencias">
            <CardHeader>
              <CardTitle>Existencias iniciales</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={importarExistencias} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <input
                  type="file"
                  name="archivo"
                  accept=".csv,text/csv"
                  required
                  aria-label="Archivo CSV con las existencias iniciales"
                  className={CAMPO_ARCHIVO}
                />
                <BotonEnvio className={BOTON_PRIMARIO}>Cargar existencias</BotonEnvio>
                <a
                  href={PLANTILLA_EXISTENCIAS}
                  download="plantilla-existencias.csv"
                  className={BOTON_PLANTILLA}
                >
                  <Icon name="download" size={16} />
                  Descargar plantilla
                </a>
              </form>

              <div className="mt-4 text-xs text-[var(--color-text-secondary)]">
                <p className="mb-1 font-semibold text-[var(--color-text-primary)]">Columnas:</p>
                <ul className="space-y-0.5">
                  {(Object.keys(STOCK_COLUMNS) as (keyof typeof STOCK_COLUMNS)[]).map((k) => (
                    <li key={k}>
                      <Mono>{ETIQUETA_COLUMNA[k] ?? k}</Mono> — {STOCK_COLUMNS[k].join(' · ')}
                      {(k === 'sku' || k === 'qty') && (
                        <Badge tone="warning" dot={false} className="ml-2">
                          obligatoria
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 max-w-prose">
                  El código puede ser el SKU o el código de barras. Sin almacén va al
                  predeterminado. Sin costo se usa el del catalogo, y si tampoco hay, la fila se
                  rechaza:{' '}
                  <strong className="text-[var(--color-text-primary)]">
                    sin costo la valorización nace mal
                  </strong>
                  . Un producto que ya tiene existencia en ese almacen no se toca (corrigelo con un
                  ajuste). Los numeros siguen la misma regla de arriba.
                </p>
                <p className="mt-2 max-w-prose">
                  Cargalo antes de vender -de noche o un domingo-: deshacer vuelve cada linea a cero
                  con su movimiento contrario, pero solo si nada la movió después.
                </p>
              </div>
            </CardBody>
          </Card>
        )}

        <section aria-label="Historial de importaciones">
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
            Importaciones anteriores
          </h2>
          {batches.length === 0 ? (
            <EmptyState
              icon="upload_file"
              title="Todavia no has importado nada"
              description="Cuando subas un CSV veras aqui cuantas filas entraron, cuales fallaron y por que — con la opcion de deshacerlo todo."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Archivo</TH>
                  <TH>Tipo</TH>
                  <TH>Cuando</TH>
                  <TH>Quien</TH>
                  <TH numeric>Filas</TH>
                  <TH numeric>Nuevos</TH>
                  <TH numeric>Ya existian</TH>
                  <TH numeric>Rechazadas</TH>
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {batches.map((b) => (
                  <TR key={b.id}>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {b.file_name}
                      {b.undone_at && (
                        <Badge tone="neutral" dot={false} className="ml-2">
                          deshecha
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={esDeExistencias(b) ? 'info' : 'neutral'} dot={false}>
                        {esDeExistencias(b) ? 'Existencias' : 'Productos'}
                      </Badge>
                    </TD>
                    <TD>{fecha(b.created_at)}</TD>
                    <TD>{b.created_by_name ?? '—'}</TD>
                    <TD numeric>
                      <span className="tabular">{b.total_rows}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {b.inserted}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{yaExistian(b).length}</span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular ${b.rejected > 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}
                      >
                        {b.rejected}
                      </span>
                    </TD>
                    <TD>
                      {!b.undone_at &&
                        b.inserted > 0 &&
                        (esDeExistencias(b) ? puedeDeshacerExistencias : puedeDeshacer) && (
                          <form
                            action={esDeExistencias(b) ? deshacerExistencias : deshacerImportacion}
                            className="inline"
                          >
                            <input
                              type="hidden"
                              name="tenant"
                              value={ctx.demoQs ? ctx.tenantSlug : ''}
                            />
                            <input
                              type="hidden"
                              name="rol"
                              value={ctx.demoQs ? ctx.roleName : ''}
                            />
                            <input type="hidden" name="batchId" value={b.id} />
                            <BotonEnvio
                              title={
                                esDeExistencias(b)
                                  ? `Registra el movimiento contrario de las ${b.inserted} existencias que cargo este archivo. El kardex conserva los dos.`
                                  : `Borra los ${b.inserted} productos que creó esta importación. No toca ningún otro.`
                              }
                              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                            >
                              Deshacer
                            </BotonEnvio>
                          </form>
                        )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {batches.some((b) => b.errors.length > 0) && (
            <div className="mt-4 space-y-3">
              {batches
                .filter((b) => b.errors.length > 0)
                .slice(0, 3)
                .map((b) => {
                  const malas = rechazos(b)
                  const existian = yaExistian(b)
                  const partes = [
                    b.rejected > 0 && plural(b.rejected, 'fila rechazada', 'filas rechazadas'),
                    existian.length > 0 &&
                      plural(existian.length, 'que ya existia', 'que ya existian'),
                  ].filter(Boolean)
                  return (
                    <details
                      key={b.id}
                      className="rounded-[var(--radius-lg)] border border-[var(--color-border)]"
                    >
                      <summary className="cursor-pointer px-4 py-2 text-sm text-[var(--color-text-secondary)]">
                        {partes.join(' y ')} en {b.file_name}
                      </summary>
                      <div className="space-y-3 px-4 pb-3 text-xs text-[var(--color-text-secondary)]">
                        {malas.length > 0 && (
                          <section aria-label={`Filas rechazadas en ${b.file_name}`}>
                            <h3 className="mb-1 font-semibold text-[var(--color-semantic-text-danger)]">
                              Rechazadas: no entraron
                            </h3>
                            <ul className="space-y-1">
                              {malas.slice(0, 20).map((e, i) => (
                                <li key={i}>
                                  {e.row > 0 ? `Linea ${e.row}` : 'Encabezado'} ·{' '}
                                  <Mono>{e.column}</Mono> — {e.message}
                                </li>
                              ))}
                            </ul>
                            {malas.length > 20 && (
                              <p className="mt-1">y {malas.length - 20} mas.</p>
                            )}
                          </section>
                        )}
                        {existian.length > 0 && (
                          <section aria-label={`Codigos que ya existian en ${b.file_name}`}>
                            <h3 className="mb-1 font-semibold text-[var(--color-text-primary)]">
                              Ya existian: los dejamos como estaban
                            </h3>
                            <p className="mb-1">
                              Si querias cambiarlos, editalos en Productos: importar no sobrescribe.
                            </p>
                            <ul className="space-y-1">
                              {existian.slice(0, 20).map((e, i) => (
                                <li key={i}>
                                  Linea {e.row} · <Mono>{e.column}</Mono> — {e.message}
                                </li>
                              ))}
                            </ul>
                            {existian.length > 20 && (
                              <p className="mt-1">y {existian.length - 20} mas.</p>
                            )}
                          </section>
                        )}
                      </div>
                    </details>
                  )
                })}
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}

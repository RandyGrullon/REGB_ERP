'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon, cn } from '@regb/ui'
import { claveSeleccion, type CatalogEntry, type CotizacionMotor } from '@/lib/catalog'
import { cotizarSeleccion, solicitarActivacionForm } from '@/app/marketplace/actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { FOCO, PILL_FANTASMA, PILL_PRIMARIO, plural, tierLabel, usd } from './formato'

/**
 * Simulador de costo (§12.3), pegado abajo.
 *
 * ── El precio que se enseña es el que se cobra ───────────────────────
 *
 * Aqui ya no se suma nada. Cada vez que cambia lo marcado se le pide al
 * servidor (`cotizarSeleccion`) la factura que saldria, calculada por
 * `calculateMonthly` de `@regb/billing` -el motor que emite la factura-:
 * base del plan, modulos incluidos del tier (los mas caros primero),
 * pruebas a US$0, descuento por ciclo e ITBIS. El desglose pinta sus
 * lineas tal cual. Mientras llega la cuenta nueva, la vieja se queda a la
 * vista, atenuada y marcada como "calculando": nunca un numero inventado.
 *
 * ── Donde vive ───────────────────────────────────────────────────────
 *
 * Es el ultimo hijo de una columna flex, no una capa `absolute`: la lista
 * de arriba se encoge para dejarle sitio y NUNCA queda contenido debajo
 * de la barra, ni en movil con el desglose abierto (que ademas tiene alto
 * maximo y su propio scroll).
 *
 * Nada se activa desde aqui: "Solicitar" crea (o actualiza) la unica
 * solicitud abierta del cliente, y alguien llama.
 */
export function Simulador({
  porId,
  marcados,
  total,
  anadidos,
  tier,
  cotizacionInicial,
  hiddenFields,
  puedePedir = true,
  notaPendiente,
  onQuitar,
  onLimpiar,
  onPedido,
}: {
  porId: ReadonlyMap<string, CatalogEntry>
  /** Lo que el cliente marco. */
  marcados: ReadonlySet<string>
  /** Lo marcado mas sus dependencias: es lo que se cotiza y se pide. */
  total: ReadonlySet<string>
  /** Dependencias que entraron solas. */
  anadidos: string[]
  tier: string
  /** La cotizacion con la que llega la pagina (calculada en el servidor). */
  cotizacionInicial: CotizacionMotor | null
  hiddenFields: Record<string, string>
  /** Sin `subscription.manage` se simula, pero el pedido lo hace el dueño. */
  puedePedir?: boolean
  /** La nota de la solicitud abierta se conserva al actualizarla. */
  notaPendiente: string | null
  onQuitar: (id: string) => void
  onLimpiar: () => void
  onPedido: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [cotizacion, setCotizacion] = useState<CotizacionMotor | null>(cotizacionInicial)
  const [fallo, setFallo] = useState(false)
  // Volver a una seleccion ya vista (marcar y desmarcar) no pregunta dos veces.
  const vistas = useRef(
    new Map<string, CotizacionMotor>(
      cotizacionInicial ? [[cotizacionInicial.clave, cotizacionInicial]] : [],
    ),
  )

  const clave = claveSeleccion(total)
  const vigente = cotizacion !== null && cotizacion.clave === clave

  useEffect(() => {
    if (cotizacion?.clave === clave) return
    const guardada = vistas.current.get(clave)
    if (guardada) {
      setCotizacion(guardada)
      return
    }
    let sigue = true
    // Un respiro antes de preguntar: marcar un paquete cambia varias cosas
    // seguidas y basta con cotizar la ultima.
    const t = setTimeout(async () => {
      try {
        const c = await cotizarSeleccion({
          tenant: hiddenFields.tenant,
          rol: hiddenFields.rol,
          modulos: [...total],
        })
        if (!sigue) return
        if (c) {
          vistas.current.set(c.clave, c)
          setCotizacion(c)
          setFallo(false)
        } else {
          setFallo(true)
        }
      } catch {
        if (sigue) setFallo(true)
      }
    }, 200)
    return () => {
      sigue = false
      clearTimeout(t)
    }
    // Solo la llave: `total` cambia de identidad en cada render.
  }, [clave])

  const elegidos = [...total]
    .map((id) => porId.get(id))
    .filter((m): m is CatalogEntry => m !== undefined)
  const cuenta = elegidos.length
  const esDependencia = new Set(anadidos)
  const instalacionDe = new Map(cotizacion?.instalacion.map((i) => [i.moduleId, i]) ?? [])

  const hoy = cotizacion?.hoy.total ?? 0
  const con = cotizacion?.conSeleccion.total ?? hoy
  const aumento = cotizacion?.aumento ?? 0
  const factura = cuenta > 0 ? cotizacion?.conSeleccion : cotizacion?.hoy
  const plan = cotizacion?.plan

  const cifras = (
    <>
      <Cifra etiqueta="Hoy pagas" valor={usd(hoy)} sufijo="/mes" />
      <Cifra
        etiqueta="Con lo marcado"
        valor={usd(con)}
        sufijo="/mes"
        delta={aumento > 0 ? usd(aumento) : undefined}
        destacado
      />
      <Cifra
        etiqueta="Instalación, una vez (+ ITBIS)"
        valor={usd(cotizacion?.instalacionTotal ?? 0)}
      />
    </>
  )

  return (
    <section
      aria-labelledby="simulador-titulo"
      aria-busy={!vigente || undefined}
      data-tour="marketplace-simulador"
      className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)]"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        {/* Siempre en el DOM (con `hidden`) para que `aria-controls` apunte a algo. */}
        <div
          id="simulador-desglose"
          hidden={!abierto}
          className={cn(
            'max-h-[50vh] overflow-y-auto border-b border-[var(--color-border)] py-3',
            !vigente && 'opacity-60',
          )}
        >
          {anadidos.length > 0 && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]">
              <Icon
                name="link"
                size={16}
                className="mt-px shrink-0 text-[var(--color-text-link)]"
              />
              <span>
                Se agregaron solos{' '}
                <strong className="font-semibold text-[var(--color-text-primary)]">
                  {anadidos.map((id) => porId.get(id)?.name ?? id).join(', ')}
                </strong>
                : sin ellos lo que marcaste no funciona, y ya van en el cálculo.
              </span>
            </p>
          )}

          {cuenta === 0 ? (
            <p className="py-1 text-sm text-[var(--color-text-secondary)]">
              Todavía no marcaste nada. Toca <strong className="font-semibold">Agregar</strong> en
              un módulo o <strong className="font-semibold">Simular</strong> en un paquete.
            </p>
          ) : (
            <ul
              className="divide-y divide-[var(--color-border)]"
              aria-label="Módulos en el cálculo"
            >
              {elegidos.map((m) => {
                const inst = instalacionDe.get(m.id)
                return (
                  <li key={m.id} className="flex min-h-11 items-center gap-3 py-1.5 text-sm">
                    <Icon
                      name={m.icon}
                      size={18}
                      className="shrink-0 text-[var(--color-text-muted)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">
                      {m.name}
                      {esDependencia.has(m.id) && (
                        <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                          · requisito
                        </span>
                      )}
                    </span>
                    <span className="tabular shrink-0 text-xs text-[var(--color-text-secondary)]">
                      {inst
                        ? inst.incluida
                          ? 'Instalación incluida en tu plan'
                          : `Instalación ${usd(inst.monto)}`
                        : ''}
                    </span>
                    {marcados.has(m.id) ? (
                      <button
                        type="button"
                        onClick={() => onQuitar(m.id)}
                        aria-label={`Quitar ${m.name} del cálculo`}
                        className={cn(
                          'grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] md:h-8 md:w-8',
                          FOCO,
                        )}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    ) : (
                      <span className="w-11 shrink-0 md:w-8" aria-hidden />
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {factura && (
            <table className="mt-3 w-full text-sm">
              <caption className="mb-1 text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                Tu factura mensual {cuenta > 0 ? 'con lo marcado' : 'de hoy'}
              </caption>
              <tbody className="divide-y divide-[var(--color-border)]">
                {factura.lineas.map((l, i) => (
                  <tr key={`${l.concepto}-${i}`}>
                    <th
                      scope="row"
                      className="py-1.5 pr-3 text-left font-normal text-[var(--color-text-secondary)]"
                    >
                      {l.concepto}
                      {l.detalle && (
                        <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                          {l.detalle}
                        </span>
                      )}
                    </th>
                    <td className="tabular whitespace-nowrap py-1.5 text-right text-[var(--color-text-primary)]">
                      {usd(l.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--color-border-strong)]">
                  <th
                    scope="row"
                    className="py-2 pr-3 text-left font-semibold text-[var(--color-text-primary)]"
                  >
                    Total al mes
                  </th>
                  <td className="tabular whitespace-nowrap py-2 text-right font-bold text-[var(--color-text-primary)]">
                    {usd(factura.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-3 md:hidden">{cifras}</dl>

          <div className="mt-3 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            {cotizacion?.anual && (
              <p className="flex items-start gap-1.5">
                <Icon
                  name="savings"
                  size={16}
                  className="mt-px shrink-0 text-[var(--color-semantic-text-success)]"
                />
                Pagando anual serían {usd(cotizacion.anual.total)}/mes: te ahorras{' '}
                {usd(cotizacion.anual.ahorroAlAno)} al año.
              </p>
            )}
            {cotizacion && cotizacion.trasPruebas !== null && (
              <p className="flex items-start gap-1.5">
                <Icon
                  name="hourglass_top"
                  size={16}
                  className="mt-px shrink-0 text-[var(--color-semantic-text-warning)]"
                />
                Tus pruebas no se cobran. Si te quedas con lo que estás probando, hoy pagarías{' '}
                {usd(cotizacion.trasPruebas)}/mes.
              </p>
            )}
            {plan && (
              <p className="text-[var(--color-text-muted)]">
                Calculado con el mismo motor que emite tu factura, para tu plan {tierLabel(tier)}
                {plan.impuesto > 0 ? `, con ITBIS del ${Math.round(plan.impuesto * 100)} %` : ''}.
                {plan.modulosIncluidos > 0 &&
                  ` Tu plan regala ${plan.modulosIncluidos} módulos de pago: los más caros van primero.`}{' '}
                Incluye {plural(plan.usuariosIncluidos, 'usuario', 'usuarios')}
                {plan.sucursalesIncluidas === null
                  ? ' y sucursales sin límite'
                  : ` y ${plural(plan.sucursalesIncluidas, 'sucursal', 'sucursales')}`}
                ; lo que pase de ahí se cobra aparte y no cambia con lo que marques.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 py-3 md:gap-4">
          <div className="min-w-0 flex-1">
            <h2
              id="simulador-titulo"
              className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
            >
              <Icon name="calculate" size={14} />
              Simulador de costo
            </h2>
            <p
              aria-live="polite"
              className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-[var(--color-text-secondary)]"
            >
              {!vigente && !fallo && (
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
                />
              )}
              {fallo && !vigente ? (
                <span className="text-[var(--color-semantic-text-danger)]">
                  No pudimos calcular: revisa tu conexión y vuelve a marcar.
                </span>
              ) : cuenta === 0 ? (
                <span className="truncate">
                  Marca módulos y mira cuánto costarían.{' '}
                  <span className="hidden text-[var(--color-text-primary)] sm:inline">
                    No se activa nada hasta que lo pidas.
                  </span>
                </span>
              ) : (
                <span className="truncate">
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {plural(cuenta, 'módulo', 'módulos')}
                  </span>
                  <span className="tabular">
                    {' · '}
                    {vigente ? `+${usd(aumento)}/mes` : 'calculando…'}
                  </span>
                </span>
              )}
            </p>
          </div>

          <dl className={cn('hidden items-end gap-6 md:flex', !vigente && 'opacity-60')}>
            {cifras}
          </dl>

          <button
            type="button"
            onClick={() => setAbierto((a) => !a)}
            aria-expanded={abierto}
            aria-controls="simulador-desglose"
            className={cn(PILL_FANTASMA, 'px-3')}
          >
            <Icon name={abierto ? 'expand_more' : 'expand_less'} size={18} />
            <span className="hidden sm:inline">Desglose</span>
            <span className="sr-only sm:hidden">Ver desglose</span>
          </button>

          {cuenta > 0 && (
            <button
              type="button"
              onClick={onLimpiar}
              className={cn(PILL_FANTASMA, 'hidden md:inline-flex')}
            >
              Limpiar
            </button>
          )}

          {/* Sin montos ocultos: el servidor vuelve a cotizar con el motor al guardar. */}
          {!puedePedir ? (
            <p className="max-w-48 text-xs text-[var(--color-text-secondary)]">
              Solo el dueño de la cuenta puede pedir módulos: muéstrale esta simulación.
            </p>
          ) : (
            <form action={solicitarActivacionForm} onSubmit={onPedido}>
              {Object.entries(hiddenFields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <input type="hidden" name="modulos" value={JSON.stringify([...total])} />
              {notaPendiente && <input type="hidden" name="nota" value={notaPendiente} />}
              <BotonEnvio className={PILL_PRIMARIO} disabled={cuenta === 0}>
                Solicitar<span className="hidden sm:inline"> activación</span>
              </BotonEnvio>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}

function Cifra({
  etiqueta,
  valor,
  sufijo,
  delta,
  destacado = false,
}: {
  etiqueta: string
  valor: string
  sufijo?: string
  // `| undefined` explicito: con exactOptionalPropertyTypes "puede faltar"
  // y "puede valer undefined" no son lo mismo.
  delta?: string | undefined
  destacado?: boolean
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {etiqueta}
      </dt>
      <dd className="tabular flex items-baseline gap-1 whitespace-nowrap">
        <span
          className={cn(
            'text-lg font-bold tracking-tight',
            destacado ? 'text-[var(--color-text-link)]' : 'text-[var(--color-text-primary)]',
          )}
        >
          {valor}
        </span>
        {sufijo && <span className="text-xs text-[var(--color-text-muted)]">{sufijo}</span>}
        {delta && (
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
            <span className="sr-only">, sube </span>
            <span aria-hidden>+</span>
            {delta}
          </span>
        )}
      </dd>
    </div>
  )
}

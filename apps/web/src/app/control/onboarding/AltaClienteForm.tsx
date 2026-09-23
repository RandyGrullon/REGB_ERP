'use client'

import Link from 'next/link'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Button, Icon } from '@regb/ui'
import { isValidTaxId } from '@regb/operations'
import { darDeAltaCliente } from './actions'
import {
  cierreDeModulos,
  esCore,
  PIEZAS,
  slugDe,
  TIERS,
  type ModuloOfrecido,
  type ResultadoAlta,
  type Tier,
} from './alta'
import { EnlaceNuevoDueno, EnlaceUnaVez } from './EnlaceDueno'

/**
 * Asistente de alta. 'use client' porque es un asistente de verdad: pasos,
 * el identificador que se sugiere solo mientras nadie lo toca, las
 * dependencias que entran de arrastre al marcar un modulo, y el enlace del
 * dueño que devuelve la accion UNA vez (useActionState, no la cookie).
 *
 * Nada de esto decide: la base vuelve a validar todo (0133). Aqui solo se
 * avisa antes, para que un RNC mal escrito no se descubra al enviar.
 */

const PASOS = ['Cliente', 'Modulos', 'Operacion', 'Dueño', 'Revisar'] as const

const CAMPO =
  'h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] aria-[invalid=true]:border-[var(--color-semantic-danger)]'
const ETIQUETA = 'text-xs font-semibold text-[var(--color-text-secondary)]'
const AYUDA = 'text-xs text-[var(--color-text-muted)]'
const ERROR = 'text-xs text-[var(--color-semantic-text-danger)]'

const TIER_TEXTO: Record<Tier, { titulo: string; detalle: string }> = {
  pyme: { titulo: 'Pyme', detalle: 'Colmado, tienda, taller: una o dos sucursales.' },
  mediano: { titulo: 'Mediano', detalle: 'Distribuidora o cadena pequeña, varias sucursales.' },
  grande: { titulo: 'Grande', detalle: 'Grupo con varias empresas. Unico con modulos enterprise.' },
}

const CATEGORIA: Record<string, string> = {
  standard: 'Estandar',
  advanced: 'Avanzados',
  vertical: 'Verticales',
  enterprise: 'Enterprise (solo plan grande)',
}

const RESERVADOS = new Set([
  'onboarding',
  'salud',
  'datos',
  'actividad',
  'facturacion',
  'nuevo',
  'control',
  'api',
  'auth',
  'login',
  'demo',
])

interface Datos {
  razonSocial: string
  nombreComercial: string
  rnc: string
  slug: string
  tier: Tier | ''
  modulos: string[]
  sucursal: string
  almacen: string
  duenoNombre: string
  duenoCorreo: string
}

const VACIO: Datos = {
  razonSocial: '',
  nombreComercial: '',
  rnc: '',
  slug: '',
  tier: '',
  modulos: [],
  sucursal: 'Principal',
  almacen: 'Almacen principal',
  duenoNombre: '',
  duenoCorreo: '',
}

function erroresDelPaso(paso: number, d: Datos): Partial<Record<keyof Datos, string>> {
  const e: Partial<Record<keyof Datos, string>> = {}
  if (paso === 0) {
    if (d.razonSocial.trim().length < 3)
      e.razonSocial = 'La razon social necesita al menos 3 letras.'
    if (!isValidTaxId(d.rnc)) {
      e.rnc =
        'Ese RNC no pasa el digito verificador (9 digitos empresa, 11 cedula). Un RNC malo hace rebotar el 607.'
    }
    const s = d.slug.trim()
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length < 3 || s.length > 40) {
      e.slug = 'Solo minusculas, numeros y guiones, de 3 a 40 letras.'
    } else if (RESERVADOS.has(s)) {
      e.slug = 'Ese identificador esta reservado para una pantalla de REGB.'
    }
    if (d.tier === '') e.tier = 'Elige el plan.'
  }
  if (paso === 3) {
    if (d.duenoNombre.trim().length < 3) e.duenoNombre = 'El nombre necesita al menos 3 letras.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.duenoCorreo.trim())) {
      e.duenoCorreo = 'Debe verse como dueno@suempresa.do.'
    }
  }
  return e
}

export function AltaClienteForm({
  modulos,
  modoDemo,
}: {
  modulos: ModuloOfrecido[]
  modoDemo: boolean
}) {
  const [estado, accion, pendiente] = useActionState(darDeAltaCliente, null)
  const [paso, setPaso] = useState(0)
  const [d, setD] = useState<Datos>(VACIO)
  const [slugTocado, setSlugTocado] = useState(false)
  /** El resultado que ya se cerro con "Dar de alta otro". */
  const [cerrado, setCerrado] = useState<ResultadoAlta | null>(null)
  const [errores, setErrores] = useState<Partial<Record<keyof Datos, string>>>({})
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const resultadoRef = useRef<HTMLDivElement>(null)
  const idBase = useId()

  const porId = useMemo(() => new Map(modulos.map((m) => [m.id, m])), [modulos])
  const cierre = useMemo(() => cierreDeModulos(d.modulos, modulos), [d.modulos, modulos])
  /** Lo que entra de arrastre, y quien lo pide. */
  const arrastre = useMemo(() => {
    const quien = new Map<string, string[]>()
    for (const id of cierre) {
      if (d.modulos.includes(id)) continue
      const pide = cierre.filter((o) => porId.get(o)?.requires.includes(id))
      quien.set(id, pide)
    }
    return quien
  }, [cierre, d.modulos, porId])
  const recomendados = useMemo(() => {
    const r = new Map<string, string[]>()
    for (const id of cierre) {
      for (const rec of porId.get(id)?.recommends ?? []) {
        const m = porId.get(rec)
        if (!m || esCore(m) || cierre.includes(rec)) continue
        if (m.category === 'enterprise' && d.tier !== 'grande') continue
        r.set(rec, [...(r.get(rec) ?? []), id])
      }
    }
    return r
  }, [cierre, porId, d.tier])

  const nombre = (id: string) => porId.get(id)?.name ?? id
  const cores = modulos.filter(esCore)
  const ofrecidos = modulos.filter((m) => !esCore(m))

  useEffect(() => {
    tituloRef.current?.focus()
  }, [paso])
  useEffect(() => {
    if (estado) resultadoRef.current?.focus()
  }, [estado])

  function poner<K extends keyof Datos>(k: K, v: Datos[K]) {
    setD((prev) => {
      const next = { ...prev, [k]: v }
      // El identificador se sugiere del nombre comercial (o la razon social)
      // hasta que alguien lo escribe a mano.
      if (!slugTocado && (k === 'nombreComercial' || k === 'razonSocial')) {
        next.slug = slugDe(next.nombreComercial || next.razonSocial)
      }
      // Bajar de plan saca los enterprise que ya no caben.
      if (k === 'tier' && v !== 'grande') {
        next.modulos = next.modulos.filter((id) => porId.get(id)?.category !== 'enterprise')
      }
      return next
    })
    setErrores((e) => {
      const n = { ...e }
      delete n[k]
      return n
    })
  }

  function alternar(id: string) {
    setD((prev) => ({
      ...prev,
      modulos: prev.modulos.includes(id)
        ? prev.modulos.filter((x) => x !== id)
        : [...prev.modulos, id],
    }))
  }

  function siguiente() {
    const e = erroresDelPaso(paso, d)
    setErrores(e)
    if (Object.keys(e).length > 0) return
    setPaso((p) => Math.min(p + 1, PASOS.length - 1))
  }

  function enviar() {
    for (const p of [0, 3]) {
      const e = erroresDelPaso(p, d)
      if (Object.keys(e).length > 0) {
        setErrores(e)
        setPaso(p)
        return
      }
    }
    const fd = new FormData()
    fd.set('razonSocial', d.razonSocial)
    fd.set('nombreComercial', d.nombreComercial)
    fd.set('rnc', d.rnc)
    fd.set('slug', d.slug)
    fd.set('tier', d.tier)
    for (const m of d.modulos) fd.append('modulos', m)
    fd.set('sucursal', d.sucursal)
    fd.set('almacen', d.almacen)
    fd.set('duenoNombre', d.duenoNombre)
    fd.set('duenoCorreo', d.duenoCorreo)
    startTransition(() => accion(fd))
  }

  function otro() {
    setCerrado(estado)
    setD(VACIO)
    setSlugTocado(false)
    setErrores({})
    setPaso(0)
  }

  const campo = (k: keyof Datos) => ({
    id: `${idBase}-${k}`,
    'aria-invalid': errores[k] ? true : undefined,
    'aria-describedby': errores[k] ? `${idBase}-${k}-error` : undefined,
  })
  const errorDe = (k: keyof Datos) =>
    errores[k] ? (
      <p id={`${idBase}-${k}-error`} className={ERROR}>
        {errores[k]}
      </p>
    ) : null

  if (estado?.ok && estado !== cerrado) {
    return (
      <Resultado
        estado={estado}
        nombre={nombre}
        modoDemo={modoDemo}
        refFoco={resultadoRef}
        otro={otro}
      />
    )
  }

  return (
    <div className="space-y-5">
      <ol aria-label="Pasos del alta" className="flex flex-wrap items-center gap-2 text-xs">
        {PASOS.map((p, i) => {
          const hecho = i < paso
          const actual = i === paso
          const circulo = (
            <span
              aria-hidden
              className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                actual
                  ? 'bg-[var(--color-brand)] text-[var(--color-text-on-brand)]'
                  : hecho
                    ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-bright)]'
                    : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]'
              }`}
            >
              {hecho ? <Icon name="check" size={14} /> : i + 1}
            </span>
          )
          return (
            <li
              key={p}
              aria-current={actual ? 'step' : undefined}
              className="flex items-center gap-2"
            >
              {hecho ? (
                <button
                  type="button"
                  onClick={() => setPaso(i)}
                  className="flex items-center gap-1.5 rounded-full py-1 pr-2 font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  {circulo}
                  {p}
                  <span className="sr-only"> (volver a este paso)</span>
                </button>
              ) : (
                <span
                  className={`flex items-center gap-1.5 py-1 pr-2 ${actual ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}
                >
                  {circulo}
                  {p}
                </span>
              )}
              {i < PASOS.length - 1 && (
                <span aria-hidden className="h-px w-4 bg-[var(--color-border)]" />
              )}
            </li>
          )
        })}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (paso < PASOS.length - 1) siguiente()
          else enviar()
        }}
        noValidate
        className="space-y-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 sm:p-6"
      >
        <h2
          ref={tituloRef}
          tabIndex={-1}
          className="text-lg font-semibold text-[var(--color-text-primary)] focus-visible:outline-none"
        >
          {paso + 1}. {PASOS[paso]}
        </h2>

        {paso === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor={`${idBase}-razonSocial`} className={ETIQUETA}>
                Razon social
              </label>
              <input
                {...campo('razonSocial')}
                value={d.razonSocial}
                onChange={(e) => poner('razonSocial', e.target.value)}
                placeholder="Electronica del Cibao SRL"
                autoComplete="off"
                className={CAMPO}
              />
              {errorDe('razonSocial')}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-nombreComercial`} className={ETIQUETA}>
                Nombre comercial{' '}
                <span className="font-normal text-[var(--color-text-muted)]">(opcional)</span>
              </label>
              <input
                {...campo('nombreComercial')}
                value={d.nombreComercial}
                onChange={(e) => poner('nombreComercial', e.target.value)}
                placeholder="ElectroCibao"
                autoComplete="off"
                className={CAMPO}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-rnc`} className={ETIQUETA}>
                RNC o cedula
              </label>
              <input
                {...campo('rnc')}
                value={d.rnc}
                onChange={(e) => poner('rnc', e.target.value)}
                onBlur={() => {
                  // Se avisa al salir del campo, no al enviar: un RNC malo
                  // se descubre donde se escribio.
                  if (!d.rnc) return
                  const m = erroresDelPaso(0, d).rnc
                  setErrores((x) => {
                    const n = { ...x }
                    if (m) n.rnc = m
                    else delete n.rnc
                    return n
                  })
                }}
                inputMode="numeric"
                placeholder="130-11111-1"
                autoComplete="off"
                className={CAMPO}
              />
              {errorDe('rnc') ?? (
                <p className={AYUDA}>
                  Sale impreso en cada comprobante y en el 607. Se valida el digito verificador.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor={`${idBase}-slug`} className={ETIQUETA}>
                Identificador
              </label>
              <input
                {...campo('slug')}
                value={d.slug}
                onChange={(e) => {
                  setSlugTocado(true)
                  poner('slug', e.target.value.toLowerCase())
                }}
                placeholder="electrocibao"
                autoComplete="off"
                spellCheck={false}
                className={`${CAMPO} font-[family-name:var(--font-mono)]`}
              />
              {errorDe('slug') ?? (
                <p className={AYUDA}>
                  Lo que identifica al cliente en REGB Control. No se cambia despues.
                </p>
              )}
            </div>
            <fieldset
              className="sm:col-span-2"
              aria-describedby={errores.tier ? `${idBase}-tier-error` : undefined}
            >
              <legend className={`${ETIQUETA} mb-2`}>Plan</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {TIERS.map((t) => (
                  <label
                    key={t}
                    className={`flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-md)] border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-brand-bright)] ${
                      d.tier === t
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-surface-overlay)]'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
                      <input
                        type="radio"
                        name="tier"
                        value={t}
                        checked={d.tier === t}
                        onChange={() => poner('tier', t)}
                        className="accent-[var(--color-brand)]"
                      />
                      {TIER_TEXTO[t].titulo}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {TIER_TEXTO[t].detalle}
                    </span>
                  </label>
                ))}
              </div>
              {errorDe('tier')}
            </fieldset>
          </div>
        )}

        {paso === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Lo que compro. Lo que cada modulo necesita entra solo. Los {cores.length} modulos core
              (catalogo, usuarios, roles, importar, respaldos...) vienen con todo cliente.
            </p>
            {Object.keys(CATEGORIA).map((cat) => {
              const lista = ofrecidos.filter((m) => m.category === cat)
              if (lista.length === 0) return null
              const bloqueada = cat === 'enterprise' && d.tier !== 'grande'
              return (
                <fieldset key={cat} className="space-y-2">
                  <legend className={`${ETIQUETA} mb-1`}>{CATEGORIA[cat]}</legend>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {lista.map((m) => {
                      const elegido = d.modulos.includes(m.id)
                      const pide = arrastre.get(m.id)
                      const dentro = elegido || pide !== undefined
                      return (
                        <label
                          key={m.id}
                          className={`flex min-h-11 items-start gap-2 rounded-[var(--radius-md)] px-2 py-2 text-sm ${
                            bloqueada
                              ? 'opacity-50'
                              : 'cursor-pointer hover:bg-[var(--color-surface-overlay)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={dentro}
                            disabled={bloqueada || pide !== undefined}
                            onChange={() => alternar(m.id)}
                            className="mt-0.5 accent-[var(--color-brand)]"
                          />
                          <span className="flex flex-col">
                            <span className="text-[var(--color-text-primary)]">{m.name}</span>
                            {pide !== undefined && (
                              <span className="text-xs text-[var(--color-text-secondary)]">
                                Entra porque lo necesita {pide.map(nombre).join(', ')}
                              </span>
                            )}
                            {!dentro && recomendados.has(m.id) && (
                              <span className="text-xs text-[var(--color-semantic-text-info)]">
                                Recomendado con {recomendados.get(m.id)!.map(nombre).join(', ')}
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              )
            })}
          </div>
        )}

        {paso === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-[var(--color-text-secondary)] sm:col-span-2">
              La empresa principal se crea con la razon social y el RNC del paso 1: es la que sale
              en cada comprobante. Aqui van la primera sucursal y el almacen del que descuenta la
              caja.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-sucursal`} className={ETIQUETA}>
                Sucursal
              </label>
              <input
                {...campo('sucursal')}
                value={d.sucursal}
                onChange={(e) => poner('sucursal', e.target.value)}
                className={CAMPO}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-almacen`} className={ETIQUETA}>
                Almacen predeterminado
              </label>
              <input
                {...campo('almacen')}
                value={d.almacen}
                onChange={(e) => poner('almacen', e.target.value)}
                className={CAMPO}
              />
              <p className={AYUDA}>Sin almacen, la caja no puede abrir turno.</p>
            </div>
          </div>
        )}

        {paso === 3 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-[var(--color-text-secondary)] sm:col-span-2">
              Entra con el rol Owner. La invitacion sirve una sola vez y vence en 7 dias; hasta que
              la acepte con ese correo, no ve nada.
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-duenoNombre`} className={ETIQUETA}>
                Nombre del dueño
              </label>
              <input
                {...campo('duenoNombre')}
                value={d.duenoNombre}
                onChange={(e) => poner('duenoNombre', e.target.value)}
                placeholder="Ramon Almonte"
                autoComplete="off"
                className={CAMPO}
              />
              {errorDe('duenoNombre')}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idBase}-duenoCorreo`} className={ETIQUETA}>
                Correo del dueño
              </label>
              <input
                {...campo('duenoCorreo')}
                type="email"
                value={d.duenoCorreo}
                onChange={(e) => poner('duenoCorreo', e.target.value)}
                placeholder="ramon@electrocibao.do"
                autoComplete="off"
                className={CAMPO}
              />
              {errorDe('duenoCorreo')}
            </div>
          </div>
        )}

        {paso === 4 && (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className={ETIQUETA}>Cliente</dt>
            <dd className="text-[var(--color-text-primary)]">
              {d.razonSocial}
              {d.nombreComercial && (
                <span className="text-[var(--color-text-secondary)]"> · {d.nombreComercial}</span>
              )}
            </dd>
            <dt className={ETIQUETA}>RNC</dt>
            <dd className="tabular text-[var(--color-text-primary)]">{d.rnc}</dd>
            <dt className={ETIQUETA}>Identificador</dt>
            <dd className="font-[family-name:var(--font-mono)] text-[var(--color-text-primary)]">
              {d.slug}
            </dd>
            <dt className={ETIQUETA}>Plan</dt>
            <dd className="text-[var(--color-text-primary)]">
              {d.tier ? TIER_TEXTO[d.tier].titulo : '—'}
            </dd>
            <dt className={ETIQUETA}>Modulos</dt>
            <dd className="text-[var(--color-text-primary)]">
              {cierre.length === 0 ? 'Solo los core' : cierre.map(nombre).join(', ')}
            </dd>
            <dt className={ETIQUETA}>Sucursal y almacen</dt>
            <dd className="text-[var(--color-text-primary)]">
              {d.sucursal || 'Principal'} · {d.almacen || 'Almacen principal'}
            </dd>
            <dt className={ETIQUETA}>Dueño</dt>
            <dd className="text-[var(--color-text-primary)]">
              {d.duenoNombre} · {d.duenoCorreo}
            </dd>
          </dl>
        )}

        {estado && !estado.ok && estado !== cerrado && (
          <div
            ref={resultadoRef}
            tabIndex={-1}
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-danger)] p-3 text-sm text-[var(--color-semantic-text-danger)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <Icon name="error" size={18} />
            <p>{estado.error} No se guardo nada.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={paso === 0 || pendiente}
            onClick={() => setPaso((p) => Math.max(0, p - 1))}
            icon={<Icon name="arrow_back" size={16} />}
          >
            Atras
          </Button>
          {paso < PASOS.length - 1 ? (
            <Button type="submit" icon={<Icon name="arrow_forward" size={16} />}>
              Siguiente
            </Button>
          ) : (
            <Button
              type="submit"
              loading={pendiente}
              icon={<Icon name="rocket_launch" size={16} />}
            >
              Dar de alta
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

function Resultado({
  estado,
  nombre,
  modoDemo,
  refFoco,
  otro,
}: {
  estado: Extract<ResultadoAlta, { ok: true }>
  nombre: (id: string) => string
  modoDemo: boolean
  refFoco: RefObject<HTMLDivElement | null>
  otro: () => void
}) {
  const titulo =
    estado.resultado === 'creado'
      ? 'Cliente dado de alta'
      : estado.resultado === 'completado'
        ? 'Ya existia: completamos lo que le faltaba'
        : 'Ya estaba dado de alta: no cambiamos nada'

  return (
    <div
      ref={refFoco}
      tabIndex={-1}
      role="status"
      className="space-y-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 focus-visible:outline-2 focus-visible:outline-[var(--color-brand-bright)] sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--color-semantic-success)_18%,transparent)] text-[var(--color-semantic-text-success)]">
          <Icon name="check_circle" size={22} filled />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{titulo}</h2>
          <p className="font-[family-name:var(--font-mono)] text-sm text-[var(--color-text-secondary)]">
            {estado.slug}
          </p>
        </div>
      </div>

      {(estado.piezas.length > 0 || estado.modulosActivados.length > 0) && (
        <ul className="space-y-1.5 text-sm text-[var(--color-text-secondary)]">
          {estado.piezas.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <Icon
                name="check"
                size={16}
                className="mt-0.5 text-[var(--color-semantic-text-success)]"
              />
              {PIEZAS[p] ?? p}
            </li>
          ))}
          {estado.modulosActivados.length > 0 && (
            <li className="flex items-start gap-2">
              <Icon
                name="check"
                size={16}
                className="mt-0.5 text-[var(--color-semantic-text-success)]"
              />
              Modulos activos: {estado.modulosActivados.map(nombre).join(', ')}
            </li>
          )}
        </ul>
      )}

      <section
        aria-label="Invitacion al dueño"
        className="space-y-2 border-t border-[var(--color-border)] pt-4"
      >
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">El dueño</h3>
        {estado.dueno.estado === 'invitado' && estado.dueno.enlace && (
          <>
            <p className="flex items-start gap-2 text-sm text-[var(--color-semantic-text-warning)]">
              <Icon name="unsubscribe" size={18} />
              <span className="font-semibold">Correo NO enviado</span>
            </p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {modoDemo
                ? 'Modo demostracion: no hay servidor de correo y nadie puede aceptar una invitacion aqui. El enlace es el mismo que recibiria el dueño.'
                : 'Desde REGB Control no sale el correo: la funcion de correo trabaja con la sesion de alguien del cliente, y todavia no hay nadie. Compartele este enlace al dueño por el canal que uses con el.'}
            </p>
            <EnlaceUnaVez
              enlace={estado.dueno.enlace}
              correo={estado.dueno.correo}
              vence={estado.dueno.vence}
            />
          </>
        )}
        {estado.dueno.estado === 'pendiente' && (
          <>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {estado.dueno.correo} ya tenia una invitacion pendiente. Por seguridad el enlace no se
              guarda: si lo perdiste, genera uno nuevo (el anterior deja de servir).
            </p>
            <EnlaceNuevoDueno clienteId={estado.clienteId} nombre={estado.slug} />
          </>
        )}
        {estado.dueno.estado === 'ya_miembro' && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {estado.dueno.correo} ya esta dentro del equipo del cliente.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
        <Link
          href="/control/onboarding"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          Ver en el tablero
        </Link>
        <Link
          href={`/control/${estado.slug}`}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-surface-overlay)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          Abrir su ficha
        </Link>
        {modoDemo && (
          <Link
            href={`/?tenant=${encodeURIComponent(estado.slug)}&rol=Owner`}
            className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Entrar como su Owner (demo)
          </Link>
        )}
        <Button type="button" variant="ghost" onClick={otro}>
          Dar de alta otro
        </Button>
      </div>
    </div>
  )
}

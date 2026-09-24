'use client'

import { startTransition, useActionState, useEffect, useId, useRef, useState } from 'react'
import { Button, Icon } from '@regb/ui'
import { BotonEnvio } from '@/components/BotonEnvio'
import { invitarMiembro, reenviarInvitacion } from './actions'
import { mensajeDeEnvio, type ResultadoInvitacion } from './invitacion'

/**
 * Las piezas de /usuarios que necesitan ver el resultado de la accion: el
 * enlace de una invitacion existe UNA sola vez -la base guarda su hash-,
 * asi que o se enseña aqui mismo o se pierde. Por eso no van por la
 * cookie de aviso, que es texto de 30 segundos y la lee cualquier script.
 */

const CAMPO =
  'h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'

const ETIQUETA = 'text-xs font-semibold text-[var(--color-text-secondary)]'

// ── Enlace para copiar ──────────────────────────────────────────────────
export function EnlaceCopiable({ enlace }: { enlace: string }) {
  const id = useId()
  const [copia, setCopia] = useState<'nada' | 'ok' | 'fallo'>('nada')

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace)
      setCopia('ok')
    } catch {
      setCopia('fallo')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ETIQUETA}>
        Enlace de invitación
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          readOnly
          value={enlace}
          onFocus={(e) => e.currentTarget.select()}
          className={`${CAMPO} min-w-0 flex-1 font-[family-name:var(--font-mono)] text-xs`}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={copiar}
          icon={<Icon name="content_copy" size={16} />}
        >
          Copiar enlace
        </Button>
        {/* En RD estas cosas se mandan por WhatsApp: el mensaje sale ya
            escrito, con el enlace, y la persona lo abre desde su telefono. */}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(
            `Te invito a entrar a nuestro sistema. Abre este enlace (es solo para ti): ${enlace}`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          <Icon name="chat" size={16} />
          Enviar por WhatsApp
        </a>
      </div>
      <p role="status" className="min-h-4 text-xs text-[var(--color-text-secondary)]">
        {copia === 'ok'
          ? 'Copiado. Compártelo solo con esa persona: el enlace es su llave de entrada.'
          : copia === 'fallo'
            ? 'No pudimos copiarlo. Selecciona el enlace y cópialo a mano.'
            : ''}
      </p>
    </div>
  )
}

// ── Lo que paso con el correo ───────────────────────────────────────────
/**
 * El estado nunca va solo en el color: icono + texto (ley de Aurora). Y el
 * contenedor recibe el foco al aparecer, para que quien navega con teclado
 * o lector de pantalla llegue directo al enlace.
 */
function ResultadoEnvio({ estado }: { estado: ResultadoInvitacion }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [estado])

  if (!estado.ok) {
    return (
      <div
        ref={ref}
        tabIndex={-1}
        role="alert"
        className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-sm text-[var(--color-semantic-text-danger)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand-bright)]"
      >
        <Icon name="error" size={18} />
        <p>{estado.error}</p>
      </div>
    )
  }

  const salio = estado.envio.enviado
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-base)] p-3 focus-visible:outline-2 focus-visible:outline-[var(--color-brand-bright)]"
    >
      <div
        className={`flex items-start gap-2 text-sm ${
          salio
            ? 'text-[var(--color-semantic-text-success)]'
            : 'text-[var(--color-semantic-text-warning)]'
        }`}
      >
        <Icon name={salio ? 'mark_email_read' : 'unsubscribe'} size={18} />
        <p className="font-semibold">{salio ? 'Correo enviado' : 'Correo NO enviado'}</p>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)]">
        {mensajeDeEnvio(estado.email, estado.envio)}
      </p>
      {estado.enlace && <EnlaceCopiable enlace={estado.enlace} />}
    </div>
  )
}

// ── Invitar ─────────────────────────────────────────────────────────────
export function InvitarForm({
  tenant,
  rol,
  roles,
  modoDemo,
}: {
  tenant: string
  rol: string
  roles: { id: string; name: string }[]
  modoDemo: boolean
}) {
  const [estado, accion, pendiente] = useActionState(invitarMiembro, null)
  const formRef = useRef<HTMLFormElement>(null)
  const ayudaId = useId()

  // Se limpia SOLO si salio bien: con un error, lo escrito se queda para
  // corregirlo. Por eso onSubmit y no `action=`: React 19 vacia el
  // formulario tras cualquier accion, saliera bien o no.
  useEffect(() => {
    if (estado?.ok) formRef.current?.reset()
  }, [estado])

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          startTransition(() => accion(fd))
        }}
        aria-describedby={ayudaId}
        className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end"
      >
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="rol" value={rol} />
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Nombre</span>
          <input
            name="nombre"
            required
            minLength={3}
            autoComplete="off"
            placeholder="Juana Perez"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Correo</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="juana@tuempresa.do"
            className={CAMPO}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Rol</span>
          {/* Sin rol preseleccionado: antes salia "Admin" -el primero de la
              lista- y un dueño apurado le daba acceso a todo al cajero sin
              darse cuenta. El rol se elige a proposito. */}
          <select name="roleId" required defaultValue="" className={CAMPO}>
            <option value="" disabled>
              Elige su rol…
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" loading={pendiente}>
          Invitar
        </Button>
      </form>

      <p id={ayudaId} className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
        <Icon name={modoDemo ? 'info' : 'mail'} size={16} />
        <span>
          {modoDemo
            ? 'Modo demostración: no hay servidor de correo conectado. Al invitar te damos el enlace para que lo compartas tú. No se envía ningún correo.'
            : 'Le llega un correo con un enlace de un solo uso que vence en 7 días. Hasta que lo abra y entre con ese correo, no ve nada.'}{' '}
          El rol decide qué módulos ve desde el primer día.
        </span>
      </p>

      {estado && <ResultadoEnvio estado={estado} />}
    </div>
  )
}

// ── Reenviar ────────────────────────────────────────────────────────────
export function ReenviarInvitacion({
  tenant,
  rol,
  invitationId,
  nombre,
}: {
  tenant: string
  rol: string
  invitationId: string
  nombre: string
}) {
  const [estado, accion] = useActionState(reenviarInvitacion, null)

  return (
    <div className="contents">
      <form action={accion}>
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="rol" value={rol} />
        <input type="hidden" name="invitationId" value={invitationId} />
        <BotonEnvio
          aria-label={`Reenviar la invitación de ${nombre}`}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-50"
        >
          Reenviar
        </BotonEnvio>
      </form>
      {estado && (
        <div className="basis-full">
          <ResultadoEnvio estado={estado} />
        </div>
      )}
    </div>
  )
}

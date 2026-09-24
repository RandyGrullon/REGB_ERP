'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@regb/ui'
import { BotonEnvio } from '@/components/BotonEnvio'

/**
 * Escaneo con la camara del celular (modulo 52, F8/S48).
 *
 * Usa `BarcodeDetector`, la API nativa del navegador -sin ninguna
 * libreria externa-. Donde no existe (Safari, la mayoria de
 * navegadores fuera de Chrome/Edge/Android), no pide camara: se queda
 * en la entrada manual, que funciona identico a un lector fisico tipo
 * "keyboard wedge" -escribe el codigo, Enter, listo-.
 *
 * Es cliente porque `getUserMedia`/`BarcodeDetector` no existen en el
 * servidor; el formulario en si sigue siendo la misma server action de
 * siempre -la camara solo llena la casilla y envia, nunca hace la
 * escritura ella misma-.
 */

interface Props {
  action: (formData: FormData) => Promise<void>
  tenant: string
  rol: string
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
    }
  }
}

export function EscaneoCodigoBarras({ action, tenant, rol }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camaraActiva, setCamaraActiva] = useState(false)
  const [soportada, setSoportada] = useState(true)
  const [estado, setEstado] = useState<string | null>(null)

  useEffect(() => {
    setSoportada(typeof window !== 'undefined' && 'BarcodeDetector' in window)
  }, [])

  useEffect(() => {
    if (!camaraActiva) return
    let detenido = false
    let stream: MediaStream | null = null

    async function iniciar() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (detenido) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        const Detector = window.BarcodeDetector
        if (!Detector) return
        const detector = new Detector({ formats: ['ean_13', 'code_128', 'upc_a'] })

        const intervalo = setInterval(async () => {
          if (detenido || !videoRef.current) return
          try {
            const resultados = await detector.detect(videoRef.current)
            const primero = resultados[0]
            if (primero) {
              clearInterval(intervalo)
              detener()
              if (inputRef.current) inputRef.current.value = primero.rawValue
              formRef.current?.requestSubmit()
            }
          } catch {
            // Un frame fallido no detiene el intento -sigue probando con el siguiente-.
          }
        }, 400)

        return () => clearInterval(intervalo)
      } catch {
        setEstado('No se pudo activar la camara -revisa los permisos del navegador-.')
        setCamaraActiva(false)
      }
    }

    function detener() {
      detenido = true
      stream?.getTracks().forEach((t) => t.stop())
      setCamaraActiva(false)
    }

    void iniciar()
    return () => detener()
  }, [camaraActiva])

  return (
    <div className="space-y-3">
      {soportada && (
        <div className="space-y-2">
          {camaraActiva ? (
            <video
              ref={videoRef}
              className="aspect-video w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border)] bg-black"
              muted
              playsInline
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEstado(null)
                setCamaraActiva(true)
              }}
              className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
            >
              <Icon name="photo_camera" size={18} />
              Activar camara
            </button>
          )}
          {estado && <p className="text-xs text-[var(--color-semantic-text-danger)]">{estado}</p>}
        </div>
      )}
      {!soportada && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Tu navegador no soporta escaneo con camara -escribe el código abajo, o usa un lector
          fisico: funciona identico-.
        </p>
      )}

      <form ref={formRef} action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="rol" value={rol} />
        <label className="flex min-w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Codigo
          <input
            ref={inputRef}
            name="codigo"
            autoFocus
            placeholder="Escanea o escribe el codigo"
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
          />
        </label>
        <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
          <Icon name="search" size={18} />
          Buscar
        </BotonEnvio>
      </form>
    </div>
  )
}

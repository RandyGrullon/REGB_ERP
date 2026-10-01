'use client'

import { LOGO_TRAZOS } from '@regb/ui'

/**
 * Ultimo recurso: cuando revienta el propio layout raiz y `error.tsx` no
 * puede pintarse. Aqui no hay tokens ni tema -el layout que los carga es
 * justo lo que fallo-, asi que va con estilos en linea copiados de los
 * tokens oscuros (`packages/config/tokens.json`), que es el tema por
 * defecto. Si cambian los tokens, cambian aqui a mano.
 *
 * El logo va en SVG con los mismos trazos que `Logo` (`LOGO_TRAZOS`) pero
 * pintado con hex: `Logo` usa las variables del tema, que aqui no existen.
 */
export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#1D1D1F',
          color: '#F5F5F7',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div role="alert" style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <svg
            viewBox="0 0 64 64"
            width={48}
            height={48}
            aria-hidden="true"
            focusable="false"
            style={{ display: 'block', margin: '0 auto 16px' }}
          >
            <path d={LOGO_TRAZOS.loseta} fill="#0071E3" />
            <g fill="#FFFFFF">
              <path d={LOGO_TRAZOS.asta} />
              <path d={LOGO_TRAZOS.base} />
              <path d={LOGO_TRAZOS.pata} />
              <path d={LOGO_TRAZOS.hoja} />
            </g>
          </svg>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>REGB no pudo cargar</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#CCCCCC' }}>
            Lo que ya guardaste sigue guardado. Intenta de nuevo en un momento.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#98989D', fontFamily: 'monospace' }}>
              Código: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 12,
              height: 40,
              padding: '0 20px',
              borderRadius: 999,
              border: 0,
              background: '#0071E3',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  )
}

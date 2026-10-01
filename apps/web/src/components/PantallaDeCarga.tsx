import { Logo } from '@regb/ui'

/**
 * Lo que se ve mientras llega una página: el `fallback` del Suspense del
 * layout raíz (`app/layout.tsx`).
 *
 * Server Component a propósito: tiene que pintarse con el primer trozo de
 * HTML, antes de que cargue una sola línea de JavaScript. Todo lo que se
 * mueve es CSS (`components/carga.css`).
 *
 * ── Cuánto dura ───────────────────────────────────────────────────────
 *
 * Exactamente lo que tarde la página. En cuanto llega el contenido, React
 * cambia este bloque por la pantalla de verdad: no hay un tiempo mínimo
 * ni se espera a que termine la animación. Si la página llega en menos de
 * 160 ms no se ve nada: la bienvenida entra con esa demora para no
 * parpadear en las cargas rápidas.
 *
 * ── Qué enseña ────────────────────────────────────────────────────────
 *
 * - Al abrir la app o recargar (`data-carga="inicio"`): el logo que se
 *   arma -las cuatro piezas de la R encajan y la hoja brota- con el nombre
 *   debajo, más la barra fina de arriba.
 * - Al llegar desde otra pantalla (`data-carga="navegacion"`): solo la
 *   barra. Sin nada "con contenido" que pintar, Chrome mantiene a la
 *   vista la pantalla anterior mientras carga la nueva (paint holding).
 *
 * El modo lo decide un script del <head> antes de pintar (`lib/carga.ts`)
 * y los colores salen de los tokens del tema que ya trae el <html> desde
 * el servidor: ni destello de la bienvenida en cada clic ni del tema
 * equivocado.
 */
export function PantallaDeCarga() {
  return (
    <div className="regb-carga" role="status" aria-live="polite">
      <div className="regb-carga__marca" aria-hidden="true">
        <Logo size={72} decorative />
        <span className="regb-carga__nombre" translate="no">
          REGB
        </span>
      </div>
      <span className="sr-only">Cargando REGB…</span>
    </div>
  )
}

import type { Metadata } from 'next'
import { Suspense, type ReactNode } from 'react'
import { cookies } from 'next/headers'
import { COOKIE_TEMA, temaDe } from '@/lib/tema'
import { SCRIPT_MODO_DE_CARGA } from '@/lib/carga'
import { BarraDeProgreso } from '@/components/BarraDeProgreso'
import { PantallaDeCarga } from '@/components/PantallaDeCarga'
import './globals.css'
import '@/components/carga.css'

export const metadata: Metadata = {
  title: 'REGB ERP',
  description: 'ERP modular multi-tenant',
}

/**
 * Oscuro por defecto, claro si la persona lo eligio (`TemaToggle`).
 *
 * Se decide aqui, en el servidor, para que el primer HTML ya salga con el
 * tema bueno: sin destello de un tema al otro al cargar.
 *
 * ── Carga ─────────────────────────────────────────────────────────────
 *
 * El Suspense de aqui es lo que permite enseñar algo mientras llega la
 * página: sin él, el servidor no manda nada hasta tener la pantalla
 * entera y el navegador se queda en blanco. Con él, el primer trozo de
 * HTML ya trae la barra de progreso y la pantalla de bienvenida
 * (`PantallaDeCarga`), y React las cambia por la página en cuanto llega.
 *
 * Es un `<Suspense>` puesto a mano y no un `app/loading.tsx` a proposito:
 * `loading.tsx` tambien se enseña al navegar con el router de Next (tras
 * una accion que redirige), y taparia la pantalla anterior con el
 * fallback. Este, en cambio, solo aparece en la primera carga del
 * documento: en las navegaciones del router React mantiene la pantalla
 * vieja hasta que la nueva esta lista, y el progreso lo enseña la barra.
 *
 * El script del <head> decide, antes de pintar, si la carga es "inicio"
 * (abrir o recargar: bienvenida con el logo) o "navegacion" (solo la
 * barra). Ver `lib/carga.ts`.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const tema = temaDe((await cookies()).get(COOKIE_TEMA)?.value)

  return (
    <html lang="es" data-theme={tema} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_MODO_DE_CARGA }} />
      </head>
      <body className="h-screen overflow-hidden">
        <BarraDeProgreso />
        <Suspense fallback={<PantallaDeCarga />}>{children}</Suspense>
      </body>
    </html>
  )
}

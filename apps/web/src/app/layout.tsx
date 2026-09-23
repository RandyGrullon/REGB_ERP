import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { COOKIE_TEMA, temaDe } from '@/lib/tema'
import './globals.css'

export const metadata: Metadata = {
  title: 'REGB ERP',
  description: 'ERP modular multi-tenant',
}

/**
 * Oscuro por defecto, claro si la persona lo eligio (`TemaToggle`).
 *
 * Se decide aqui, en el servidor, para que el primer HTML ya salga con el
 * tema bueno: sin destello de un tema al otro al cargar.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const tema = temaDe((await cookies()).get(COOKIE_TEMA)?.value)

  return (
    <html lang="es" data-theme={tema} suppressHydrationWarning>
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  )
}

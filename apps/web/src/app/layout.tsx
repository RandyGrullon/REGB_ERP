import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'REGB ERP',
  description: 'ERP modular multi-tenant',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" data-theme="dark" suppressHydrationWarning>
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  )
}

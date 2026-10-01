import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Los paquetes del monorepo se distribuyen como TypeScript sin compilar:
  // Next los transpila junto con la app.
  transpilePackages: [
    '@regb/ui',
    '@regb/core',
    '@regb/config',
    '@regb/permissions',
    '@regb/sdk',
    '@regb/module-registry',
    '@regb/mod-products',
    '@regb/mod-inventory',
    '@regb/mod-pos',
    '@regb/mod-payroll',
    '@regb/mod-invoice-capture',
  ],
  typedRoutes: false,
  // Una segunda instancia en la misma carpeta (p. ej. la de prueba con
  // inicio de sesion real, en el 3150, al lado de la demo del 3100) no
  // puede compartir `.next`: se pisan la compilacion una a la otra.
  // `REGB_NEXT_DIST_DIR=.next-3150 next dev -p 3150`. Sin la variable, igual
  // que siempre.
  distDir: process.env.REGB_NEXT_DIST_DIR || '.next',
}

export default config

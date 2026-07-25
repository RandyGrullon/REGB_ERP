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
    '@regb/module-registry',
    '@regb/mod-products',
    '@regb/mod-inventory',
    '@regb/mod-pos',
    '@regb/mod-payroll',
    '@regb/mod-invoice-capture',
  ],
  typedRoutes: false,
}

export default config

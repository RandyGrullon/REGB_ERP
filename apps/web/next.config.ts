import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Los paquetes del monorepo se distribuyen como TypeScript sin compilar:
  // Next los transpila junto con la app.
  transpilePackages: [
    '@nexus/ui',
    '@nexus/core',
    '@nexus/config',
    '@nexus/permissions',
    '@nexus/module-registry',
    '@nexus/mod-products',
    '@nexus/mod-inventory',
    '@nexus/mod-pos',
    '@nexus/mod-payroll',
  ],
  typedRoutes: false,
}

export default config

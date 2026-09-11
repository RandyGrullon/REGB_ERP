/*
 * Expo y Metro cargan sus configuraciones como CommonJS, asi que aqui
 * `require()` no es pereza: es la unica forma que entiende el cargador.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Metro en un monorepo con pnpm.
 *
 * Sin esto la app NO empaqueta: pnpm no aplana `node_modules`, deja
 * enlaces simbolicos, y Metro por defecto solo mira la carpeta de la app.
 * Hay que decirle dos cosas:
 *
 *  1. `watchFolders`: los paquetes de `packages/` viven fuera de apps/mobile.
 *  2. `nodeModulesPaths`: donde buscar los paquetes reales, ya que pnpm los
 *     guarda en el `.pnpm` de la raiz.
 *
 * `unstable_enablePackageExports` se deja explicito porque los paquetes
 * del repo (`@regb/ui-native`, `@regb/sdk`) se publican por el campo
 * `exports` apuntando a TypeScript sin compilar.
 */
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const raiz = path.resolve(__dirname, '../..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [raiz]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(raiz, 'node_modules'),
]
config.resolver.unstable_enablePackageExports = true

module.exports = config

/*
 * Expo y Metro cargan sus configuraciones como CommonJS, asi que aqui
 * `require()` no es pereza: es la unica forma que entiende el cargador.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Configuracion de la app movil.
 *
 * Es un .js y no un .json por una sola razon: el color de fondo del icono
 * adaptativo de Android es un color de Aurora, y en este repo ningun color
 * se escribe a mano. Sale de tokens.json, la misma fuente que usan web,
 * escritorio y `@regb/ui-native`.
 */
const tokens = require('@regb/config/tokens')

module.exports = {
  expo: {
    name: 'REGB ERP',
    slug: 'regb-erp',
    version: '0.1.0',
    orientation: 'portrait',
    scheme: 'regb',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'do.regb.erp',
    },
    android: {
      package: 'do.regb.erp',
      adaptiveIcon: { backgroundColor: tokens.color.surface.deepest.dark },
    },
    plugins: ['expo-router'],
    experiments: { typedRoutes: true },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? null,
    },
  },
}

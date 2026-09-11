/**
 * Babel de la app movil.
 *
 * `babel-preset-expo` ya trae TypeScript, JSX y el runtime de React 19,
 * y desde SDK 50 tambien el plugin de expo-router: no hay que agregarle
 * nada mas. Existe como archivo porque Metro lo busca aqui.
 */
module.exports = function (api) {
  api.cache(true)
  return { presets: ['babel-preset-expo'] }
}

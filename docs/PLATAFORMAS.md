# Estado real de las tres plataformas

> Un cerebro, tres cuerpos. Este documento dice, sin adornos, que existe
> de verdad hoy en cada plataforma y que sigue siendo solo una bandera
> en un manifest.

La regla de arquitectura (skill `tri-platform`) es que **~70% del
codigo es compartido**: si una regla de negocio se escribe dos veces,
algo esta mal.

## Que se comparte de verdad

| Paquete             | Contenido                                                        | Web | Escritorio | Movil |
| ------------------- | ---------------------------------------------------------------- | :-: | :--------: | :---: |
| `@regb/operations`  | Maquinas de estado, formulas, formateo -814 pruebas-             | ✔️  |     ✔️     |  ✔️   |
| `@regb/sdk`         | `readSession()`: interpreta los claims. El tenant sale de aqui    | ✔️  |     ✔️     |  ✔️   |
| `@regb/sdk/native`  | Cliente Supabase para RN (sesion en el dispositivo, no cookies)   |  —  |     —      |  ✔️   |
| `@regb/config`      | `tokens.json`: fuente unica de color/tipografia. Cero hex a mano | ✔️  |     ✔️     |  ✔️   |
| `@regb/ui`          | Componentes Aurora web                                           | ✔️  |     ✔️     |   —   |
| `@regb/ui-native`   | Componentes Aurora nativos                                       |  —  |     —      |  ✔️   |
| `@regb/permissions` | Quien puede que                                                  | ✔️  |     ✔️     |  ✔️   |

## Web (`apps/web`) — completa

Next.js. Es la referencia visual y funcional: **los ~74 modulos
construidos tienen su UI real aqui**, con RLS verificado por 814
pruebas contra Postgres real y `gate:f0` en verde.

## Escritorio (`apps/desktop`) — shell nativo sobre la web

Electron. Segun la regla del proyecto, **el escritorio NO reimplementa
la UI**: carga la app web y agrega solo lo que un navegador no puede
-impresion termica, cola offline, sincronizador, IPC, atajos-. Lo que
ya existia de F5 (`cola.ts`, `impresora.ts`, `sincronizador.ts`) es
logica pura con sus pruebas; lo que faltaba era la ventana que
finalmente carga el ERP.

Lo verificado: `typecheck`, `lint` y las 53 pruebas de `apps/desktop`
estan en verde, y `servidor.ts` (a que servidor se conecta, que entra en
la ventana, que sale por el papel) esta cubierto por pruebas puras.

### Lo que falta, dicho claro

- ~~La ventana de Electron nunca se ha abierto.~~ **ABIERTA el
  2026-09-11.** La ventana levanta y carga el ERP real: el titulo dice
  "Caja · REGB ERP" y el servidor registra la navegacion de `/pos`,
  `/pos/shifts`, `/pos/reports` y `/products` desde ella.

  Por que nunca habia abierto: **pnpm nunca descargo el binario de
  Electron**. Desde pnpm 10 los scripts de postinstall no corren salvo
  que el paquete este en `onlyBuiltDependencies`, asi que
  `node_modules/electron` tenia el JavaScript pero no el ejecutable, y
  fallaba con "Electron failed to install correctly". Ya esta declarado
  en el `package.json` de la raiz, asi que una instalacion limpia lo
  baja sola. No era un problema del codigo del escritorio: ese estaba
  bien desde el principio.

  Lo que sigue sin verse: la pantalla de error cuando el servidor no
  contesta, y los atajos F2/F4.
- La impresion termica y la gaveta no se han probado contra una
  impresora fisica: `abrirGaveta` depende de que la termica este
  compartida en Windows con un nombre.
- La ruta `/api/pos/sync` de `apps/web` existe y su contrato cuadra con
  el del sincronizador (`{ventas}` → `{aceptadas, rechazadas,
  resultados}`), pero nadie ha subido una venta real por ahi desde el
  escritorio.
- No hay UI para escribir `servidor.json`: hoy se escribe a mano.

## Movil (`apps/mobile`) — prueba de concepto honesta

Expo + expo-router. **No replica el ERP completo, y no debe hacerlo**:
cada manifest declara su `mobileScope`. Hoy hay exactamente un modulo
portado, `chat`, elegido por ser el caso de uso mas genuinamente movil
del catalogo.

Lo verificado: `typecheck` y `lint` en verde en `apps/mobile` y en
`@regb/ui-native` (6 pruebas, una de ellas vigila que ningun componente
escriba un color a mano), y `expo export --platform android` genera el
bundle completo, o sea que Metro resuelve de verdad `@regb/ui-native`,
`@regb/sdk/native` y `@regb/operations` desde el monorepo con pnpm.

### Lo que falta, dicho claro

- **Nadie ha corrido la app movil en un dispositivo ni en un simulador
  todavia.** Compila y empaqueta; no esta probada: ningun login, ningun
  mensaje enviado desde un telefono de verdad.
- Los otros ~73 modulos declaran `mobile: true` en su manifest: eso es
  una promesa de diseno, no codigo.
- Faltan las capacidades que justifican una app nativa: camara, GPS,
  push, biometria, gestos.
- El movil no tiene cola offline propia todavia (el escritorio si).
- No hay tour de tutorial en movil.

## Verificacion de paridad — pendiente

El skill `tri-platform` exige, antes de declarar paridad: misma accion
con mismo resultado en las tres, mismos permisos validados en servidor,
mismos mensajes de error palabra por palabra, mismos tokens, logica
probada una sola vez, y una mutacion creada en movil que aparezca en
web. **Solo lo ultimo esta pendiente de comprobarse en vivo**, porque
requiere correr la app movil de verdad.

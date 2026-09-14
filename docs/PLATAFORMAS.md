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

## Movil (`apps/mobile`) — seis pantallas y una cola

Expo + expo-router. **No replica el ERP completo, y no debe hacerlo**:
cada manifest declara su `mobileScope`.

Portado hoy, todo filtrado por modulo contratado Y permiso del rol:

| Pantalla       | Que hace                                           |
| -------------- | -------------------------------------------------- |
| `chat`         | Canales y hilos. Fue la prueba de concepto original |
| `existencias`  | Consultar que hay y donde                          |
| `conteos`      | Contar inventario sin ver el numero del sistema     |
| `transferir`   | Mover mercancia entre almacenes                     |
| `vacaciones`   | Pedir dias, con los laborables contados en la base  |
| `gastos`       | Reportar el gasto cuando dan el comprobante         |
| `pendientes`   | Lo que se hizo sin señal y todavia no subio         |

### La cola offline (0114 + `cola-movil`)

Es lo que hace que las tres pantallas de escritura sirvan donde de verdad
se usan. La regla: **si la base hablo, la respuesta es final**. Un error
con codigo SQL se le enseña al usuario ahora; un fallo sin codigo -la
base nunca contesto- se guarda en el telefono y sube solo.

Nada se descarta nunca. Lo que la base rechaza al subir pasa a una lista
aparte de "trabado", porque eso lo resuelve una persona y no un
reintento.

El reintento es seguro porque el telefono decide el `uuid` de la fila
ANTES de mandarla (`p_ref`, migracion 0114): un segundo intento no es una
accion parecida, es la misma clave primaria.

La logica vive en `@regb/operations/cola-movil` con 17 pruebas; en la app
solo queda AsyncStorage, PostgREST y AppState.

### Lo que falta, dicho claro

- **Nadie ha corrido la app movil en un dispositivo ni en un simulador
  todavia.** Compila y empaqueta -`expo export --platform android` genera
  el bundle, o sea que Metro resuelve de verdad `@regb/ui-native`,
  `@regb/sdk/native` y `@regb/operations` desde el monorepo con pnpm- pero
  no esta probada: ningun login, ninguna transferencia hecha desde un
  telefono de verdad. **Y la cola es justo lo que menos se puede dar por
  bueno sin eso**: su razon de existir es lo que pasa cuando la red falla,
  y eso no se ejerce en un `export`.
- Los otros ~72 modulos declaran `mobile: true` en su manifest: eso es
  una promesa de diseno, no codigo.
- Faltan las capacidades que justifican una app nativa: camara, GPS,
  push, biometria, gestos. La camara es la que mas se nota -un gasto sin
  foto del comprobante y un conteo sin escaneo-.
- Los conteos todavia no pasan por la cola: escriben `stock_count_lines`
  directo. Contar es lo mas largo que se hace sin señal, asi que es lo
  siguiente.
- No hay tour de tutorial en movil.

## Verificacion de paridad — pendiente

El skill `tri-platform` exige, antes de declarar paridad: misma accion
con mismo resultado en las tres, mismos permisos validados en servidor,
mismos mensajes de error palabra por palabra, mismos tokens, logica
probada una sola vez, y una mutacion creada en movil que aparezca en
web. **Solo lo ultimo esta pendiente de comprobarse en vivo**, porque
requiere correr la app movil de verdad.

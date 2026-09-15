# `apps/mobile` — REGB ERP en el telefono

App Expo (React Native + expo-router) del ERP. **No replica el ERP
completo**: solo lo que cada manifest declara en `mobileScope`. Esa es
una decision de producto, no deuda tecnica -el documento maestro §11 y
el skill `tri-platform` lo dicen explicitamente-.

## Lo que comparte con web y escritorio

| Vive en            | Que se reusa aqui                                             |
| ------------------ | ------------------------------------------------------------- |
| `@regb/operations` | Toda la logica pura: maquinas de estado, formulas, formateo   |
| `@regb/sdk`        | `readSession()` -interpreta los claims igual que la web-      |
| `@regb/sdk/native` | Cliente Supabase para RN (sesion en AsyncStorage, no cookies) |
| `@regb/ui-native`  | Componentes Aurora nativos, con los tokens de `@regb/config`  |
| `@regb/config`     | `tokens.json`: ni un solo hex escrito a mano                  |

La regla que no se negocia sigue igual en el telefono: **el `tenantId`
sale de los claims del token y de ningun otro sitio**. RLS decide que
filas existen; una app instalada no tiene ningun privilegio extra.

## Lo que YA esta

- Arranque, tema claro/oscuro siguiendo al sistema, navegacion con
  expo-router.
- Sesion real contra Supabase (correo y contraseña) con persistencia en
  el dispositivo y redireccion segun tenga tenant o no.
- Menu filtrado por **modulo contratado Y permiso del rol** (`mi_rol()`
  + `mis_modulos()`, evaluados con el mismo `can()` de la web). Es
  ergonomia, no seguridad: lo que decide es la RLS.
- Seis pantallas: `chat`, `existencias`, `conteos`, `transferir`,
  `vacaciones`, `gastos`.
- **Cola offline** (`src/cola.tsx` + `@regb/operations/cola-movil`): lo
  que se hace sin señal se guarda en el telefono y sube solo. Ver abajo.

## La cola, en corto

La regla: **si la base hablo, la respuesta es final**. Un error con
codigo SQL se enseña ahora mismo; un fallo sin codigo -la base nunca
contesto- se encola.

Nada se descarta. Lo que la base rechaza al subir pasa a una lista de
"trabado" en la pantalla de pendientes, porque eso lo arregla una
persona y no un reintento.

El reintento es seguro porque el telefono decide el `uuid` de la fila
antes de mandarla (`p_ref`, migracion 0114): el segundo intento es la
misma clave primaria, no una accion parecida.

Pasan por la cola `transferir`, `reportar_gasto` y `pedir_vacaciones`.
Pasan tambien los CONTEOS, que son de otra clase: no crean nada, le
asignan un numero a una linea. Por eso recontar la misma linea sin señal
reemplaza lo que esperaba en vez de acumular dos numeros que se van a
pisar al subir.

## Lo que esta verificado (y con que)

- `pnpm --filter @regb/mobile typecheck` y `lint` en verde, sin un solo
  `any` ni `@ts-ignore`.
- La logica de la cola: 21 pruebas en `@regb/operations`, sin telefono
  de por medio. Lo que la sostiene en la base: 7 pruebas de idempotencia
  (`idempotencia-movil.test.ts`) y 15 de la puerta de contar
  (`contar.test.ts`), contra Postgres real.
- `expo export --platform android` genera el bundle completo: Metro
  resuelve de verdad `@regb/ui-native` (TypeScript sin compilar),
  `@regb/sdk/native`, `@regb/operations` y `expo-crypto`. Eso prueba que
  empaqueta, no que funcione.
- `npx expo-doctor`: 17 de 18 comprobaciones pasan. La que falla es que
  el repo usa TypeScript 5.9 y Expo SDK 53 espera 5.8; la version de
  TypeScript es del monorepo entero y no se toca desde aqui.

## Lo que NO esta -y es importante decirlo-

- **No se ha corrido en un dispositivo ni en un simulador todavia.** El
  codigo compila y empaqueta, pero nadie ha visto esta app arrancar, ni
  ha entrado con un usuario real, ni ha movido mercancia desde el
  telefono. No la des por funcional hasta hacerlo.
- **La cola es lo que menos se puede dar por bueno sin eso.** Su razon de
  existir es lo que pasa cuando la red falla, y un `expo export` no
  ejerce eso. La logica esta probada; el comportamiento en un telefono
  con señal mala, no.
- Los otros ~72 modulos declaran `mobile: true` en su manifest, y eso
  hoy es una promesa de diseno, no codigo.
- Sin camara, GPS, push, biometria ni gestos -lo que segun el skill
  `tri-platform` justifica que exista una app movil en primer lugar-. La
  camara es la que mas se nota: un gasto sin foto del comprobante y un
  conteo sin escaneo.
- Sin tour de tutorial.

## Configuracion

La app espera la URL y la clave anonima de Supabase por
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`, o por
`extra` en `app.config.js`, que las lee de esas mismas variables. Son
las MISMAS de la web: la clave anonima no da privilegios.

La configuracion es `app.config.js` y no `app.json` porque el color de
fondo del icono adaptativo de Android sale de `tokens.json`: en este
repo ningun color se escribe a mano, tampoco en la configuracion.

```bash
pnpm --filter @regb/mobile start
```

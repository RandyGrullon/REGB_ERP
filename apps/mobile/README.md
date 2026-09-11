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
- **Prueba de concepto de las tres plataformas: `chat`** -lista de
  canales y hilo de un canal, leer y enviar mensajes reales-. Se eligio
  `chat` porque es el caso de uso mas genuinamente movil de todo el
  catalogo, su esquema son dos tablas, y ejercita lectura Y escritura
  contra RLS.

## Lo que esta verificado (y con que)

- `pnpm --filter @regb/mobile typecheck` y `lint` en verde, sin un solo
  `any` ni `@ts-ignore`.
- `expo export --platform android` genera el bundle completo: Metro
  resuelve de verdad `@regb/ui-native` (TypeScript sin compilar),
  `@regb/sdk/native` y `@regb/operations`. Eso prueba que empaqueta, no
  que funcione.
- `npx expo-doctor`: 17 de 18 comprobaciones pasan. La que falla es que
  el repo usa TypeScript 5.9 y Expo SDK 53 espera 5.8; la version de
  TypeScript es del monorepo entero y no se toca desde aqui.

## Lo que NO esta -y es importante decirlo-

- **No se ha corrido en un dispositivo ni en un simulador todavia.** El
  codigo compila y empaqueta, pero nadie ha visto esta app arrancar, ni
  ha entrado con un usuario real, ni ha enviado un mensaje desde el
  telefono. No la des por funcional hasta hacerlo.
- Ningun otro modulo esta portado: los ~74 manifests declaran
  `mobile: true`, y eso hoy es una promesa de diseno, no codigo.
- Sin camara, GPS, push, biometria ni gestos -lo que segun el skill
  `tri-platform` justifica que exista una app movil en primer lugar-.
- Sin cola offline propia: `apps/desktop` ya tiene la suya (`cola.ts`),
  el movil todavia no.
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

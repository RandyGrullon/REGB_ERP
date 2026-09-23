# Poner el primer cliente en producción

Qué hace falta, en orden, para que un negocio real empiece a usar REGB ERP
mañana. Nada de esto es código nuevo: el código está. Lo que falta es
**configurar y cargar datos**, y algunas cosas solo las puedes hacer tú
porque implican crear cuentas y credenciales.

Verificado contra el repo el 2 de septiembre de 2026; el alta del cliente
(paso 3) y la carga de catálogo y existencias (paso 4) se rehicieron el 23
de septiembre (migración 0133) y ya no piden SQL. **Ya hay un primer
cliente real confirmado**: una empresa de venta de productos electrónicos,
con ventas al contado y a crédito (15/30 días según el cliente).

---

## Antes de empezar: qué está listo y qué no

| | Estado |
|---|---|
| Catálogo, inventario, pedidos, caja, cobros y compras a proveedores | ✅ funcionando |
| Cargo por mora manual (sin fórmula automática) y clientes exentos | ✅ funcionando |
| NCF, reportes 607 y 608, validación de RNC | ✅ funcionando |
| Lector de código de barras y ticket de 80 mm | ✅ funcionando |
| Aislamiento entre clientes (RLS) | ✅ con 196 pruebas |
| Responsive 375 / 768 / 1440 | ✅ 32 pantallas verificadas |
| **Inicio de sesión real** | ⚠️ el código está, falta configurarlo — [paso 1](#1-conectar-supabase) |
| **Cobro automático de la mensualidad** | ❌ pasarelas sin conectar — [paso 7](#7-cobrar) |
| App de escritorio y móvil | ❌ son F5 |
| Envío de e-CF a la DGII | ❌ es F6 |
| Reporte 606 (compras) | ❌ falta investigar el formato exacto que pide la DGII |

**Se puede operar sin las tres últimas.** Un colmado factura con NCF en
papel y paga por transferencia; eso es exactamente cómo opera hoy la
mayoría en el país.

---

## 1. Conectar Supabase

Hoy la app corre en **modo demostración**: el cliente y el rol viajan en la
URL (`?tenant=…&rol=…`) y no hay contraseña. Eso es una vitrina, no un
sistema. `apps/web/src/lib/supabase.ts:38` lo decide con una sola condición:
si existen las dos variables de entorno, hay login real.

1. Crea un proyecto en Supabase. En *Project Settings → Database →
   Connection string*, usa la variante **Session pooler** (URI), no
   *Direct connection*: la directa exige IPv6, que la mayoría de redes
   domesticas no tiene. Pon esa cadena (con la contraseña real, no
   `[YOUR-PASSWORD]`) en `DATABASE_URL`.
2. Aplica las 40 migraciones sobre esa base, **desde cero y en orden**. No
   hay `down`: la garantía es que arranca limpia, y es la que se ejerce en
   cada `gate:f0`. No hay `psql` ni `supabase` CLI garantizados en todos los
   entornos; el driver `postgres` (ya en `apps/web/node_modules`) sirve
   igual — un script de una docena de líneas que lee `supabase/migrations/`
   ordenado y llama `sql.file()` por archivo, cortando en el primer error.
3. Crea `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
DATABASE_URL=postgresql://…
```

4. **Registra el hook de token.** Sin esto nada funciona: es lo que mete
   `tenant_id` y `is_provider` en el JWT, y toda la RLS del sistema cuelga
   de ese claim. En el panel de Supabase, *Authentication → Hooks → Custom
   Access Token*, apunta a **`rls.custom_access_token_hook`** — no
   `auth.custom_access_token_hook`. La migración
   [`0008_auth_token_hook.sql`](../supabase/migrations/0008_auth_token_hook.sql)
   ya le dio el `grant` a `supabase_auth_admin`.

   > 🐞 **Descubierto al desplegar contra un proyecto real por primera
   > vez (2026-09-02):** las funciones de aislamiento (`tenant_id()`,
   > `is_provider()`, `module_active()`, `impersonating()`, y este mismo
   > hook) vivían en el esquema `auth`. Eso funcionaba en el Postgres
   > limpio de CI, donde nuestra propia migración es dueña de ese
   > esquema — pero en Supabase real, `auth` pertenece a `supabase_admin`
   > y el rol `postgres` con el que te conectas solo tiene `USAGE`, no
   > `CREATE`. La migración 0001 fallaba con *"permission denied for
   > schema auth"* antes de llegar siquiera al hook. Se movieron todas a
   > un esquema propio, `rls`, que si es nuestro.

**Cómo saber que quedó bien:** entra con un usuario y abre `/perfil`. Si
ves tu rol y tus permisos, el claim llegó. Si recibes un 404, no llegó.

---

## 2. Darte de alta a ti como proveedor

Tú necesitas ver `/control`; el cliente no debe poder ni sospechar que
existe (`requireProvider()` devuelve 404, no 403).

```sql
insert into regb.provider_users (user_id, full_name, role, is_active)
values ('<tu-user-id-de-supabase>', 'Randy Grullón', 'owner', true);
```

Cierra sesión y vuelve a entrar: los claims se calculan al emitir el token,
no al vuelo.

---

## 3. Crear el cliente

**Sin SQL.** En `/control` o en `/control/onboarding`, botón **Dar de alta
un cliente** (`/control/onboarding/nuevo`). Es un asistente de cinco pasos:

1. **Cliente** — razón social, nombre comercial, **RNC o cédula** (se valida
   el dígito verificador al salir del campo y otra vez en la base: un RNC
   malo hace rebotar el 607 completo el día 20), identificador (se sugiere
   solo) y plan: pyme, mediano o grande.
2. **Módulos** — lo que compró. Lo que cada uno necesita entra solo (marcar
   *Conteos cíclicos* trae *Inventario*) y se avisa lo recomendado. Los
   enterprise solo se ofrecen en el plan grande; los core vienen con todo
   cliente.
3. **Operación** — la primera sucursal y el almacén del que descuenta la
   caja.
4. **Dueño** — nombre y correo.
5. **Revisar** y **Dar de alta**.

Todo en una transacción (`regb.alta_de_cliente()`, migración 0133): el
cliente con su RNC, los módulos comprados **activos** con sus
dependencias, la **empresa principal** (`is_default`, con la razón social y
el RNC: la que sale en cada comprobante y la que lee el 607), la sucursal,
el **almacén predeterminado**, los 14 roles de sistema comprobados y la
**invitación al dueño con el rol Owner** por el mecanismo de invitaciones
(0123). Si algo falla no queda nada. Se anota en la bitácora con tu
usuario.

- **Repetirlo no duplica nada.** La llave es el RNC: el mismo RNC con el
  mismo identificador dice "ya estaba dado de alta" o completa lo que
  falte (sirve también para un cliente que se creó a mano por SQL); el
  mismo RNC con otro identificador se niega y dice cuál es el cliente.
- **El enlace del dueño sale una sola vez** en el resultado: cópialo y
  mándaselo tú (WhatsApp, correo). Desde REGB Control no sale el correo:
  la función de correo trabaja con la sesión de alguien del cliente y
  todavía no hay nadie. Si lo pierdes, la tarjeta del cliente en el
  tablero tiene **Enlace nuevo para el dueño** (el anterior deja de
  servir). Vence en 7 días.

Más módulos después: desde el marketplace del cliente (solicitud → la
activas tú en `/control`).

---

## 4. Cargar sus datos

En este orden, porque cada paso depende del anterior. Lo hace el dueño
con su usuario (o tú, en la demo, con `?tenant=<identificador>&rol=Owner`):

1. **Empresa y sucursales** — ya las creó el alta: la empresa principal con
   su RNC, una sucursal y su almacén. `/empresas` y `/sucursales` solo si
   tiene más de una; una sucursal nueva no crea almacén (se crea en
   `/inventory/warehouses`).
2. **Catálogo** — `/importar`, tarjeta *Productos*, con un CSV. Prueba
   primero con 10 filas: si esas quedan bien, el resto también. Carga el
   **código de barras** (columna `codigo de barras`, `ean` o `barcode`),
   que es lo que hace que el lector sirva: formatea esa columna como
   *Texto* en Excel o un código largo sale como `7.46E+12` (se rechaza).
3. **El ITBIS, en el mismo CSV** — columna `itbis` con `18%`, `16%`, `0` o
   `exento`, o una columna `exento` con si/no. Arroz, habichuela y plátano
   van exentos. Vacío = la tasa por defecto de la empresa. Una tasa que no
   existe (`12%`) se rechaza en su fila. Un impuesto mal puesto no se nota
   vendiendo; se nota declarando.
4. **Existencias iniciales** — `/importar`, tarjeta *Existencias
   iniciales* (o desde el estado vacío de `/inventory`): un CSV con
   `codigo` (SKU o código de barras), `almacen` (vacío = el
   predeterminado), `cantidad` y `costo`. Cada fila entra como ajuste de
   entrada **con su costo**; sin costo en la fila ni en el catálogo, se
   rechaza, porque la valorización nacería mal. Un producto suelto: el
   *Ajuste manual* de `/inventory` busca por nombre, código o código de
   barras (ya no hay que pegar ningún id). Hazlo de noche o un domingo:
   cargar existencias mientras se vende garantiza que no cuadre, y el
   *Deshacer* del CSV se niega en cuanto algo se vendió.
5. **Clientes a crédito** — `/pedidos/clientes`, con sus días de crédito.
   Esos días son los que después deciden quién está en mora. Si algún
   cliente nunca debe pagar cargo por mora aunque se atrase (por relación,
   volumen o acuerdo), márcalo como exento en `/cobrar` — es un flag fijo,
   no se calcula solo.
6. **Proveedores** — `/compras/proveedores`, con su RNC y días de crédito
   que ellos te dan a ti. Sin esto no se puede crear una orden de compra.

---

## 5. Cargar los NCF de la DGII

**Es lo que no puede faltar.** Sin una secuencia vigente no emite una
factura válida. Pedirle a la DGII una autorización nueva toma días.

En `/cobrar/ncf`, registra los rangos autorizados. Como mínimo:

- **B02** consumo — lo que se lleva quien pasa por el mostrador.
- **B01** crédito fiscal — para clientes con RNC que deducen el ITBIS.

La caja avisa al abrir si no hay secuencia, el ticket impreso dice *"sin
comprobante fiscal"*, y `/control/salud` te lo muestra a ti antes de que el
cliente lo note.

---

## 6. Crear sus usuarios

El dueño ya tiene su invitación desde el alta (paso 3). Cuando entre, el
resto del equipo lo invita él desde `/usuarios`, con el mismo mecanismo.
Un usuario por persona, **nunca uno compartido**: dos personas
en el mismo usuario dejan la bitácora inservible, y la bitácora es lo que
permite deshacer un error sin discutir de memoria.

Empieza con roles estrechos. Ampliar permisos toma un minuto; explicar un
descuadre, una tarde.

Que cada quien abra `/perfil` el primer día: ahí ve exactamente qué puede
hacer, y eso te ahorra la mitad de las llamadas de la primera semana.

---

## 7. Cobrar

`/control/facturacion` genera la factura del mes y calcula la mora, pero
**el cobro no está automatizado**: `regb.payment_attempts` acepta el
proveedor `manual`, y Stripe y Azul no están conectados.

Para el primer cliente eso sobra: emites la factura, cobras por
transferencia y registras el pago. Automatizarlo antes de tener a quién
cobrarle es construir para nadie.

---

## Lo que hay que mirar cada mañana

`/control/salud`, en ese orden:

1. **NCF en riesgo** — sin comprobantes no factura hoy.
2. **Respaldos atrasados** — solo duele el día que hace falta, pero ese día
   duele entero.
3. **Eventos atascados** — la única señal de error que persiste hoy.
4. **Impersonaciones abiertas** — si quedó una abierta, alguien está viendo
   datos que no son suyos.

Y `/control` con el filtro **"solo en riesgo"**: mora, silencio de más de
14 días, salud bajo 70 o un bloqueo de onboarding.

---

## Antes de cada despliegue

```bash
pnpm gate:f0
```

Typecheck, lint, 196 pruebas contra Postgres real y tres auditorías: que no
haya secretos en código de cliente, que el core no conozca módulos, y que
los manifiestos sean válidos y sin colisión de rutas.

Si tocas la base, además:

```bash
pnpm db:limpiar-pruebas
```

Lista los tenants que dejan las pruebas cuando el proceso muere a media, y
solo los borra con `--si`.

---

## Lo que va a fallar primero, y qué hacer

| Síntoma | Causa casi siempre | Dónde |
|---|---|---|
| «No me deja» | Un permiso que su rol no tiene | `/perfil`, sección *Qué puedes hacer* |
| El ticket sale sin NCF | No hay secuencia cargada o se agotó | `/cobrar/ncf` |
| El inventario no cuadra | Se cargaron existencias mientras se vendía | `/inventory/movements` para ver qué pasó; corregir con un ajuste en `/inventory` (el movimiento contrario), nunca editando |
| La caja no ofrece "Abrir turno" | No hay almacén (una sucursal nueva no lo crea) o el cliente no tiene el módulo de existencias | `/pos` ya lo dice con esa causa y enlaza a `/inventory/warehouses` o al marketplace |
| El 607 rebota | Un RNC con el dígito mal | `/pedidos/clientes` — ahora se valida al guardar |
| La caja no cuadra | Vuelto mal dado o precio desactualizado | `/pos/shifts` — mirar el arqueo con el nombre del cajero |
| El cliente entra a un 404 | Su rol no tiene la ruta de inicio | ya resuelto: aterriza en la primera pantalla que sí puede abrir |
| No aparece el botón de cargo por mora | El cliente está marcado exento, la factura no tiene días de atraso, o está anulada | `/cobrar` — sección *Clientes exentos de mora* |

---

## Encender el bus de eventos

Los módulos se avisan entre sí por un outbox: el evento se escribe en la
**misma transacción** que el dato, así que si la venta se guarda su evento
existe, y si la transacción falla tampoco hay evento.

Alguien tiene que vaciarlo. Añade a `.env.local`:

```bash
REGB_CRON_SECRET=<algo largo y aleatorio>
```

Y llama cada pocos minutos:

```bash
curl -X POST https://tu-erp/api/eventos/despachar -H "authorization: Bearer $REGB_CRON_SECRET"
```

Con Vercel Cron, un `cron` en el servidor o la Edge Function, da igual.
**Sin ese secreto, en producción el endpoint devuelve 503 y no despacha
nada** — mejor que quede parado y visible que abierto a cualquiera.

Se puede disparar a mano desde `/control/salud` → *Despachar ahora* cuando
quieras ver el efecto sin esperar al reloj.

La entrega es *at-least-once*: un evento puede procesarse dos veces si el
proceso muere en mal momento. Por eso los handlers son idempotentes y nada
crítico cuelga del bus — la reserva de stock es síncrona a propósito.

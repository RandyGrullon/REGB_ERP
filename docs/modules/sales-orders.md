# `sales-orders` — Pedidos

**Qué resuelve:** vender a crédito sin perder el hilo. Del pedido a la
entrega, con el stock apartado desde que se confirma.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## La decisión más delicada: dónde viven los clientes

`ar` puede funcionar **sin** `sales-orders` — un tenant que factura servicios
no usa pedidos. Si `customers` estuviera cerrada tras
`rls.module_active('sales-orders')`, ese tenant vería **cero clientes** y `ar`
quedaría inservible.

Por eso **`public.customers` es tabla de patrón core**: RLS
`tenant_id = rls.tenant_id()` **sin** chequeo de módulo, igual que
`companies`, `branches` o `roles`. Su pantalla vive en `sales-orders` por ser
el primero que la necesita, pero el dato es transversal.

Es una prueba concreta de que el split core/gated funciona: apaga `ar` y
`customer_invoices` da cero filas, mientras `customers` sigue visible.

## Esquema

Migración [`0020_sales_orders.sql`](../../supabase/migrations/0020_sales_orders.sql).

| Tabla | Notas |
|---|---|
| `customers` | Con `credit_limit` y `payment_terms`. RLS core, sin gate de módulo. El límite lo fija `ar.credit.manage` y se usa al confirmar (0130) — ver [ar.md](ar.md#crédito-límite-y-bloqueo-por-vencidas-0130) |
| `sales_orders` | Estados: `draft`, `confirmed`, `partially_delivered`, `delivered`, `cancelled` |
| `sales_order_lines` | `qty_ordered`, `qty_reserved`, `qty_delivered` — las tres, siempre |

**Numeración:** `public.next_sales_order_number()` sobre
`document_counters(tenant, doc_type, year)` → `PV-2026-00001`. **Jamás**
`regb.next_invoice_number()`, que numera las facturas de REGB al tenant y no
las del tenant a sus clientes.

## Reservar no es entregar

Es la regla que más se malinterpreta y la que evita vender dos veces el mismo
saco de cemento:

| Acción | `qty_on_hand` | `qty_reserved` |
|---|---|---|
| Confirmar | sin cambio | **sube** |
| Entregar | **baja** | baja |

Lo apartado sigue físicamente en el almacén, pero ya tiene dueño.
**Disponible = físico − apartado**, y es lo único que se puede prometer.

### Por qué la reserva es síncrona y no por eventos

Confirmar incrementa `stock_levels.qty_reserved` con `select ... for update`
dentro del **mismo** `asUser`. No pasa por el bus de eventos: el outbox es
*at-least-once* y eventualmente consistente, demasiado débil para garantizar
que dos vendedores no comprometan la misma unidad.

Es SQL cruzando módulos, no un `import` de TypeScript — no viola la regla de
que un módulo nunca importa a otro.

`inventory` es `recommends`, no `requires`: si no está activo se omite el
chequeo y el pedido funciona igual. Degradación elegante, no error.

## Backorder

Si pides 25 y hay 20, se apartan 20 y **5 quedan en backorder**. El pedido no
se rechaza: te dice exactamente cuánto falta. La lógica está en
[`fulfillment.ts`](../../packages/operations/src/fulfillment.ts) con **20
tests**, incluido el estado del pedido derivado de sus líneas.

Verificado en navegador: 20 en existencia, pedido de 25 → reserva 20,
backorder 5; entregar 12 deja físico 8 / apartado 8; el kardex muestra los 4
movimientos.

> 🐞 **Confirmado sin existencia volvía a borrador** (hallazgo 18). El estado
> se deducía de "hay algo apartado": con 0 disponible el pedido quedaba en
> `draft` mientras el aviso decía "quedó hecho". Confirmar es una decisión,
> no una cantidad: `deriveOrderStatus(lineas, cancelado, confirmado)` y
> quien confirma pasa `true`. Ahora queda `confirmed` con todo en backorder.

## Crédito al confirmar (0130)

Antes de apartar, `confirmarPedido()` mira el crédito del cliente con la
misma función que usa facturar ([`lib/credito.ts`](../../apps/web/src/lib/credito.ts)):
límite (saldo pendiente + este pedido) y facturas vencidas hace más de N
días (30 por defecto, configurable en `/cobrar/cartera`). Bloqueado, no se
confirma ni se aparta nada, y el aviso dice cuánto, desde cuándo y qué
facturas. La ficha del pedido enseña el bloqueo **antes** de pulsar, y a
quien tiene `ar.credit.override` le ofrece "Confirmar con excepción" con un
motivo obligatorio que queda en `credit_overrides` y en la bitácora. Sin
`ar` activo la cartera es invisible (RLS) y el pedido funciona como antes.
Detalle, roles y decisión de los 30 días: [ar.md](ar.md#crédito-límite-y-bloqueo-por-vencidas-0130).

## Cancelar (0130)

- **Entregado completo: no se cancela.** La mercancía ya salió; si vuelve,
  es una nota de crédito sobre la factura. Antes se podía, y un pedido
  entregado y facturado quedaba "cancelado" con su factura viva.
- **Entregado a medias:** se cancela **lo pendiente** (el botón lo dice) y
  se devuelve lo apartado. Lo entregado **sigue en "sin facturar"** hasta
  que se facture: cancelar no puede ser la forma de regalar lo que salió.

## Se factura lo entregado (0130)

La factura sale de lo **entregado y no facturado**, por línea, con sus
propias líneas (`customer_invoice_lines`): un pedido de 10 con 4 entregados
se factura por 4, y las otras 6 en otra factura cuando salgan. Antes se
facturaba el pedido entero. La ficha del pedido lista sus facturas.

## La lista de precios asignada al cliente (0130)

`customers.price_list_id` (asignada en `/listas-precio`) se guardaba y el
pedido la ignoraba: `listaAplicable()` solo miraba listas de alcance
"cliente". Ahora la **asignada gana a todo** si está vigente
(`assignedListId` en [`price-lists.ts`](../../packages/operations/src/price-lists.ts));
vencida o inactiva, se resuelve como antes. `agregarLinea` la usa
(`usarListaAsignada: true` en `lib/precio.ts`). **La caja todavía no:**
el terminal POS calcula el precio también en el navegador y cobra lo que
enseña; si el servidor usara la asignada y el terminal no, la venta se
rechazaría por "los pagos suman X". Pendiente para el dueño de `pos`:
pasarle `price_list_id` del cliente a `PosTerminal` y activar la opción en
`cobrarVenta`.

## Pantallas

| Ruta | Permiso |
|---|---|
| `/pedidos` | `sales-orders.view` |
| `/pedidos/clientes` | `sales-orders.customers.manage` — lista con días y límite; el nombre abre la ficha |
| `/pedidos/clientes/:id` | `sales-orders.customers.manage` — **ficha del cliente** (0130): corregir datos (RNC, días, contacto, dirección) y, con `ar.credit.manage`, el límite; su crédito con las mismas cifras que decide un pedido; facturas con saldo; excepciones autorizadas (quién, cuándo, por qué); últimos pedidos |
| `/pedidos/:id` | `sales-orders.view` — confirmar (o confirmar con excepción) / entregar total o parcial / cancelar lo pendiente; estado de crédito del cliente en borrador; facturas del pedido |

`sales-orders.discount` se comprueba aparte: el Vendedor levanta pedidos pero
no descuenta.

**El RNC del cliente se valida al guardar** (módulo 11 para RNC, Luhn para
cédula). Un dígito mal tecleado no se nota hasta el día 20, cuando el 607
rebota entero. Es opcional: un consumidor final no tiene RNC.

> 🐞 **El cliente no se podía editar** (hallazgo 3). Un RNC mal digitado se
> quedaba así, y con él cada factura salía en B02 sin avisar. Ahora
> `editarCliente()` lo corrige (con la misma validación); las facturas ya
> emitidas no cambian (`buyer_tax_id` se congeló al emitir). La ficha
> marca "RNC inválido" a los que ya estaban mal, y facturar a uno de ellos
> da un error que lo dice en vez de B02 silencioso.

Toda acción de pedidos pasa por `sinExcepciones()`: un error de la base
(uuid mal formado, RLS, índice único) llega como aviso, no como pantalla
rota. `quitarLinea` y `entregarLinea` filtran además por `order_id`.

## Manifiesto

- **Permisos:** `view`, `create`, `edit`, `confirm`, `deliver`, `cancel`,
  `discount`, `customers.manage`
- **Widgets:** `pending-orders`, `top-customers`
- **Reportes:** `sales-by-customer`, `backorder-list`
- **Emite:** `order.confirmed`, `order.delivered`, `order.cancelled`
- **Requiere:** `products` · **Recomienda:** `inventory`, `contacts`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/sales-orders.test.ts` — 25 casos: aislamiento, `customers` como tabla core, módulo apagado, numeración concurrente sin huecos, restricciones |
| 3 | Lógica pura con cobertura | ✅ `fulfillment.ts` 20 tests · **100%** de líneas; `credito.test.ts` cubre confirmado sin existencia y la lista asignada |
| 3b | Acciones reales (0130) | ✅ `pedidos/credito.accion.test.ts` 13 (96 días vencida → bloqueado; vendedor y Contador no se autorizan; sin motivo no; con la del dueño pasa y queda en `credit_overrides` + `audit.log` + evento; días configurables; `ar` apagado; límite con saldo y con pedidos sin facturar) y `pedidos/pedidos.accion.test.ts` 10 (sin existencia queda confirmado; no se cancela lo entregado ni lo facturado; a medias se cancela el resto y lo entregado se factura; lista asignada; ficha: corregir RNC, límite solo con permiso) |
| 4 | UI web responsive | ✅ |
| 5 | UI móvil | 🔜 F5 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ `f4.pedidos`, 6 pasos |
| 8 | Datos demo | ✅ incluye un pedido con backorder |
| 9 | ≥2 widgets | ✅ |
| 10 | Eventos documentados | ✅ |
| 11 | Precio en 3 tiers | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ |
| 14 | Accesibilidad AA | ✅ 29 pantallas sin fallos automatizables — sin controles anónimos, jerarquía de encabezados correcta, landmarks y contraste (ver [README](README.md#accesibilidad)) |

## Lo que NO hace

- **La factura no se crea por evento.** `order.delivered` solo enciende un
  aviso de "pendiente de facturar"; crear la factura es una acción explícita.
  Entrega *at-least-once* + creación automática = facturas duplicadas el día
  que algo se reintenta.
- **Cotizaciones** y aprobación por monto: no están en F4.
- **Volver a apartar** un pedido confirmado cuando entra mercancía: lo que
  quedó en backorder se entrega igual (el stock puede quedar negativo, a
  propósito), pero no se re-reserva solo.
- **Entregas parciales con estado "en tránsito"**: eso es `transfers` (#50, F8).

## Pendiente (al cierre de 0130, 23 sep 2026)

1. **La caja no usa la lista asignada al cliente**: falta pasar
   `customers.price_list_id` a `PosTerminal` y `usarListaAsignada: true` en
   `cobrarVenta` (dueño: `pos`). Mientras tanto la caja cobra lo que enseña,
   sin la asignada, y no se rompe.
2. **`regb_test` sin la 0130**: la ficha del cliente (`/pedidos/clientes/:id`)
   y el estado de crédito de `/pedidos/:id` dan error en el servidor de
   vista previa hasta migrarla. Verificadas con render en servidor contra
   `regb_credito` (0001–0135 + seed), no con clics en la app.
3. **Seed:** los dos clientes SRL de la demo tienen el RNC inválido; la
   ficha los marca "RNC inválido" y hay que corregirlos ahí (o en el seed).
4. **Tour `f4.pedidos`** no enseña el bloqueo de crédito ni la ficha del
   cliente.
5. **Re-reservar** lo que quedó en backorder cuando entra mercancía.

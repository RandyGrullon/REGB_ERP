# `sales-orders` — Pedidos

**Qué resuelve:** vender a crédito sin perder el hilo. Del pedido a la
entrega, con el stock apartado desde que se confirma.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## La decisión más delicada: dónde viven los clientes

`ar` puede funcionar **sin** `sales-orders` — un tenant que factura servicios
no usa pedidos. Si `customers` estuviera cerrada tras
`auth.module_active('sales-orders')`, ese tenant vería **cero clientes** y `ar`
quedaría inservible.

Por eso **`public.customers` es tabla de patrón core**: RLS
`tenant_id = auth.tenant_id()` **sin** chequeo de módulo, igual que
`companies`, `branches` o `roles`. Su pantalla vive en `sales-orders` por ser
el primero que la necesita, pero el dato es transversal.

Es una prueba concreta de que el split core/gated funciona: apaga `ar` y
`customer_invoices` da cero filas, mientras `customers` sigue visible.

## Esquema

Migración [`0020_sales_orders.sql`](../../supabase/migrations/0020_sales_orders.sql).

| Tabla | Notas |
|---|---|
| `customers` | Con `credit_limit` y `payment_terms`. RLS core, sin gate de módulo |
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

## Pantallas

| Ruta | Permiso |
|---|---|
| `/pedidos` | `sales-orders.view` |
| `/pedidos/clientes` | `sales-orders.customers.manage` |
| `/pedidos/:id` | `sales-orders.view` — confirmar / entregar total o parcial / cancelar |

`sales-orders.discount` se comprueba aparte: el Vendedor levanta pedidos pero
no descuenta.

**El RNC del cliente se valida al guardar** (módulo 11 para RNC, Luhn para
cédula). Un dígito mal tecleado no se nota hasta el día 20, cuando el 607
rebota entero. Es opcional: un consumidor final no tiene RNC.

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
| 3 | Lógica pura con cobertura | ✅ `fulfillment.ts` 20 tests · **100%** de líneas |
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
| 14 | Accesibilidad AA | ⚠️ sin auditar |

## Lo que NO hace

- **La factura no se crea por evento.** `order.delivered` solo enciende un
  aviso de "pendiente de facturar"; crear la factura es una acción explícita.
  Entrega *at-least-once* + creación automática = facturas duplicadas el día
  que algo se reintenta.
- **Cotizaciones** y aprobación por monto: no están en F4.
- **Entregas parciales con estado "en tránsito"**: eso es `transfers` (#50, F8).

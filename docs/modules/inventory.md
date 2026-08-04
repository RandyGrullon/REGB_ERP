# `inventory` — Existencias

**Qué resuelve:** cuánto tienes, cuánto vale y **por qué cambió**. Es el
corazón de F4 y el módulo donde un error no se nota hasta que ya costó dinero.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## El principio: un libro, no un contador

`inventory_movements` es un **kardex append-only**. Recibe políticas RLS de
`select` e `insert` y **ninguna de `update` ni `delete`**: con
`force row level security`, la ausencia de política niega la operación.

Corregir un error es hacer el **movimiento contrario**, y quedan los dos. Eso
es exactamente lo que hace que un conteo sea defendible ante un auditor: la
historia no se reescribe.

> ⚠️ **Para quien audite la RLS:** la ausencia de `update`/`delete` en esta
> tabla es deliberada. No la "arregles" a `for all`.

`stock_levels` es una **proyección** mantenida por trigger en la misma
transacción del movimiento, así que no puede desincronizarse. Nunca se escribe
a mano.

## Esquema

Migración [`0019_inventory.sql`](../../supabase/migrations/0019_inventory.sql).

| Tabla | Rol |
|---|---|
| `warehouses` | Almacén, con `branch_id` nullable. Único parcial: un solo `is_default` por tenant |
| `inventory_movements` | Kardex inmutable. `qty <> 0`, índices por producto+fecha y por referencia |
| `stock_levels` | Proyección `(tenant, almacén, producto)` con `qty_on_hand`, `qty_reserved`, `avg_cost` |
| `stock_counts` / `_lines` | Conteo cíclico con `system_qty` fotografiado al abrir |
| `stock_transfers` / `_lines` | Traslado de un paso, sin estado "en tránsito" |

### Por qué `warehouses` y no reutilizar `branches`

El propio documento maestro describe `transfers` (#50, F8) como *"entre
almacenes **y** sucursales"* — los trata como conceptos distintos más adelante.
Colgar hoy el stock de `branch_id` obligaría a migrar **todo el histórico de
movimientos** cuando lleguen los almacenes de verdad. Añadir la tabla ahora es
barato; el retrofit después no lo es.

En el alta se crea un almacén por sucursal, así el caso común —un solo
almacén— queda igual de simple.

## Costeo: promedio ponderado

```
nuevo_promedio = (on_hand · avg_cost + qty · unit_cost) / (on_hand + qty)
```

Solo las entradas mueven el promedio; las salidas consumen al vigente.

**No es FIFO** a propósito: el FIFO real exige capas de lotes, que es
exactamente lo que construye `lots-serials` (#49) en F8. Media implementación
ahora sería una tabla desechable. Además es lo que usa el comercio dominicano
pequeño y lo que su contador espera.

Vive en [`packages/operations/src/costing.ts`](../../packages/operations/src/costing.ts)
con **20 tests**.

## La trampa que subvaloró el inventario

Cargar existencias iniciales **sin costo** promediaba contra un montón
fantasma a costo cero: 100 unidades sin costo + 50 a RD$195 daba un promedio
de **RD$65 en vez de RD$185**.

La regla del motor era correcta —una entrada sin costo no debe mover el
promedio, eso es una devolución— y el fallo estaba en la frontera: la acción
no declaraba el costo. Se corrigió ahí, heredando el costo del catálogo
cuando no se declara, y quedó un test que lo fija.

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/inventory` | `inventory.view` | Existencias por almacén, semáforo, valor total, badge de sobre-apartado |
| `/inventory/movements` | `inventory.view` | Kardex + registro de ajuste |
| `/inventory/counts` | `inventory.count` | Conteo cíclico |
| `/inventory/transfers` | `inventory.transfer` | Traslado entre almacenes |
| `/inventory/warehouses` | `inventory.warehouses.manage` | Alta de almacenes (oculta del menú) |

**Aprobación de ajustes:** el mockup del marketplace promete *"ajustes sobre
$10,000 requieren aprobación"*. Se usa el `max_amount` del scope de rol que
**ya existe** en `@regb/permissions` — no se inventó mecanismo nuevo. Se
verifica en la acción de servidor, no en el botón.

`inventory.cost.view` en falso (Almacenista) oculta costo y valorización.

## Manifiesto

- **Permisos:** `view`, `adjust`, `transfer`, `count`, `cost.view`,
  `warehouses.manage`, `export`
- **Widgets:** `stock-alerts`, `inventory-value`
- **Emite:** `inventory.stock.low`, `inventory.movement.created`
- **Escucha:** `sales-orders.order.confirmed`, `purchase-orders.receipt.posted`
- **Requiere:** `products` · **Recomienda:** `purchase-orders`

> 🐞 El manifiesto escuchaba `sales.order.confirmed`. El módulo es
> `sales-orders`, así que el evento real lleva guion y **ese listener nunca
> habría disparado**. Corregido; el comentario en el manifiesto explica la
> regla para que no vuelva a pasar.

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/inventory.test.ts` — 14 casos: inmutabilidad del kardex, invariante proyección == suma, aislamiento, módulo apagado. Sin `down` (deuda común) |
| 3 | Lógica pura con cobertura | ✅ `costing.ts` 20 tests · **100%** de líneas |
| 4 | UI web responsive | ✅ |
| 5 | UI móvil | 🔜 F5 — `mobileScope`: view, count, transfer |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ `f4.inventario`, 6 pasos |
| 8 | Datos demo | ✅ |
| 9 | ≥2 widgets | ✅ |
| 10 | Eventos documentados | ✅ |
| 11 | Precio en 3 tiers | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ |
| 14 | Accesibilidad AA | ⚠️ sin auditar |

## Problema conocido, no escondido

**El POS puede vender stock ya apartado a un pedido confirmado.** El terminal
avisa mostrando 0 disponible, pero un mostrador no se traba por un contador:
si el cliente tiene el producto en la mano, la venta ocurre.

La consecuencia se hace **visible** con un badge de *sobre-apartado* en
Existencias, para que el almacenista sepa que una promesa de entrega quedó
sin respaldo. Resolverlo de verdad es una política de negocio (¿se prioriza
el pedido o el mostrador?), y eso lo decide un piloto, no el código.

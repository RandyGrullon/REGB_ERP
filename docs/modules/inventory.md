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

El alta de un cliente desde REGB Control (`/control/onboarding/nuevo`,
0133) crea su primera sucursal **y un almacén predeterminado** colgado de
ella, así el caso común —un solo almacén— queda igual de simple y la caja
puede abrir turno desde el primer día. Una sucursal que se abra después
**no** crea almacén: se crea en `/inventory/warehouses`. Sin almacén, `/pos`
ya no culpa al rol: dice que falta el almacén y enlaza a esa pantalla (o
al Marketplace si el cliente no tiene este módulo, porque sin él la RLS
esconde los almacenes).

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

## Existencias iniciales

Dos caminos, los dos con costo:

- **Todo el catálogo de una vez: CSV** en `/importar#existencias` (código,
  almacén, cantidad, costo unitario). Cada fila buena es un
  `adjustment_in` con costo y `reference_type = 'import_batch'`; un
  producto que ya tiene existencia en ese almacén se deja; sin costo en la
  fila ni en el catálogo, la fila se rechaza. Deshacer registra el
  movimiento contrario (el kardex no se borra) y se niega si algo movió
  esas existencias después. Detalle en [imports.md](imports.md#existencias-iniciales-target--stock-0133).
- **Uno a uno: el "Ajuste manual" de `/inventory`.** Antes pedía pegar el
  UUID del producto ("Copia el id desde el catálogo"). Ahora el campo
  *Producto* busca por **código, código de barras o nombre** (lista nativa
  del navegador, sin JavaScript, solo productos que llevan existencias).
  El servidor lo resuelve en orden: SKU o código de barras exactos; SKU o
  nombre completos sin mayúsculas; parte del nombre o del SKU entre los
  activos. Si coinciden varios, no adivina: dice cuáles. Los comodines
  (`%`, `_`) se buscan como texto. El `productId` de antes sigue sirviendo.

Hazlo antes de vender -de noche o un domingo-: una existencia cargada
mientras se vende no cuadra, y el deshacer del CSV ya no aplica.

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/inventory` | `inventory.view` | Existencias por almacén, semáforo, valor total, badge de sobre-apartado. Ajuste manual (`inventory.adjust`) con el producto por nombre, código o código de barras; enlace al CSV de existencias iniciales |
| `/inventory/movements` | `inventory.view` | Kardex, solo lectura (no tiene formulario: el ajuste está en `/inventory`) |
| `/importar#existencias` | `imports.create` + `inventory.adjust` | Existencias iniciales por CSV (módulo `imports`) |
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
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/inventory.test.ts` — 14 casos: inmutabilidad del kardex, invariante proyección == suma, aislamiento, módulo apagado. Sin `down` (deuda común). Acciones: `apps/web/src/app/inventory/inventario.accion.test.ts` — 9 casos del ajuste por SKU, código de barras, nombre completo y parcial, ambiguo, comodines, inexistente, id de siempre; existencias iniciales en `importar/existencias.accion.test.ts` (10) |
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
| 14 | Accesibilidad AA | ✅ 29 pantallas sin fallos automatizables — sin controles anónimos, jerarquía de encabezados correcta, landmarks y contraste (ver [README](README.md#accesibilidad)) |

## Problema conocido, no escondido

**El POS puede vender stock ya apartado a un pedido confirmado.** El terminal
avisa mostrando 0 disponible, pero un mostrador no se traba por un contador:
si el cliente tiene el producto en la mano, la venta ocurre.

La consecuencia se hace **visible** con un badge de *sobre-apartado* en
Existencias, para que el almacenista sepa que una promesa de entrega quedó
sin respaldo. Resolverlo de verdad es una política de negocio (¿se prioriza
el pedido o el mostrador?), y eso lo decide un piloto, no el código.

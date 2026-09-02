# `purchase-orders` — Ordenes de compra

**Qué resuelve:** pedirle al proveedor y recibir lo que llega, dejando el
costo real de entrada documentado en vez de perdido en una nota de WhatsApp.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## La decisión más delicada: confirmar no mueve inventario

Es la regla contraria a `sales-orders`, y a propósito:

| Módulo | Confirmar | Quién hace la promesa |
|---|---|---|
| `sales-orders` | **aparta** stock | nosotros al cliente |
| `purchase-orders` | no toca nada | el proveedor a nosotros |

Confirmar una orden de compra es la promesa del proveedor de que va a
entregar; hasta que no entra mercancía de verdad no hay nada que reflejar en
el kardex. El único momento que mueve inventario es **recibir**, y no hay
"reserva" que liberar si se cancela — por eso `purchase_orders` no tiene un
`qty_reserved` en ningún lado.

## Esquema

Migración [`0038_purchase_orders.sql`](../../supabase/migrations/0038_purchase_orders.sql).

| Tabla | Notas |
|---|---|
| `suppliers` | RNC, días de crédito. Tabla de un solo consumidor, mismo patrón que `customers` en 0020 hasta que exista `ap` o `suppliers` propio |
| `purchase_orders` | Estados: `draft`, `confirmed`, `partially_received`, `received`, `cancelled`. Guarda `supplier_ncf`/`supplier_ncf_date` para un futuro 606, sin usarlos todavía |
| `purchase_order_lines` | `qty_ordered`, `qty_received`, `unit_cost` (cotizado), `discount_pct` (comercial del proveedor) |

**Numeración:** `public.next_purchase_order_number()` sobre
`purchase_order_counters(tenant, year)` → `OC-2026-00001`. Escrita con la
comprobación de tenant y módulo activo **desde la primera versión** — la
0031 tuvo que retrocederle esa guarda a `sales-orders` después de encontrar
el agujero; aquí no hizo falta repetir el ciclo.

## El costo lo entra quien recibe, no el catálogo

`agregarLinea` pide el costo cotizado **a mano**, nunca lo saca de
`products.cost` — al revés que `sales-orders`, donde el precio de venta sí
sale del catálogo. La razón: el costo del catálogo es el resultado de la
**última** compra, no un dato para fijar la compra de ahora. Auto-rellenarlo
crearía una referencia circular donde cada orden confirma el precio de la
orden anterior en vez de declarar el de esta.

Al recibir, el costo real puede ser distinto al cotizado — el proveedor subió
o bajó el precio en la entrega — y el sistema no bloquea nada por eso: parar
la mercancía en el muelle por una diferencia de precio no resuelve nada. Ese
costo real es el que entra al kardex.

## Cero cambios al trigger de inventario

Recibir inserta un movimiento `'receipt'` con `unit_cost`, y
`apply_inventory_movement()` (el mismo trigger de
[`0019_inventory.sql`](../../supabase/migrations/0019_inventory.sql) que ya
usan los ajustes manuales) lo procesa igual que cualquier entrada: promedio
ponderado móvil, sin una línea de código nueva. Es la simplificación más
importante del módulo — se descubrió leyendo el trigger existente antes de
escribir nada, no al final.

## Variación de costo

[`procurement.ts`](../../packages/operations/src/procurement.ts) expone
`costVariance(cotizado, recibido)`: compara lo que se pidió contra lo que de
verdad se recibió (promedio ponderado del kardex de esa orden) y lo muestra
como un aviso en rojo o verde junto al costo cotizado — nunca bloquea la
recepción, solo avisa que el próximo pedido a ese proveedor hay que
renegociarlo.

Verificado en navegador: orden por RD$14,160 (50 unidades a RD$240
cotizados), recibidos 30 a RD$255 reales → `stock_levels.avg_cost` queda en
**255.0000** (el real, no el cotizado), la orden pasa a `partially_received`,
y la línea muestra **"+6.3% al recibir"**.

## Pantallas

| Ruta | Permiso |
|---|---|
| `/compras` | `purchase-orders.view` |
| `/compras/proveedores` | `purchase-orders.suppliers.manage` |
| `/compras/:id` | `purchase-orders.view` — confirmar / recibir total o parcial / cancelar |

## Manifiesto

- **Permisos:** `view`, `create`, `edit`, `confirm`, `receive`, `cancel`,
  `suppliers.manage`, `export`
- **Widgets:** `po-pending-receipt`, `po-top-suppliers`
- **Reportes:** `purchases-by-supplier`, `receiving-variance`
- **Emite:** `order.confirmed`, `receipt.posted`, `order.cancelled`
- **Requiere:** `products` · **Recomienda:** `inventory`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/purchase-orders.test.ts` — 23 casos: aislamiento (órdenes, proveedores, contador), módulo apagado, numeración concurrente sin huecos, restricciones de la tabla |
| 3 | Lógica pura con cobertura | ✅ `procurement.ts` 16 tests |
| 4 | UI web responsive | ✅ verificado en navegador: crear orden, agregar línea, confirmar, recibir parcial con costo distinto |
| 5 | UI móvil | 🔜 F5 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ `f4.compras`, 6 pasos |
| 8 | Datos demo | ✅ un proveedor y una orden recibida a medias con variación de costo (+3.5% real, RD$401 cotizado → RD$415 recibido) |
| 9 | ≥2 widgets | ✅ `po-pending-receipt`, `po-top-suppliers` |
| 10 | Eventos documentados | ✅ declarados en el manifest; ningún módulo los escucha todavía (`listens: []`) |
| 11 | Precio en 3 tiers | ✅ ya estaba cargado en `module_pricing` desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ 3 pantallas nuevas auditadas con `scripts/sonda-a11y.js`, cero fallos — se copiaron los patrones ya corregidos de `sales-orders` (h2 en vez de h3, `<main>` propio, `aria-label` en los filtros) |

## Lo que NO hace

- **Cuentas por pagar.** `supplier_terms` es informativo; no genera ningún
  vencimiento ni antigüedad de cartera por pagar. Es fase aparte.
- **El 606.** `supplier_ncf`/`supplier_ncf_date` se capturan desde ya para no
  tener que re-preguntarle al cliente sus facturas viejas, pero el reporte en
  sí no está construido — necesita la misma verificación rigurosa del
  formato DGII que ya se hizo para 607/608, y no se ha hecho para 606.
- **Requisiciones internas ni cotización a múltiples proveedores.** Alcance
  deliberado: aquí solo vive pedir y recibir.

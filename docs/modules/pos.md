# `pos` — Caja

**Qué resuelve:** vender al contado en el mostrador, con turno, arqueo,
lector de código de barras y ticket impreso.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## Esquema

Migración [`0022_pos.sql`](../../supabase/migrations/0022_pos.sql).

| Tabla | Notas |
|---|---|
| `pos_shifts` | Apertura/cierre, efectivo inicial, contado, esperado, diferencia. Índice único parcial: **un solo turno abierto por almacén** |
| `pos_sales` | `customer_id` opcional, anulación con motivo, `ncf` + `ncf_type` |
| `pos_sale_lines` | |
| `pos_payments` | **Varias filas por venta** = pago mixto. Indispensable para un arqueo correcto |

`public.pos_expected_cash()` calcula lo esperado en base de datos, no en la UI.

## Al contado, por decisión

El POS **no genera cuentas por cobrar**. El crédito va por
`sales-orders → factura → ar`. Un mostrador que fía sin control es como se
pierde una cartera.

Si la venta consume un pedido (`sales_order_id`), convierte la reserva en
salida en vez de descontar de nuevo. Si `inventory` no está activo, se salta
el stock: la FAQ del marketplace dice que el POS debe servir sin inventario, y
eso se respeta.

## Arqueo

```
esperado   = efectivo inicial + Σ pagos en efectivo del turno
diferencia = contado − esperado
```

Se calcula en [`cash.ts`](../../packages/operations/src/cash.ts) con **14
tests** y se muestra con el nombre del cajero. El tour insiste en contar
**antes** de mirar lo esperado: si miras primero, cuentas para que cuadre.

Verificado: turno con fondo de RD$2,000 → venta de RD$607.70 → vuelto de
RD$92.30 sobre RD$700 → efectivo esperado RD$2,607.70.

## Hardware que funciona hoy

### Lector de código de barras — sin driver

Un lector USB **es un teclado**: teclea el código y manda `Enter`. El buscador
escucha ese Enter y resuelve por código exacto → SKU exacto → resultado único.
Si no resuelve, muestra el código que llegó en vez de agregar a ciegas.

> **Detalle que importa:** el código se lee del DOM
> (`e.currentTarget.value`), no del estado de React. Un lector teclea y manda
> Enter en milisegundos, así que el estado va un render atrasado y con el
> closure viejo se leería un código a medias.

El criterio de búsqueda es **uno solo** (`coincide()`), compartido por la
rejilla y el lector: separados se desincronizan y el cajero ve un producto en
pantalla que el Enter no agrega — el fallo más confuso posible en un mostrador.

### Impresora térmica 80 mm — como impresora normal

`/pos/ticket/[id]` es una página de 80 mm con
`@page { size: 80mm auto; margin: 0 }`, fuera del shell. Lo que se ve es lo
que sale del papel. Se llega desde Cierres tocando el número del ticket.

### Lo que NO funciona en web

Gaveta de efectivo, corte automático, impresión sin diálogo e **impresora
fiscal certificada**: todas hablan un protocolo binario por puerto serial que
un navegador no puede abrir. Son **F5** (Electron). Detalle completo en
[../HARDWARE-Y-DGII.md](../HARDWARE-Y-DGII.md).

## Comprobante fiscal

Cliente con RNC → **B01** (crédito fiscal, para que pueda deducir el ITBIS).
Cliente de mostrador → **B02** (consumo).

**Sin secuencia cargada la venta no se detiene.** Un negocio recién abierto
vende antes de que la DGII le autorice el primer rango, y trancar la caja
sería peor que el ticket sin NCF. Pero no se calla:

- la caja avisa **al abrir**, no después de cobrar, cuando no hay secuencia;
- el ticket impreso dice *"sin comprobante fiscal — no válido para crédito
  fiscal"*;
- Cierres lo marca `sin NCF` en color de aviso.

**Detalle técnico:** la disponibilidad se comprueba **antes** de llamar a
`assign_ncf`, no atrapando su excepción. Si esa función lanza, Postgres aborta
la transacción entera y las líneas, el kardex y los pagos fallan detrás — un
`try/catch` de JavaScript no deshace eso. El `for update` de la comprobación es
el mismo candado que toma `assign_ncf` y dura hasta el commit, así que nadie
más puede gastar el número en el medio.

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/pos` | `pos.sell` | Terminal táctil: búsqueda/escaneo, carrito, pago |
| `/pos/shifts` | `pos.shift.open` | Abrir y cerrar turno con arqueo |
| `/pos/reports` | `pos.report.view` | Histórico de tickets, anulación, enlace al ticket |
| `/pos/ticket/:id` | `pos.report.view` | Ticket de 80 mm (oculta del menú) |

Botones ≥44 px, probado a **768 px** además de 375 y 1440: el POS es de tablet.

**Descuento con límite:** el Cajero trae `pos.discount.max: 10` en su scope. Se
verifica **en la acción de servidor**, no en el botón.

> El rol Cajero tiene `pos.sell` pero no `pos.view`, y `/pos` declara
> `pos.sell` en su manifiesto. El guard de páginas asumía `<módulo>.view` y le
> daba 404 en su propia caja. Se corrigió por los dos lados: `modulePage`
> acepta el permiso de la ruta, y la migración 0025 añadió `pos.view` al rol.

## Manifiesto

- **Permisos:** `view`, `sell`, `void`, `discount`, `shift.open`,
  `shift.close`, `report.view`
- **Widgets:** `sales-today`, `open-shifts`
- **Emite:** `pos.sale.completed`, `pos.sale.voided`, `pos.shift.closed`
- **Requiere:** `products` · **Recomienda:** `inventory`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/fiscal.test.ts` — turno único por almacén, arqueo, aislamiento de ventas, módulo apagado |
| 3 | Lógica pura con cobertura | ✅ `cash.ts` 14 tests · **100%** de líneas |
| 4 | UI web responsive | ✅ 375 / **768** / 1440 |
| 5 | UI móvil | 🔜 F5 |
| 6 | Desktop verificado | 🔜 F5 — aquí llegan offline, gaveta e impresión directa |
| 7 | Tour ≥6 pasos | ✅ `f4.caja`, 7 pasos |
| 8 | Datos demo | ✅ turno cerrado con diferencia |
| 9 | ≥2 widgets | ✅ |
| 10 | Eventos documentados | ✅ |
| 11 | Precio en 3 tiers | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ |
| 14 | Accesibilidad AA | ⚠️ sin auditar |

## Ficha del marketplace corregida

La ficha de 0013 vendía *"vende sin internet"* e *"impresora térmica"* como si
fueran de F4. La primera es Electron y la segunda solo funciona con el diálogo
de impresión. Se corrigió el texto para que digan **"en la app de escritorio"**:
un cliente que compra por esa ficha y no lo encuentra es justo la fricción que
mata la puerta F4.

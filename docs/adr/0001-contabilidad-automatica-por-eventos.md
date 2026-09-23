# ADR 0001 — Los asientos contables se generan escuchando eventos

**Fecha:** 23 sep 2026 · **Módulos:** `accounting` (escucha), `pos`, `ar`, `ap` (emiten) ·
**Migración:** [`0131_contabilidad_automatica.sql`](../../supabase/migrations/0131_contabilidad_automatica.sql)

## Contexto

Ninguna operación generaba un asiento. `journal_entries.source_type` solo
admitía `'manual'` (0041) y los cuatro handlers del despachador solo mandaban
avisos. Una distribuidora con RD$61K por cobrar y RD$43K por pagar tenía cero
asientos; la balanza mostraba una venta de demo (hallazgo 5 del análisis de
flujo del 23 sep 2026). El tour de contabilidad ya prometía "vender, comprar,
pagar y cobrar generan su asiento".

Restricciones del proyecto que pesan aquí:

- **§2.2 / principio 3:** los módulos se hablan por eventos, no por imports.
  Caja, cartera y compras no pueden conocer a contabilidad.
- **Principio 7:** sin `accounting` activo, vender y cobrar tienen que seguir
  funcionando igual.
- El outbox (0003/0007) entrega **at-least-once**: todo handler tiene que ser
  idempotente.
- Un asiento contabilizado es inmutable (0041): lo que se escribe mal no se
  arregla editando.

## Opciones

| | Opción | A favor | En contra |
|---|---|---|---|
| A | Cada acción (cobrar venta, facturar, pagar) inserta su asiento en su propia transacción | Síncrono, sin despachador | Caja y cartera importan contabilidad (§2.2 roto). Un mapa de cuentas mal configurado **tumba la venta**. Toca acciones que tienen otro dueño. |
| B | Triggers de base en `pos_sales`, `customer_invoices`... que escriben el asiento | Atómico con el dato | La regla contable vive en PL/pgSQL, sin pruebas unitarias. Mismo acoplamiento que A, escondido en SQL. Un error en el trigger revierte la venta. |
| **C** | **Contabilidad escucha eventos del outbox y escribe su asiento** | Módulos desacoplados; la venta nunca falla por contabilidad; reintentos y cola muerta gratis | Asíncrono: el asiento llega segundos o minutos después. Exige idempotencia y una forma de leer el documento de origen. |

**Recomendación y decisión: C.**

## Decisión

```mermaid
sequenceDiagram
  participant Accion as Acción (pos/ar/ap)
  participant BD as Postgres
  participant Outbox as event_outbox
  participant Desp as despachar()
  participant Reglas as @regb/operations<br/>asientos.ts
  participant Fn as registrar_asiento_automatico()
  Accion->>BD: venta / factura / cobro (una transacción)
  BD->>Outbox: emit_event() o trigger AFTER (misma transacción)
  Desp->>Outbox: claim_events()
  Desp->>BD: lee el documento de origen por id
  Desp->>Reglas: líneas por PROPÓSITO (caja, cxc, ventas…)
  Desp->>Fn: tenant, origen, fecha, líneas
  Fn->>BD: mapa del cliente → cuentas; asiento 'posted'
  Desp->>Outbox: settle_event(ok) — o reintento con espera
```

1. **Quién decide qué.** `packages/operations/src/asientos.ts` (lógica pura,
   con pruebas unitarias) dice qué se debita y qué se acredita, por
   **propósito** (`caja`, `banco`, `cxc`, `ventas`, `itbis_por_pagar`…). No
   conoce cuentas ni ids.
2. **Mapa por cliente.** `accounting_account_map` traduce cada propósito a una
   cuenta del catálogo de ese cliente, con el tipo que exige (un trigger impide
   mapear "Bancos" a una cuenta de ingreso). No había plantilla dominicana en el
   repo: `cuentas_contables_por_defecto()` trae un catálogo mínimo (14 usos, 13
   cuentas, códigos alineados con la demo) que se crea solo la primera vez.
3. **Una sola puerta de escritura.** `registrar_asiento_automatico()`
   (`security definer`, **sin** grant a `authenticated`: un usuario no puede
   fabricar asientos "automáticos") inserta el asiento y lo contabiliza en una
   transacción.
   - **Idempotente:** índice único `(tenant_id, source_type, source_id)` +
     candado consultivo por origen. El segundo intento devuelve el asiento que
     ya existe.
   - **Cuadrado:** `exigir_partida_doble()` impide pasar a `posted` un asiento
     con menos de dos líneas o descuadrado —por cualquier camino, no solo por
     esta función— y que un asiento nazca `posted`.
   - **Degradación elegante:** sin `accounting` activo devuelve `null` y el
     evento se da por atendido.
4. **Reversos, no ediciones.** Anular una venta, una factura o reversar un
   cobro genera el asiento inverso con **las mismas cuentas** del original
   (aunque el mapa haya cambiado después). El reverso se asegura antes de que
   el original exista: el orden de llegada de los eventos no importa.
5. **Eventos que faltaban, emitidos desde la tabla.** Ticket anulado
   (`pos.sale.voided`, declarado y nunca emitido), cada cobro y cada pago
   (`ar.payment.received`, `ap.payment.recorded`; `*.invoice.paid` solo salía
   al saldar), facturas anuladas y cargos por mora se emiten con un trigger
   `AFTER` en la misma transacción del cambio. No se tocan las acciones de otros
   módulos, y cubre todo camino que escriba la fila (móvil, importación).

| Evento | Asiento (`source_type`) | Débito | Crédito |
|---|---|---|---|
| `pos.sale.completed` | `pos_sale` | Caja / Banco (según pago) · Costo de ventas | Ventas (total − ITBIS) · ITBIS por pagar · Inventario |
| `pos.sale.voided` | `pos_sale_void` | inverso exacto del anterior | |
| `ar.invoice.issued` | `ar_invoice` | CxC (total) | Ventas · ITBIS por pagar |
| `ar.invoice.voided` | `ar_invoice_void` | inverso | |
| `ar.payment.received` | `ar_payment` | Caja / Banco | CxC |
| `ar.payment.reversed` | `ar_payment_reversal` | inverso del cobro | |
| `ar.credit-note.issued` | `ar_credit_note` | Ventas · ITBIS por pagar | CxC |
| `ar.late-fee.applied` | `ar_late_fee` | CxC | Recargos por mora |
| `ap.invoice.recorded` | `ap_invoice` | Compras (606 tipo 09 o sin clasificar) o Gastos · ITBIS adelantado | CxP (total − retención) · ITBIS retenido · ISR retenido |
| `ap.invoice.voided` | `ap_invoice_void` | inverso | |
| `ap.payment.recorded` | `ap_payment` | CxP | Caja / Banco |

## Estado

Aceptada e implementada (0131). Pruebas: `packages/operations/src/asientos.test.ts`
(reglas) y `apps/web/src/app/contabilidad/contabilidad-automatica.accion.test.ts`
(acciones reales + despachador real: exactitud, idempotencia, reversos, cliente
sin `accounting`, reintento con mapa roto, aislamiento del mapa).

## Consecuencias

- **El asiento es asíncrono.** Llega cuando corre el despachador. Hoy corre
  desde el botón de `/control/salud`: **hace falta un cron** (pendiente de
  infraestructura) para que "casi en tiempo real" sea verdad en producción.
- **Un mapa roto no pierde asientos.** El evento falla con un mensaje legible
  ("La cuenta 1103 Bancos está desactivada…"), se reintenta con la espera del
  despachador (1, 4, 9, 16, 25 min) y sale solo cuando se corrige. Tras 5
  intentos va a la cola muerta de `/control/salud`.
- **El costo de venta de caja es el promedio al contabilizar**, no al vender:
  el kardex no guarda el costo de las salidas (0019). Con el despachador al día
  es el mismo; si una compra entra entre la venta y el despacho, lo mueve.
- **La venta a crédito no asienta costo de venta todavía** (la mercancía sale
  en la entrega de `sales-orders`, que no emite costo). Tampoco las recepciones
  de compra ni las devoluciones al proveedor generan asiento: el inventario del
  mayor sube con la factura del proveedor y baja con el costo de las ventas de
  caja.
- **Reclasificar después no re-asienta.** Si alguien cambia el tipo de gasto
  606 de una factura de proveedor ya contabilizada, el asiento no cambia: se
  corrige con un asiento manual.
- **Histórico:** lo anterior a 0131 no se contabiliza solo (no hubo eventos).
  Un cobro nuevo de una factura vieja sí asienta primero la factura, para que
  la cartera del mayor nunca quede negativa.

### Qué se rompe si cambiamos de opinión

- **Pasar a síncrono (opción A)** obliga a mover `registrar_asiento_automatico()`
  dentro de cada acción y aceptar que un error contable revierta la venta. Los
  asientos ya escritos siguen valiendo (misma clave única por origen).
- **Cambiar el formato de un payload** no rompe nada mientras siga trayendo el
  id del documento: los handlers leen el documento, no el payload.
- **Quitar un trigger emisor** (por ejemplo, porque la acción de `ar` empiece a
  emitir `ar.payment.received` ella misma) es seguro: un evento duplicado no
  duplica el asiento.

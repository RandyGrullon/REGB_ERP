# `ap` — Cuentas por pagar

**Qué resuelve:** facturas de proveedor, pagos y retenciones. El
contraparte de `ar`, con la flecha al revés: aquí el proveedor nos factura
a **nosotros**.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## Reusa `ar` sin duplicar una línea

`deriveInvoiceStatus`, `balanceAfter`, `overpayment` y `dueDateFrom` en
[`receivables.ts`](../../packages/operations/src/receivables.ts) /
[`documents.ts`](../../packages/operations/src/documents.ts) ya eran
genéricos — no asumían nada específico de cobrar. `ap` los reusa tal
cual: la fórmula de "saldo tras pagos" es la misma sin importar quién le
debe a quién. Este módulo no tiene su propio archivo de lógica pura porque
no le hacía falta ninguna función nueva.

## Sin numeración propia

Al revés que `ar` (que emite `FA-2026-00001`, un número **nuestro**),
aquí el número de factura es el del **proveedor**
(`supplier_invoice_number`) — no algo que generamos. La unicidad es por
`(tenant_id, supplier_id, supplier_invoice_number)`: dos proveedores
distintos pueden repetir "001" sin problema, pero el mismo proveedor no
puede repetirse a sí mismo.

## Retención — se captura, no se calcula

Igual que el cargo por mora en `ar` (0040): no hay una fórmula fija de
cuándo aplica una retención ni de cuánto es. `retention_amount` es un
campo que se escribe a mano al registrar la factura, y reduce lo que se
le paga al proveedor exactamente como si fuera un pago más — esa parte,
en la práctica, se le paga a la DGII en su lugar, no al proveedor.

`ap_invoice_balance(id)` = `total - retention_amount - pagado`, derivado
siempre, nunca guardado — mismo principio que `invoice_balance()`.

## Lo que pide el 606, pedido al registrar (0129)

Hasta la 0129 `/pagar` no pedía nada de esto, y el 606 no se podía
entregar: el TXT respondía 409 ("compra sin clasificar") sin pantalla donde
clasificarla, y el IT-1 cobraba como ITBIS el ISR retenido.

| Campo del formulario | Columna | Para qué |
|---|---|---|
| Fecha de emisión | `issue_date` | La que trae la factura (decide en qué 606 va), no la de hoy. Por defecto, hoy **en RD**; no se acepta una fecha futura |
| Tipo de gasto (01–11) | `expense_type` | Campo 3 del 606. **Obligatorio si trae NCF** |
| De eso, servicios | `services_amount` | Campos 8/9 (servicios / bienes) |
| ITBIS retenido | `retention_amount − isr_retained` | Campo 12; entra al **IT-1** |
| ISR retenido + tipo (01–09) | `isr_retained`, `isr_retention_type` | Campos 17/18; va al **IR-17**, no al IT-1. Sin tipo se rechaza (acción y `check isr_con_tipo`) |
| NCF que modifica | `modified_ncf` | Campo 5, solo notas de crédito/débito |

Las dos retenciones se capturan **por separado** y se guardan como hasta
ahora: `retention_amount` es el total (lo que no se le paga al proveedor) e
`isr_retained` la parte de ISR. El NCF del proveedor se valida por forma
(B + 10 o E + 12 caracteres; B11 y B13 incluidos).

**Facturas viejas sin clasificar:** `/pagar/:id` muestra "Datos para el 606"
y deja completarlos (`clasificarFactura`): tipo de gasto, servicios, qué
parte de la retención ya registrada fue ISR y su tipo, NCF modificado. No
toca montos ni el total retenido —ya cuentan en el saldo y en los pagos—.

El TXT del 606 lleva además el campo 15 (**ITBIS por adelantar**) igual al
facturado: el sistema no modela proporcionalidad ni ITBIS llevado al costo,
y es lo mismo que acredita el IT-1. La `fecha_pago` sale en hora de RD.

**Caso probado** ([`pagar-606.accion.test.ts`](../../apps/web/src/app/pagar/pagar-606.accion.test.ts)):
honorarios 10,000 + ITBIS 1,800, retención de ITBIS 540 e ISR 1,000 (tipo
02). Se le pagan 10,260. El 606 sale con 540 en el campo 12 y 1,000 en el
18; el IT-1 suma **540** de ITBIS retenido, no 1,540.

## El mismo agujero que 0040, tapado desde el primer día

`supplier_payments` tiene su propio `tenant_id`, así que su RLS de
inserción solo compara ese valor contra `rls.tenant_id()` — no revisa a
quién pertenece `invoice_id`. `impedir_pago_a_factura_ajena()` cierra esto
desde la migración original (no como una corrección posterior, como pasó
con `accounting`): compara el tenant real de la factura contra el
declarado en el pago antes de aceptarlo. Probado explícitamente en
`supabase/tests/ap.test.ts`.

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/pagar` | `ap.view` | Lista, registrar factura de proveedor con los datos del 606 |
| `/pagar/:id` | `ap.view` | Historial de pagos, registrar pago, anular (solo sin pagos), clasificar para el 606 (`ap.invoice.create`) |

## Manifiesto

- **Permisos:** `view`, `invoice.create`, `invoice.void`, `payment.record`,
  `export`
- **Widgets:** `overdue-payables`, `due-this-week`
- **Reportes:** `aging-payable`, `supplier-statement`
- **Emite:** `ap.invoice.recorded`, `ap.invoice.paid`
- **Requiere:** `purchase-orders` (comparte `public.suppliers`) ·
  **Recomienda:** `accounting`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/ap.test.ts` — 8 casos: aislamiento, spoofing de tenant vía `invoice_id` ajeno (bloqueado desde el primer día), límite de sobrepago considerando la retención, módulo apagado, restricciones de tabla |
| 3 | Lógica pura con cobertura | ✅ reusa `receivables.ts`/`documents.ts` de `ar`, ya al 100% |
| 4 | UI web responsive | ✅ verificado en navegador: factura con retención, saldo correcto, historial de pagos |
| 5 | UI móvil | 🔜 F5 — `mobileScope`: view |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una factura de proveedor con retención, abonada a medias |
| 9 | ≥2 widgets | ✅ `overdue-payables`, `due-this-week` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavía |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en lista y detalle |

## Lo que NO hace

- **Calcular la retención.** Ver arriba — es una decisión del negocio,
  no una fórmula de la DGII que este sistema conozca.
- **Programación de pagos / flujo de caja proyectado.** Eso es
  `treasury` (19), módulo hermano de esta misma fase, no construido
  todavía.
- **Conciliación bancaria.** Es `bank-rec` (20), sprint S31.

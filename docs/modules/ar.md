# `ar` — Por cobrar

**Qué resuelve:** cobrar lo que te deben y declarar lo que vendiste. Cierra el
ciclo del MVP: vender ya funciona, ahora hay que cobrar.

Sin esto, un negocio a crédito no sabe quién le debe ni desde cuándo — la
razón número uno por la que una PYME vuelve a Excel.

**Categoría:** `standard` · **Precio:** 150/600/1800 instalación · 19/69/190 mes

---

## Todo prefijado `customer_*`

⚠️ `regb.invoices` son las facturas **de REGB al tenant**. Las del tenant a
**sus** clientes necesitan otra tabla y otro contador. Confundirlas sería
mezclar la contabilidad del proveedor con la del cliente.

Migración [`0023_receivables.sql`](../../supabase/migrations/0023_receivables.sql).

| Tabla | Notas |
|---|---|
| `customer_invoices` | `source_type` (sales_order / pos_sale / manual), estado open/partially_paid/paid/overdue/void, `ncf`, `ncf_type`, `buyer_tax_id` |
| `customer_payments` | Los cobros que la van saldando |
| `customer_invoice_counters` | Numeración `FAC-2026-00001` vía `next_customer_invoice_number()` |
| `invoice_late_fees` | Cargos por mora capturados a mano ([`0040_cargo_por_mora.sql`](../../supabase/migrations/0040_cargo_por_mora.sql)) — ver abajo |

La factura guarda **totales, no líneas**: nace de un pedido que ya tiene las
suyas, y duplicarlas abre la puerta a que las dos versiones difieran. El
detalle se consulta en el pedido de origen (`source_type` + `source_id`).

`due_date` se guarda al emitir en vez de derivarse de `customers.payment_terms`:
los días de crédito del cliente pueden cambiar después, y esta factura venció
con los de aquel día.

`public.invoice_balance(id)` **calcula** el saldo: total + mora - cobrado.
**No se guarda como columna**: un saldo almacenado a mano se desincroniza el
día que alguien anule un cobro o se agregue un cargo. Cobrar más del saldo se
rechaza — eso es un anticipo, no un cobro.

`public.mark_overdue_invoices()` mueve a vencidas las que pasaron su
`due_date`.

## Cargo por mora — sin fórmula, a propósito

El negocio de un cliente real (colmado/ferretería que vende a crédito con
vendedores) lo hacía a mano: contar cuántos días se tardó el cliente en
pagar y decidir si cobrarle algo encima. Preguntado directamente, **no hay
una fórmula fija** — ni "% × saldo" ni "% × días de atraso" — es una
decisión de negocio caso por caso, que además puede cambiar. Construir un
motor de cálculo automático habría sido resolver el problema equivocado.

Lo que el módulo sí hace:

- Muestra los **días de atraso** (ya visible en `/cobrar` desde antes) para
  que el negocio decida con el dato a mano.
- Deja **capturar el monto** que decidan en un campo libre — `amount` en
  `invoice_late_fees`, un *ledger* de solo inserción igual que
  `inventory_movements`: un cargo aplicado por error se revierte con una
  nota de crédito, nunca editando ni borrando la fila.
- Respeta `customers.late_fee_exempt`: un flag fijo por cliente
  (relación, volumen, acuerdo comercial) que alguien marca a mano y que
  **no cambia solo** por comportamiento de pago.
- La exención se comprueba **dos veces**: en la acción del servidor y en un
  trigger `before insert` (`impedir_mora_a_exento()`) — para que sea
  imposible saltársela hoy o el día que alguien agregue un segundo camino
  de inserción.
- El mismo trigger repite la lección de la 0031: compara el `tenant_id` de
  la fila nueva contra el tenant **real** dueño de `invoice_id` (vía
  `security definer`, que por definición elude la RLS). Sin esa
  comprobación, la RLS de inserción sola no basta — solo mira el
  `tenant_id` de la fila que se inserta, no a quién pertenece la factura
  referenciada.
- Un cargo puede **reabrir** una factura `paid`: el cliente terminó de
  pagar el capital, pero ahora debe el cargo que se decidió después. Es el
  comportamiento correcto, no un bug.

`lateFeeEligible()` en [`receivables.ts`](../../packages/operations/src/receivables.ts)
decide únicamente si la opción se OFRECE (cliente no exento, factura no
anulada, con días de atraso) — nunca cuánto cobrar.

## Antigüedad de saldos

Reparte el **saldo pendiente** (no el total — una factura pagada a medias
envejece solo su remanente) en 0-30 / 31-60 / 61-90 / 90+ desde `due_date`,
con `as_of_date` parametrizable para cierres de mes.

En [`receivables.ts`](../../packages/operations/src/receivables.ts) con **22
tests**.

Verificado: factura a 30 días → cobro parcial de RD$2,000 → intento de
sobrepago de RD$99,999 **rechazado** → saldo cero al completar.

---

## Base fiscal DGII

Esta es la parte que un cliente dominicano mira primero.

### Secuencias NCF

Migración [`0026_ncf_dgii.sql`](../../supabase/migrations/0026_ncf_dgii.sql).

`public.ncf_sequences` guarda los rangos autorizados. `public.assign_ncf()`
consume el próximo de forma **atómica** (`for update`) y falla con un mensaje
accionable —no con un error genérico— cuando la secuencia está agotada,
vencida o no existe.

`/cobrar/ncf` insiste en lo que de verdad duele: **cuántos quedan y cuándo
vence**. Pedirle a la DGII una autorización nueva toma días y quedarse sin NCF
detiene el negocio.

Registrar una secuencia nueva del mismo tipo **archiva** la anterior; su
historial de comprobantes emitidos se conserva para la auditoría.

**Un NCF consumido nunca vuelve**, ni aunque se anule la factura: la DGII
espera verlo reportado como anulado en el 608, no desaparecido.

Tipos soportados: B01, B02, B04, B14, B15, B16 (8 dígitos) y E31, E32, E33,
E34 (10 dígitos, serie electrónica).

### Validación de identificación

[`dgii.ts`](../../packages/operations/src/dgii.ts) con **14 tests**:

- **RNC** — 9 dígitos, dígito verificador por módulo 11 con pesos
  `[7,9,8,6,5,4,3,2]`
- **Cédula** — 11 dígitos, Luhn

Se aplica al guardar un cliente. Los datos de prueba usan solo RNC
verificados (`401007551` es el de la propia DGII); los de la semilla se
corrigieron cuando la validación reveló que eran números decorativos.

### Reportes 606 / 607 / 608

Migraciones [`0027`](../../supabase/migrations/0027_dgii_607_608.sql) y
[`0028`](../../supabase/migrations/0028_normalizar_rnc.sql).

| Reporte | Estado |
|---|---|
| **607** ventas | ✅ vista `public.dgii_607` — facturas a crédito **y** ventas de caja, sin las anuladas |
| **608** anulados | ✅ vista `public.dgii_608` — el NCF se declara, no se omite |
| **606** compras | ❌ `purchase-orders` ya existe (2026-09-02) y captura `supplier_ncf`/`supplier_ncf_date`, pero el reporte en sí no está construido — necesita la misma verificación rigurosa del formato DGII que ya se hizo para 607/608, y eso no se ha investigado para 606. No es falta de módulo, es falta de esa investigación. |

`/cobrar/dgii` los muestra por periodo, con permiso `ar.export`.

> 🐞 **Dos bugs reales que vale documentar.**
>
> 1. El 607 solo miraba `customer_invoices`. Desde que la caja emite NCF, un
>    colmado que vende solo por mostrador habría reportado **cero ventas**
>    teniendo cientos de comprobantes emitidos.
> 2. El 607 clasifica el tipo de identificación por la **longitud**: 9 = RNC,
>    11 = cédula. Guardado con guiones, un RNC de 9 dígitos mide 11 caracteres
>    y se reportaba como **cédula**. No se ve en pantalla y no aparece hasta
>    que la DGII rechaza el archivo. Ahora se normaliza el dato y la vista
>    cuenta dígitos, no caracteres.

### Lo que NO está: e-CF — es F6

Transmisión del comprobante fiscal electrónico a la DGII: firma con
certificado digital, serialización XML, endpoint de recepción, acuse y **modo
contingencia** para cuando el servicio del Estado está caído.

No se construye a ciegas: necesita credenciales reales de un contribuyente y
es la parte que más cambia por decreto. Por eso vive aislada y versionada en
`e-invoice` (#25), no esparcida por el resto del ERP.

---

## Pantallas

> 🐞 **Ruta declarada, nunca construida.** El manifest siempre declaró
> `/cobrar/:id`, pero la pantalla no existía — `anularFactura()` no tenía
> ningún punto de entrada en la UI, y no había forma de ver el historial de
> cobros ni de cargos por mora de una factura, solo los totales agregados
> en la lista. Se descubrió auditando que cada ruta declarada en un
> manifest tuviera su `page.tsx` real. Construido 2026-09-02.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/cobrar` | `ar.view` | Facturas, cobros |
| `/cobrar/cartera` | `ar.view` | Antigüedad por tramo y por cliente |
| `/cobrar/ncf` | `ar.invoice.create` | Secuencias autorizadas, salud de cada una |
| `/cobrar/dgii` | `ar.export` | 607 y 608 del periodo |
| `/cobrar/:id` | `ar.view` | Detalle: historial de cobros y cargos por mora, anular (oculta del menú) |

Verificado por rol: el Contador entra a los reportes DGII, el Cajero recibe
404.

## Manifiesto

- **Permisos:** `view`, `invoice.create`, `invoice.void`, `payment.record`,
  `latefee.apply`, `export`
- **Widgets:** `overdue-receivables`, `aging-summary`
- **Reportes:** `aging-report`, `customer-statement`
- **Emite:** `ar.invoice.issued`, `ar.invoice.paid`, `ar.invoice.overdue`
- **Escucha:** `sales-orders.order.delivered`
- **Requiere:** `sales-orders` · **Recomienda:** `accounting`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/fiscal.test.ts` (NCF sin duplicados bajo concurrencia, 607/608 complementarios, aislamiento fiscal) + `supabase/tests/ar-late-fees.test.ts` (10 casos: aislamiento, cliente exento bloqueado por trigger, spoofing de tenant vía `invoice_id` ajeno, saldo con mora, módulo apagado, restricciones) |
| 3 | Lógica pura con cobertura | ✅ `receivables.ts` 26 tests (**100%**, incluye `lateFeeEligible`) + `dgii.ts` 14 (**97.6%**) |
| 4 | UI web responsive | ✅ verificado en navegador: aplicar cargo por mora, ver saldo recalculado y estado reabierto, marcar/quitar cliente exento y confirmar que el control desaparece, registrar un cobro desde el detalle y ver el historial actualizado |
| 5 | UI móvil | 🔜 F5 — `mobileScope`: view |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | ✅ `f4.cobrar`, 6 pasos |
| 8 | Datos demo | ✅ facturas a 10 / 75 / 125 días (envejecen solas); la de 125 con RD$500 de mora aplicada, y un cliente de volumen marcado exento |
| 9 | ≥2 widgets | ✅ |
| 10 | Eventos documentados | ✅ |
| 11 | Precio en 3 tiers | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ |
| 14 | Accesibilidad AA | ✅ 29 pantallas sin fallos automatizables — sin controles anónimos, jerarquía de encabezados correcta, landmarks y contraste (ver [README](README.md#accesibilidad)) |

## Lo que NO hace

- **La factura no se crea sola** al entregar un pedido. El evento solo
  enciende un aviso de "pendiente de facturar".
- **Recordatorios**: se emiten a `public.notifications` (in-app). No hay
  infraestructura de correo ni WhatsApp en el repo; el envío externo queda
  fuera de F4.
- **Notas de crédito**: no están en F4. `invoice_balance()` hoy es
  total + mora - cobros; cuando entren las notas de crédito, se restan ahí.
- **Cálculo automático de mora**: deliberado, no una omisión — ver arriba.
  El sistema informa (días de atraso) y deja capturar, nunca calcula un
  monto por su cuenta.
- **Líneas de factura propias**: ver arriba — el detalle vive en el pedido.

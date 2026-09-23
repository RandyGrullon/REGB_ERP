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
| `customer_invoice_lines` | Las líneas de la factura, congeladas al emitir (0130) — ver abajo |
| `customer_payments` | Los cobros que la van saldando. Desde 0130 `reversed_at/by/reason`: un cobro se **reversa**, no se borra ni se edita |
| `customer_invoice_counters` | Numeración `FA-2026-00001` vía `next_customer_invoice_number()` |
| `invoice_late_fees` | Cargos por mora capturados a mano ([`0040_cargo_por_mora.sql`](../../supabase/migrations/0040_cargo_por_mora.sql)) — ver abajo |
| `customer_credit_notes` + `_lines` + `_counters` | Notas de crédito B04 (0130), `NC-2026-00001` — ver abajo |
| `ar_credit_policy` | Días de atraso que bloquean crédito nuevo, por negocio (0130) |
| `credit_overrides` | Excepciones de crédito autorizadas: quién, cuándo, por qué y qué se saltó (0130) |

Todo lo de 0130 está en [`0130_venta_a_credito_de_verdad.sql`](../../supabase/migrations/0130_venta_a_credito_de_verdad.sql),
con RLS `tenant + ar`, guardas de cliente en cada FK (0121), bitácora, y sin
`update`/`delete` para `authenticated` en lo que es firma o comprobante
(excepciones, líneas, notas).

### La factura tiene líneas y factura lo ENTREGADO (0130)

Hasta 0130 la factura guardaba solo totales ("el detalle vive en el
pedido"). Tres cosas lo desmintieron: no se podía imprimir, **se facturaba
lo pedido y no lo entregado** —un pedido de 10 con 4 entregados se cobraba
entero— y una devolución parcial no tenía contra qué compararse.

Ahora `facturarPedido()` factura, por línea, **entregado − ya facturado**
(`customer_invoice_lines.order_line_id` lleva la cuenta). Un pedido que sale
por partes se factura por partes: una factura por entrega. Un pedido
cancelado a medias sigue en "sin facturar" hasta que lo que alcanzó a salir
se facture. Las facturas anteriores a 0130 (sin líneas) se respetan como
estaban: cubrieron el pedido entero.

`due_date` se guarda al emitir en vez de derivarse de `customers.payment_terms`:
los días de crédito del cliente pueden cambiar después, y esta factura venció
con los de aquel día. La fecha de emisión es la de Santo Domingo
(`fechaFiscal()`), no la del servidor en UTC.

### Saldo y estado: un solo cálculo

`public.invoice_balance(id)` **calcula** el saldo:
**capital + mora − cobros no reversados − notas de crédito** (0130).
**No se guarda como columna**: un saldo almacenado a mano se desincroniza el
día que alguien reverse un cobro o emita una nota. Cobrar más del saldo se
rechaza — eso es un anticipo, no un cobro.

El `status` sí se guarda, como proyección, y lo recalcula **una sola**
función (`recalcularEstado` en `cobrar/actions.ts`) con esos mismos cuatro
números. Antes cada acción lo calculaba a su manera y pasaba esto:

> 🐞 **La mora no se podía cobrar.** `registrarCobro` validaba contra el
> total **sin** mora mientras la pantalla proponía el saldo **con** mora:
> cobrar 11,564 + 500 daba "Solo quedan 11564.00", y cobrar 11,564 dejaba la
> factura `paid` con los 500 fuera de la cartera para siempre. Ahora se cobra
> contra `invoice_balance()`, el mensaje dice el saldo real "incluye RD$
> 500.00 de mora", y pagar solo el capital deja la factura vencida con 500
> pendientes.

### Reversar un cobro (0130)

Un cobro de 5,000 digitado en vez de 500 no tenía corrección: borrar está
prohibido (0108, con razón) y editar el monto borra la huella. `reversarCobro()`
(permiso `ar.payment.reverse`) lo marca reversado con **motivo** y quién; el
saldo lo deja de contar, la ficha lo muestra tachado y `audit.log` guarda el
antes y el después. El trigger `no_editar_cobro` impide editar un cobro y
deshacer un reverso, también por PostgREST. Una factura cuyos cobros se
reversaron todos se puede anular.

`public.mark_overdue_invoices()` mueve a vencidas las que pasaron su
`due_date`.

## Crédito: límite y bloqueo por vencidas (0130)

`customers.credit_limit` existía desde la 0020 y **nadie lo leía**: a
Ferretería El Martillo, con una factura vencida hace 96 días, se le
confirmaba, entregaba y facturaba un pedido de RD$100,000. Ahora confirmar
un pedido **y** facturarlo pasan por la misma puerta
([`lib/credito.ts`](../../apps/web/src/lib/credito.ts) → `evaluateCredit()`
en [`receivables.ts`](../../packages/operations/src/receivables.ts)):

1. **Límite.** Saldo pendiente + el documento > límite → bloqueado. Igual al
   límite pasa. `null` = sin límite (así nacen todos: nada cambia hasta que
   alguien lo fije). Saldo pendiente = facturas con saldo **+ pedidos
   confirmados sin facturar** (por línea: pedido − facturado; de un pedido
   cancelado, solo lo que alcanzó a entregarse). Sin eso, diez pedidos de
   40,000 contra un límite de 50,000 pasaban uno a uno.
2. **Vencidas.** Alguna factura con saldo vencida hace **más de N días** →
   bloqueado. El día N todavía no bloquea (mismo criterio que la antigüedad).

Si fallan las dos se reportan las dos, con cifras y números de factura:
quien autoriza tiene que saber todo lo que se salta.

**N = 30 por defecto** (`DIAS_BLOQUEO_POR_DEFECTO`), configurable por
negocio en `/cobrar/cartera` (`ar_credit_policy`, 1–365; vacío = no bloquear
por vencidas). Por qué 30: el Cliente #1 vende a 15 y 30 días; un cliente
que pasa un mes entero después de su vencimiento ya dobló el plazo que se le
dio —no es un cheque que llegó tarde, es un patrón—. Menos frenaría por
despistes de una semana; más de 60 deja crecer la deuda de quien ya dejó de
pagar.

**Excepción autorizada.** En un negocio real el dueño a veces dice "dale,
que paga el viernes". Con el permiso **`ar.credit.override`** (y el monto:
el `max_amount` del rol aplica) y un **motivo obligatorio**, la venta pasa y
queda escrita en `credit_overrides` (con su fila en `audit.log` y el evento
`ar.credit.overridden`). La excepción autorizada al confirmar cubre la
factura de **ese** pedido. Todo en la misma transacción: si la venta no se
completa, la excepción tampoco queda.

| Rol de fábrica | `ar.credit.manage` (fijar límite y política) | `ar.credit.override` (autorizar) |
|---|---|---|
| Owner, Admin | ✅ (`*`) | ✅ (`*`) |
| Contador | ✅ (`ar.*`) | ❌ **negado explícito** (0130): lleva la cartera y registra cobros; autorizar crédito es del dueño (segregación). El dueño se lo devuelve en `/roles` si quiere |
| Gerente General / de Sucursal (0025) | ✅ (`ar.*`) | ✅ (`ar.*`); el de Sucursal con su tope de 50,000 |
| Vendedor | ❌ | ❌ — da de alta clientes, no decide cuánto se les fía |

El límite lo fija quien tiene `ar.credit.manage` también por PostgREST: el
trigger `no_limite_sin_permiso` mira `rls.has_perm()` cuando el token trae
rol (0127: la web ya lo manda).

Sin `ar` activo no hay cartera: lo decide la RLS (facturas, política y
excepciones invisibles), no un `if` por id de módulo.

### RNC inválido: nunca B02 en silencio (0130)

Antes: RNC válido → B01; cualquier otra cosa → B02, sin decirlo. Un cliente
con el RNC mal digitado pedía crédito fiscal y recibía consumo.
`chooseInvoiceNcf()` ([`dgii.ts`](../../packages/operations/src/dgii.ts)):

- **Automático:** sin RNC → B02; RNC válido → B01; RNC **inválido → error**
  que lo dice con el número y qué hacer (corregirlo en la ficha del cliente,
  o elegir B02 a propósito).
- **B01 pedido** sin RNC válido → error. **B02 pedido** → B02; un RNC
  inválido no viaja al 607 (lo rebotaría entero).

El error llega **antes** de consumir número: ni factura, ni NCF quemado.

### Errores legibles, no pantallas rotas (0130)

Toda acción de `cobrar/`, `pedidos/` y `cobros/` pasa por `sinExcepciones()`
([`lib/accion-segura.ts`](../../apps/web/src/lib/accion-segura.ts)): una
excepción de la base se devuelve como `ActionResult`. Los `raise` propios
(ya en español, como el de `assign_ncf`) se muestran tal cual; los crudos de
Postgres (RLS, índice único, uuid mal formado) se traducen. Facturar sin
secuencia B01 ahora dice "No hay secuencia activa de B01… Se registra en Por
cobrar > Comprobantes." en vez de tirar la pantalla.

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

**La misma pantalla vive en la Caja** (`/pos/comprobantes`, permiso
`pos.ncf.manage`): los NCF los emiten `ar` y `pos`, y un colmado con solo
caja no tenía dónde cargar su autorización —`/cobrar/ncf` le daba 404—. El
contenido es uno solo ([`components/fiscal/SecuenciasNcf.tsx`](../../apps/web/src/components/fiscal/SecuenciasNcf.tsx))
y las puertas están en [`lib/fiscal.ts`](../../apps/web/src/lib/fiscal.ts)
(`PUERTAS_NCF`), como dato y no como `if` por módulo (0129).

Desde [`0129`](../../supabase/migrations/0129_lo_fiscal_se_declara_en_rd.sql):

- **Varias del mismo tipo conviven.** Registrar una nueva ya no archiva la
  anterior (tiraba los números que le quedaban). `assign_ncf()` consume la
  **vigente de rango más bajo con números** y, si dos cajas agotan la primera
  a la vez, reintenta con la siguiente. La pantalla dice cuál está **en
  uso**, cuáles **en espera**, y cuáles **agotada**, **vencida** o
  **desactivada**.
- **Un rango no pisa a otro.** Trigger `ncf_rango_sin_cruce`: contra una
  vigente del mismo tipo, ningún cruce; contra cualquiera, los números **ya
  emitidos** no se vuelven a cargar. Lo que una desactivada nunca usó sí se
  puede cargar de nuevo (así se corrige un rango mal digitado).
- **Vencimiento y baja, con motivo.** `ajustar_secuencia_ncf()` es la única
  puerta: pide motivo, no toca rangos ni el próximo número, y el antes y el
  después quedan en `audit.log` (`adjusted_reason` guarda el último). Una
  desactivada no se reactiva.
- **El próximo número solo lo mueve la emisión**, de uno en uno (trigger
  `ncf_proximo_solo_avanza`): hacia atrás repetía NCF y trancaba la caja
  contra el índice único; hacia adelante dejaba huecos.
- **Vigencia en hora de RD:** una autorización vale hasta la medianoche de
  Santo Domingo de su último día (`hoy_fiscal()`), no hasta las 8 p. m.

**RLS con permiso.** Leer: cualquiera con `ar` o `pos` activo (el cajero
tiene que saber si hay NCF antes de cobrar). Cargar: `ar.invoice.create` o
`pos.ncf.manage` (políticas `registrar_*`). `authenticated` solo tiene
`UPDATE (next_number)` —lo que necesita el `select … for update` de la
caja— y no tiene `DELETE`. Antes la política `tenant_pos` era `for all` sin
mirar el permiso: un cajero con su token de PostgREST cargaba, apagaba o
reiniciaba rangos.

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
| **607** ventas | ✅ vista `public.dgii_607` — facturas a crédito, ventas de caja **y notas de crédito B04** (con `ncf_modificado`, 0130), sin las anuladas. `monto_facturado = total − ITBIS`; la caja se fecha con `sold_at` en hora de RD (0129) |
| **608** anulados | ✅ vista `public.dgii_608` — el NCF se declara, no se omite. Misma fecha que el 607 |
| **606** compras | ✅ vista `public.dgii_606` ([0099](../../supabase/migrations/0099_dgii_606.sql)) — es de `ap`, ver [ap.md](ap.md) |

`/cobrar/dgii` los muestra por periodo, con permiso `ar.export`. La misma
pantalla vive en la Caja (`/pos/dgii`, `pos.export`) para quien vende solo
en mostrador, y `/api/dgii/607|608` acepta cualquiera de las dos puertas
(`PUERTAS_VENTAS_DGII`).

**Ventas que un módulo apagado esconde.** El 607 suma bajo la RLS de `ar`
y de `pos`: con uno apagado, su mitad vuelve en cero y el reporte sale corto
pareciendo completo. `public.ventas_fuera_de_vista(periodo)` (0129) cuenta
—sin devolver filas ni montos— las ventas del periodo en un módulo apagado;
si hay, la pantalla lo dice en rojo y la descarga del 607/608 responde 409.

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
> 3. **El descuento se restaba dos veces** (0129). `documentTotals()` guarda
>    el `subtotal` ya neto y la vista hacía `subtotal − discount`: un ticket
>    de 1,000 con 10% (subtotal 900, ITBIS 162) se declaraba con **800** de
>    base. Ahora es `total − ITBIS` = **900**, que vale también para las
>    filas con la convención vieja de subtotal bruto (el seed).
> 4. **Fechas en UTC** (0129). Una venta del 30 de septiembre a las 9 p. m.
>    se declaraba el **1 de octubre**, en el 607 y el IT-1 de octubre, y una
>    venta offline con la hora de sincronizar. Ahora periodo y fecha salen de
>    `public.fecha_fiscal(sold_at)` (Santo Domingo), y `issue_date` nace con
>    `hoy_fiscal()`.

### Nota de crédito B04 (0130)

`emitirNotaDeCredito()` (permiso `ar.creditnote.create`), desde la ficha de
la factura:

- **Devolución:** por líneas de la factura, con la cantidad que vuelve.
  Puede **reponer inventario** en el almacén del pedido, como entrada sin
  costo (`adjustment_in`, el promedio no cambia). Si inventario está apagado
  lo dice su RLS y llega como aviso, sin nota a medias.
- **Rebaja:** un monto con ITBIS, separado en base e impuesto en la
  proporción de la factura (`splitTaxInclusive()`).
- Lleva **NCF B04** (E34 si la factura era electrónica) y `modified_ncf` = el
  NCF de la factura. Sin secuencia B04, error legible y nada emitido.
- **No pasa del saldo pendiente.** Si el cliente ya pagó, devolverle dinero
  es un reembolso y todavía no está en el sistema (ver "Lo que NO hace").
  La suma de notas nunca pasa el total de la factura, ni se devuelve más de
  lo facturado por línea, ni va sobre una anulada: lo impiden también
  `no_nota_de_mas` y `no_devolver_de_mas` en la base.
- Resta del saldo; una factura con notas ya no se anula (la DGII la ve
  modificada). Emite `ar.credit-note.issued`, que escucha contabilidad
  (0131).

**En la DGII:** la B04 sale en el **607** (`origen = 'nota_credito'`,
montos positivos como pide el formato, y el NCF modificado en el campo 4
del TXT y en la columna nueva `ncf_modificado` de `dgii_607`), y el **IT-1**
la resta del ITBIS facturado (`/impuestos/liquidacion`, que suma la vista
con signo por origen). Una nota sobre una factura sin NCF no va al 607 pero
también resta en el IT-1. Su `issue_date` nace con `hoy_fiscal()`.
**[norma]** Montos positivos para la B04 y la forma de venta "a crédito"
en el TXT: confirmar con el instructivo vigente del 607.

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
| `/cobrar` | `ar.view` | Facturas, cobros. "Sin facturar" = lo **entregado** pendiente, con el comprobante a elegir (automático/B01/B02), el aviso de RNC inválido y el bloqueo de crédito con su excepción |
| `/cobrar/cartera` | `ar.view` | Antigüedad por tramo y por cliente. Política de crédito (días que bloquean), editable con `ar.credit.manage` |
| `/cobrar/ncf` | `ar.invoice.create` | Secuencias autorizadas: en uso, en espera, agotada, vencida; cargar, corregir vencimiento, dar de baja con motivo. Gemela de `/pos/comprobantes` |
| `/cobrar/dgii` | `ar.export` | 606, 607 y 608 del periodo. Gemela de `/pos/dgii` |
| `/cobrar/:id` | `ar.view` | Detalle: líneas, cobros (reversar con motivo), cargos por mora, notas de crédito (devolución/rebaja), imprimir, anular (oculta del menú) |
| `/cobrar/:id/imprimir` | `ar.view` | Factura en carta (Norma 06-2018): emisor y RNC, tipo de comprobante, NCF, "válida hasta" de la secuencia, comprador y RNC, líneas con ITBIS, condiciones y vencimiento. Fuera del shell, papel blanco en los dos temas (oculta del menú) |

Verificado por rol: el Contador entra a los reportes DGII, el Cajero recibe
404.

## Manifiesto

- **Permisos:** `view`, `invoice.create`, `invoice.void`, `payment.record`,
  `payment.reverse`, `latefee.apply`, `creditnote.create`, `credit.manage`,
  `credit.override`, `export`
- **Widgets:** `overdue-receivables`, `aging-summary`
- **Reportes:** `aging-report`, `customer-statement`
- **Emite:** `ar.invoice.issued`, `ar.invoice.paid`, `ar.invoice.overdue`;
  desde la tabla (0131) `ar.payment.received`, `ar.invoice.voided`,
  `ar.late-fee.applied`; desde las acciones (0130) `ar.payment.reversed`
  `{invoiceId, paymentId, amount}`, `ar.credit-note.issued`
  `{invoiceId, creditNoteId, total, kind}`, `ar.credit.overridden`
  `{orderId, customerId, stage, blocks, documentTotal}`
- **Escucha:** `sales-orders.order.delivered`
- **Requiere:** `sales-orders` · **Recomienda:** `accounting`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/fiscal.test.ts` (NCF sin duplicados bajo concurrencia, 607/608 complementarios, aislamiento fiscal) + `supabase/tests/ar-late-fees.test.ts` (10 casos: aislamiento, cliente exento bloqueado por trigger, spoofing de tenant vía `invoice_id` ajeno, saldo con mora, módulo apagado, restricciones) + `supabase/tests/ar-credito.test.ts` (0130, 30 casos: aislamiento de las 5 tablas nuevas, módulo apagado, lo firmado no se edita, cobro que se reversa y no se edita, saldo con reversos y notas, topes de las notas, FK ajenas, límite por PostgREST, Contador de fábrica) |
| 3 | Lógica pura con cobertura | ✅ `receivables.ts` 26 tests (**100%**, incluye `lateFeeEligible`) + `dgii.ts` 14 (**97.6%**) + `credito.test.ts` 32 (límite, vencidas, mensaje, B01/B02, rebaja con ITBIS, 607 con NCF modificado) |
| 3b | Acciones reales (0130) | ✅ `cobrar/cobrar.accion.test.ts` 25, `pedidos/credito.accion.test.ts` 13, `pedidos/pedidos.accion.test.ts` 10, `cobrar/fiscal-b04.accion.test.ts` 3, `cobrar/pantallas.accion.test.ts` 8 (render de las pantallas con datos reales). Cada arreglo se vio en rojo contra la acción vieja y otra vez rompiéndolo a propósito |
| 4 | UI web responsive | ✅ verificado en navegador: aplicar cargo por mora, ver saldo recalculado y estado reabierto, marcar/quitar cliente exento y confirmar que el control desaparece, registrar un cobro desde el detalle y ver el historial actualizado. 🟡 Pantallas de 0130: render en servidor con datos reales + capturas en oscuro/claro; falta recorrido en la app (ver Pendiente) |
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
- **Reembolsos / saldo a favor**: una nota de crédito no puede pasar del
  saldo pendiente. Si el cliente ya pagó y se le devuelve dinero, eso hoy va
  por fuera; hace falta un "reembolso" (cobro negativo con su forma de pago)
  para que la nota pueda dejar saldo a favor sin que quede huérfano.
- **Anular una nota de crédito** o reversar la mora: una nota emitida es
  final (se corregiría con una nota de débito, B03/E33, que no existe). La
  mora no es un comprobante: no se rebaja con B04.
- **Re-reservar** un pedido confirmado sin existencia cuando entra
  mercancía: queda en backorder y se entrega (el stock puede quedar
  negativo, a propósito).
- **Cálculo automático de mora**: deliberado, no una omisión — ver arriba.
  El sistema informa (días de atraso) y deja capturar, nunca calcula un
  monto por su cuenta.
- **Imprimir la nota de crédito**: la factura sí se imprime; la nota por
  ahora se ve en la ficha de la factura.

## Pendiente (al cierre de 0130, 23 sep 2026)

Honesto, en orden de lo que más le duele al Cliente #1:

1. **`regb_test` no tiene la 0130** (ni 0128/0129). Mientras no se migre,
   `/cobrar`, `/pedidos/:id` y la ficha del cliente dan error en el
   servidor de vista previa. Probado en `regb_credito` recreada desde cero
   con 0001–0135 en orden + seed.
2. **Recorrido en navegador real** de las pantallas nuevas (ficha del
   cliente, excepción, reverso, nota de crédito, imprimir) — por (1) se
   verificaron con render en servidor contra datos reales
   (`pantallas.accion.test.ts`) y capturas estáticas en oscuro y claro, no
   haciendo clic en la app.
3. **Seed:** Ferretería El Martillo (131-22334-5) y Constructora Duarte
   (131-99887-6) tienen el RNC con el dígito malo. Facturarles en
   "automático" ahora da el error (a propósito); el seed debería traer RNC
   válidos o la demo debería enseñar la corrección desde la ficha.
4. **[norma] B04 en el 607:** montos positivos y forma de venta "a crédito"
   para la nota — confirmar con el instructivo vigente.
5. **Reembolso** (para notas sobre facturas ya pagadas), **anular/imprimir
   la nota** y **nota de débito**: no construidos (ver "Lo que NO hace").
6. **Caja:** la lista de precios asignada no se usa en el POS (ver
   [sales-orders.md](sales-orders.md)) y la caja emite B01 con cualquier
   `tax_id` no vacío (`pos/actions.ts`), sin la regla de `chooseInvoiceNcf`.
   Es de `pos`.
7. **Tours** `f4.pedidos` / `f4.cobrar` (`packages/core/src/tours.ts`) no
   mencionan límite, excepción, reverso ni B04.
8. **`rls.role_id()` (0109)** castea el claim sin `nullif`: en una conexión
   del dueño que ya tuvo claims devuelve `''` y revienta. Mi trigger lo
   esquiva; la función sigue igual (es de roles).

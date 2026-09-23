# `accounting` — Contabilidad

**Qué resuelve:** catálogo de cuentas, asientos de partida doble, mayor y
balanza de comprobación — y, desde la 0131, los asientos de cada venta,
cobro, compra y pago **sin escribirlos a mano**. El primero de la Fase 6
(finanzas y fiscalidad).

**Categoría:** `advanced` · **Precio:** 400/1500/4000 instalación · 45/160/420 mes

---

## Deliberadamente sin e-CF ni 606/607/608

Este módulo NO transmite comprobantes fiscales electrónicos ni genera los
reportes de la DGII — eso es `taxes` (24) y `e-invoice` (25), sprints
S32-33 de esta misma fase, y necesitan certificado digital real de un
contribuyente. Aislarlos es la misma decisión que ya se tomó con el e-CF
en `ar`: es la parte que más cambia por decreto, y mezclarla aquí
contaminaría un módulo que hoy funciona sin ninguna credencial externa.

## Se contabiliza sola: asientos por eventos

Decisión en [ADR 0001](../adr/0001-contabilidad-automatica-por-eventos.md),
migración [`0131_contabilidad_automatica.sql`](../../supabase/migrations/0131_contabilidad_automatica.sql).

Hasta la 0131 **nada generaba asientos**: `source_type` solo admitía
`'manual'` y el despachador solo mandaba avisos. Ahora contabilidad
**escucha** los eventos de caja, cuentas por cobrar y cuentas por pagar y
escribe su asiento ya contabilizado. Ninguno de esos módulos la importa ni
la llama.

```
acción (pos/ar/ap) ──► event_outbox ──► despachar() ──► asientos.ts ──► registrar_asiento_automatico()
   misma transacción        at-least-once     lee el origen    reglas por PROPÓSITO    mapa → cuentas, 'posted'
```

| Evento | `source_type` | Débito | Crédito |
|---|---|---|---|
| `pos.sale.completed` | `pos_sale` | Caja / Banco (según forma de pago) · Costo de ventas | Ventas (total − ITBIS) · ITBIS por pagar · Inventario |
| `pos.sale.voided` | `pos_sale_void` | inverso exacto | |
| `ar.invoice.issued` | `ar_invoice` | CxC | Ventas · ITBIS por pagar |
| `ar.invoice.voided` | `ar_invoice_void` | inverso | |
| `ar.payment.received` | `ar_payment` | Caja / Banco | CxC |
| `ar.payment.reversed` | `ar_payment_reversal` | inverso del cobro | |
| `ar.credit-note.issued` | `ar_credit_note` | Ventas · ITBIS por pagar | CxC |
| `ar.late-fee.applied` | `ar_late_fee` | CxC | Recargos por mora |
| `ap.invoice.recorded` | `ap_invoice` | Compras (606 tipo 09 o sin clasificar) o Gastos · ITBIS adelantado | CxP (total − retención) · ITBIS retenido · ISR retenido |
| `ap.invoice.voided` | `ap_invoice_void` | inverso | |
| `ap.payment.recorded` | `ap_payment` | CxP | Caja / Banco |

Efectivo va a caja; tarjeta, transferencia y cheque, al banco. "Ventas" es
`total − ITBIS` y no el `subtotal` guardado, porque hay documentos con
subtotal bruto y otros neto de descuento: `total − ITBIS` es lo cobrado sin
impuesto en los dos casos.

**Garantías** (todas en la base, no solo en la app):

- **Una vez por origen.** Índice único `(tenant_id, source_type, source_id)`
  + candado consultivo: el reintento de un evento ya atendido devuelve el
  asiento que ya existe. Probado reentregando el evento.
- **Cuadrado, por cualquier camino.** `exigir_partida_doble()` (trigger
  `partida_doble_obligatoria`) impide pasar a `posted` un asiento con menos
  de dos líneas o descuadrado —también un `UPDATE` a mano— y que uno nazca
  `posted` sin líneas.
- **Inmutable.** Nace `posted`; los triggers de 0041 ya no lo dejan tocar.
- **Solo el despachador escribe asientos automáticos.**
  `registrar_asiento_automatico()` no tiene grant a `authenticated`.
- **Sin `accounting`, nada.** Devuelve `null` y el evento se da por
  atendido: la venta no se entera.
- **Un mapa roto se reintenta, no se pierde.** "La cuenta 1103 Bancos está
  desactivada…" queda en `last_error`, el evento espera 1, 4, 9… minutos y el
  asiento sale solo cuando se corrige el mapa.
- **Los reversos tocan las mismas cuentas** que el original, aunque el mapa
  haya cambiado; y si el original todavía no existe (su evento está en cola,
  o contabilidad se activó después), se asienta primero. Un cobro también
  asienta primero su factura si le falta: la cartera del mayor nunca queda
  en negativo.

Los eventos que ninguna acción emitía —ticket anulado, cada cobro y cada
pago (`*.invoice.paid` solo sale al saldar), facturas anuladas, cargo por
mora— se emiten **desde la tabla** con un trigger `AFTER`
(`emitir_evento_de_documento()`), en la misma transacción del cambio.

## Mapa de cuentas

`accounting_account_map`: para cada **uso** (caja, banco, cxc, inventario,
ITBIS adelantado, ITBIS por pagar, cxp, ITBIS retenido, ISR retenido,
ventas, recargos por mora, costo de ventas, compras, gastos) la cuenta del
catálogo de ese cliente. Un trigger exige que la cuenta sea del mismo
cliente y del tipo del uso.

No había plantilla de catálogo dominicano en el repo. Se sembró una
**mínima**, alineada con los códigos que ya usa la demo:

| Código | Cuenta | Tipo | Usos |
|---|---|---|---|
| 1101 | Caja general | activo | caja |
| 1102 | Cuentas por cobrar clientes | activo | cxc |
| 1103 | Bancos | activo | banco |
| 1104 | Inventario de mercancías | activo | inventario, compras |
| 1105 | ITBIS adelantado en compras | activo | itbis_adelantado |
| 2101 | ITBIS por pagar | pasivo | itbis_por_pagar |
| 2102 | Cuentas por pagar proveedores | pasivo | cxp |
| 2103 | ITBIS retenido por pagar | pasivo | itbis_retenido |
| 2104 | ISR retenido por pagar | pasivo | isr_retenido |
| 4101 | Ventas de mercancías | ingreso | ventas |
| 4201 | Recargos por mora | ingreso | ingresos_mora |
| 5101 | Costo de ventas | gasto | costo_ventas |
| 6101 | Gastos generales | gasto | gastos |

`asegurar_mapa_contable()` la crea con el primer asiento automático (o
desde `/contabilidad/mapa`): crea las cuentas que falten y asigna los usos
vacíos, sin pisar lo que el cliente ya eligió. Si un código por defecto ya
existe con **otro** tipo, ese uso queda sin asignar y el asiento que lo
necesite falla con el nombre del uso hasta que alguien lo asigne. La misma
tabla vive en TypeScript (`PROPOSITOS_CONTABLES`); una prueba compara las
dos.

## Esquema

Migraciones [`0041_accounting.sql`](../../supabase/migrations/0041_accounting.sql)
y [`0131_contabilidad_automatica.sql`](../../supabase/migrations/0131_contabilidad_automatica.sql).

| Tabla | Notas |
|---|---|
| `accounts` | Catálogo de cuentas. `type` decide el saldo normal (ver abajo) |
| `journal_entries` | Estados: `draft`, `posted`. **No hay `void`** — se corrige con un asiento inverso. `source_type` (`manual` o el documento de origen), `source_id`, `source_event` (el evento del outbox) |
| `journal_entry_lines` | Cada línea es débito O crédito, nunca ambos ni ninguno |
| `journal_entry_counters` | Numeración `AS-2026-00001`; `next_journal_entry_number()` (usuario) y `numerar_asiento()` (despachador) comparten el mismo contador |
| `accounting_account_map` | Uso → cuenta del cliente (0131) |

El mayor y la balanza **no son tablas**: se derivan de las líneas ya
contabilizadas, mismo principio que `invoice_balance()` en `ar` — un saldo
guardado se desincroniza el día que algo se corrija.

## Un asiento contabilizado es inmutable — de verdad

Es la regla central del módulo, y va más allá de una convención de la UI:
`post_journal_entry()` exige al menos dos líneas y débito = crédito, y una
vez que un asiento pasa a `posted`, dos triggers (`no_editar_contabilizado`
en `journal_entries`, `no_editar_lineas_contabilizado` en
`journal_entry_lines`) bloquean **cualquier** `UPDATE`/`DELETE`/`INSERT`
posterior — sin importar el rol, incluido un superusuario con SQL directo.
Verificado exactamente así: ni yo mismo pude borrar un asiento de prueba
sin desactivar el trigger a mano primero.

Para corregir un asiento mal hecho: **otro asiento, inverso**. No hay botón
de "editar" ni de "anular" — es como funciona la contabilidad de verdad,
no una limitación de este sistema.

### El mismo agujero que la 0031/0040, encontrado escribiendo los tests

`journal_entry_lines` tiene su propio `tenant_id`, así que la RLS de
inserción solo compara ESE valor contra `rls.tenant_id()` — no revisa a
quién pertenecen `entry_id` ni `account_id`. Sin una comprobación aparte,
alguien podía insertar una línea con **su propio** `tenant_id` (que pasa la
RLS sin problema) apuntando al asiento o a una cuenta de **otro** cliente.
`impedir_editar_linea_contabilizada()` ahora compara ambas referencias
contra el tenant real antes de aceptar la fila. Se encontró escribiendo el
test de aislamiento, no antes — la misma lección de la 0031 vuelve a
aplicar: toda función/trigger que toca una referencia entre tablas tiene
que validar el tenant de esa referencia, no solo el de la fila propia.

## Saldo normal por tipo de cuenta

[`accounting.ts`](../../packages/operations/src/accounting.ts) con **14
tests**: `asset`/`expense` son deudores, `liability`/`equity`/`revenue`
acreedores. `accountBalance()` devuelve el saldo en la dirección de SU tipo
— una cuenta "al revés" (ej. un activo con más crédito que débito) da
**negativo**, no cero: esconder el signo sería peor que mostrarlo, porque
significa que algo se contabilizó mal.

`validateEntryLines()` repite en el cliente las mismas tres reglas de
`post_journal_entry()` (≥2 líneas, cada línea débito XOR crédito, total
cuadrado) para avisar al instante sin el viaje al servidor — la validación
que de verdad protege el dato sigue siendo la de SQL.

## La balanza sumaba borradores (corregido)

La consulta filtraba `e.status = 'posted'` **dentro de un `LEFT JOIN`**: un
left join no descarta la línea de un borrador, solo deja el asiento en
`null`, y `sum(l.debit)` la contaba igual. Agregar una línea a un borrador
hacía que la balanza dijera "no cuadra" mientras el mayor no la mostraba.
Además filtraba `a.is_active`: desactivar una cuenta con saldo la sacaba de
la balanza y la descuadraba por ese monto.

Ahora vive en [`consultas.ts`](../../apps/web/src/app/contabilidad/consultas.ts)
(`filasBalanza()`), con joins normales —la línea entra solo si su asiento
está contabilizado— y sin filtrar cuentas desactivadas (se marcan con una
etiqueta). Prueba: un borrador de RD$99,999 no mueve la balanza y una cuenta
desactivada con movimiento sigue en ella.

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/contabilidad` | `accounting.view` | Lista de asientos con su **origen** (manual o el documento), crear borrador |
| `/contabilidad/:id` | `accounting.view` | Agregar/quitar líneas, contabilizar, borrar borrador |
| `/contabilidad/cuentas` | `accounting.accounts.manage` | Catálogo de cuentas |
| `/contabilidad/mapa` | `accounting.view` (cambiar: `accounting.accounts.manage`) | Mapa de cuentas de los asientos automáticos; crear el catálogo mínimo |
| `/contabilidad/mayor` | `accounting.view` | Movimientos de una cuenta con saldo acumulado |
| `/contabilidad/balanza` | `accounting.view` | Balanza de comprobación (solo contabilizado), con aviso si no cuadra |

## Manifiesto

- **Permisos:** `view`, `accounts.manage`, `entry.create`, `entry.post`,
  `entry.delete`, `export`
- **Widgets:** `draft-entries-pending`, `monthly-entries-posted`
- **Reportes:** `trial-balance`, `general-ledger`
- **Emite:** `accounting.entry.posted` (desde la tabla, 0131: manual y
  automático) · **Escucha:** `pos.sale.completed`, `pos.sale.voided`,
  `ar.invoice.issued`, `ar.invoice.voided`, `ar.payment.received`,
  `ar.payment.reversed`, `ar.credit-note.issued`, `ar.late-fee.applied`,
  `ap.invoice.recorded`, `ap.invoice.voided`, `ap.payment.recorded` —
  handlers en [`contabilidad-automatica.ts`](../../apps/web/src/lib/contabilidad-automatica.ts)
- **Requiere:** ninguno · **Recomienda:** `ar`, `purchase-orders`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/accounting.test.ts` — 22 casos: aislamiento, spoofing de tenant vía `entry_id`/`account_id` ajeno, partida doble rechazada si no cuadra o tiene <2 líneas, inmutabilidad tras contabilizar (edición, borrado, nueva línea, doble contabilización), módulo apagado, numeración concurrente sin huecos, restricciones de tabla. **0131:** `contabilidad-automatica.accion.test.ts` — 24 casos con acciones y despachador reales: asiento exacto por venta de caja (efectivo y mixto), factura a crédito, cobro parcial, reverso de cobro, nota de crédito, mora, factura de proveedor (mercancía y honorarios con retención ITBIS+ISR), pago, anulaciones; evento reentregado sin duplicar; cliente sin `accounting`; reintento con mapa roto; balanza sin borradores; partida doble en la base; aislamiento del mapa (select/update/delete de otro cliente, cuenta ajena, módulo apagado); un usuario no puede llamar a `registrar_asiento_automatico()` |
| 3 | Lógica pura con cobertura | ✅ `accounting.ts` 14 tests · `asientos.ts` 18 tests (reglas por evento, centavo de redondeo entre formas de pago, retenciones, reverso) |
| 4 | UI web responsive | ✅ verificado en navegador: crear borrador, agregar 2 líneas descuadradas → botón deshabilitado con el motivo exacto, cuadrarlas → se habilita, contabilizar → inmutable, balanza y mayor reflejan el saldo correcto |
| 5 | UI móvil | 🔜 F5 — el manifest ya declara `mobile: false` a propósito: capturar partida doble en un teléfono no es el caso de uso |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ catálogo mínimo de 6 cuentas + un asiento contabilizado (venta con ITBIS) + uno en borrador, para que el widget de pendientes no enseñe siempre el caso feliz. Los códigos por defecto de 0131 coinciden con esos 6: la demo no se duplica |
| 9 | ≥2 widgets | ✅ `draft-entries-pending`, `monthly-entries-posted` |
| 10 | Eventos documentados | ✅ emite `accounting.entry.posted` y escucha 11 temas (arriba) |
| 11 | Precio en 3 tiers | ✅ ya estaba cargado en `module_pricing` desde la siembra original (0009), categoría `advanced` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en asientos, mayor y balanza (3 de 5 pantallas verificadas directamente; cuentas y detalle reutilizan los mismos componentes ya auditados) |

## Lo que NO hace

- **e-CF, 606, 607, 608.** Ver arriba — es `taxes`/`e-invoice`, necesita
  certificado digital real.
- **Cierre de período.** No hay bloqueo de fechas pasadas ni cierre
  mensual/anual formal. Para un catálogo chico y sin la presión de F6
  completa, alcanza con la inmutabilidad del asiento; el cierre de período
  es candidato natural para cuando se construya `budgets`/`cost-centers`.
- **Asientos en tiempo real sin cron.** El asiento llega cuando corre el
  despachador; hoy solo lo dispara el botón de `/control/salud`. Falta el
  cron de infraestructura.
- **Costo de venta de la venta a crédito, recepciones y devoluciones al
  proveedor.** No asientan: el inventario del mayor sube con la factura del
  proveedor y baja con el costo de las ventas de caja. El costo de caja es
  el promedio **al contabilizar** (el kardex no guarda el costo de las
  salidas).
- **Nómina, depreciación, tesorería.** Sus eventos existen pero todavía no
  tienen handler contable.
- **Re-asentar al reclasificar.** Cambiar el tipo de gasto 606 de una
  factura ya contabilizada no cambia su asiento: se corrige a mano.
- **Contabilizar el histórico.** Lo anterior a 0131 no se asienta solo.
- **Plan de cuentas completo.** El catálogo por defecto es el mínimo que
  necesitan los asientos automáticos, plano (sin cuentas padre); no es el
  catálogo completo que usaría un contador.

# `accounting` — Contabilidad

**Qué resuelve:** catálogo de cuentas, asientos de partida doble, mayor y
balanza de comprobación. El primero de la Fase 6 (finanzas y fiscalidad).

**Categoría:** `advanced` · **Precio:** 400/1500/4000 instalación · 45/160/420 mes

---

## Deliberadamente sin e-CF ni 606/607/608

Este módulo NO transmite comprobantes fiscales electrónicos ni genera los
reportes de la DGII — eso es `taxes` (24) y `e-invoice` (25), sprints
S32-33 de esta misma fase, y necesitan certificado digital real de un
contribuyente. Aislarlos es la misma decisión que ya se tomó con el e-CF
en `ar`: es la parte que más cambia por decreto, y mezclarla aquí
contaminaría un módulo que hoy funciona sin ninguna credencial externa.

Tampoco escucha eventos de otros módulos todavía — POS, AR y compras no
postean aquí solos. Es trabajo futuro real (contabilizar automáticamente
una venta o una compra), no algo que se inventó sin que nadie lo pidiera:
el propio `despachador.ts` documenta la regla de "solo hay handlers para
lo que de verdad aporta hoy".

## Esquema

Migración [`0041_accounting.sql`](../../supabase/migrations/0041_accounting.sql).

| Tabla | Notas |
|---|---|
| `accounts` | Catálogo de cuentas. `type` decide el saldo normal (ver abajo) |
| `journal_entries` | Estados: `draft`, `posted`. **No hay `void`** — se corrige con un asiento inverso |
| `journal_entry_lines` | Cada línea es débito O crédito, nunca ambos ni ninguno |
| `journal_entry_counters` | Numeración `AS-2026-00001` vía `next_journal_entry_number()` |

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

## Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/contabilidad` | `accounting.view` | Lista de asientos, crear borrador |
| `/contabilidad/:id` | `accounting.view` | Agregar/quitar líneas, contabilizar, borrar borrador |
| `/contabilidad/cuentas` | `accounting.accounts.manage` | Catálogo de cuentas |
| `/contabilidad/mayor` | `accounting.view` | Movimientos de una cuenta con saldo acumulado |
| `/contabilidad/balanza` | `accounting.view` | Balanza de comprobación, con aviso si no cuadra |

## Manifiesto

- **Permisos:** `view`, `accounts.manage`, `entry.create`, `entry.post`,
  `entry.delete`, `export`
- **Widgets:** `draft-entries-pending`, `monthly-entries-posted`
- **Reportes:** `trial-balance`, `general-ledger`
- **Emite:** `accounting.entry.posted` · **Escucha:** ninguno todavía
- **Requiere:** ninguno · **Recomienda:** `ar`, `purchase-orders`

## Definición de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/accounting.test.ts` — 22 casos: aislamiento, spoofing de tenant vía `entry_id`/`account_id` ajeno, partida doble rechazada si no cuadra o tiene <2 líneas, inmutabilidad tras contabilizar (edición, borrado, nueva línea, doble contabilización), módulo apagado, numeración concurrente sin huecos, restricciones de tabla |
| 3 | Lógica pura con cobertura | ✅ `accounting.ts` 14 tests |
| 4 | UI web responsive | ✅ verificado en navegador: crear borrador, agregar 2 líneas descuadradas → botón deshabilitado con el motivo exacto, cuadrarlas → se habilita, contabilizar → inmutable, balanza y mayor reflejan el saldo correcto |
| 5 | UI móvil | 🔜 F5 — el manifest ya declara `mobile: false` a propósito: capturar partida doble en un teléfono no es el caso de uso |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ catálogo mínimo de 6 cuentas + un asiento contabilizado (venta con ITBIS) + uno en borrador, para que el widget de pendientes no enseñe siempre el caso feliz |
| 9 | ≥2 widgets | ✅ `draft-entries-pending`, `monthly-entries-posted` |
| 10 | Eventos documentados | ✅ declarado en el manifest; nadie lo escucha todavía, a propósito |
| 11 | Precio en 3 tiers | ✅ ya estaba cargado en `module_pricing` desde la siembra original (0009), categoría `advanced` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en asientos, mayor y balanza (3 de 5 pantallas verificadas directamente; cuentas y detalle reutilizan los mismos componentes ya auditados) |

## Lo que NO hace

- **e-CF, 606, 607, 608.** Ver arriba — es `taxes`/`e-invoice`, necesita
  certificado digital real.
- **Posteo automático desde POS/AR/compras.** Cada venta o compra no
  genera un asiento solo todavía. Es la integración natural que sigue,
  pero construirla sin que nadie la haya pedido sería el mismo error que
  ya se evitó con el despachador de eventos.
- **Cierre de período.** No hay bloqueo de fechas pasadas ni cierre
  mensual/anual formal. Para un catálogo chico y sin la presión de F6
  completa, alcanza con la inmutabilidad del asiento; el cierre de período
  es candidato natural para cuando se construya `budgets`/`cost-centers`.
- **Plan de cuentas por defecto.** No hay una plantilla de catálogo
  dominicano pre-cargada — cada tenant arma el suyo desde cero.

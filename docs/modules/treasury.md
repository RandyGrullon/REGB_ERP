# `treasury` — Tesoreria & Bancos

**Que resuelve:** cuentas bancarias del negocio, sus movimientos y las
transferencias entre ellas. La tercera pieza -junto a `ar` y `ap`- de saber
cuanto dinero hay de verdad: no solo quien debe y a quien se le debe, sino
cuanto efectivo existe hoy y cuanto va a existir en las proximas semanas.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion · 19/69/190 mes

---

## El saldo se deriva, nunca se guarda

Mismo principio que `invoice_balance()`/`ap_invoice_balance()`:
`bank_account_balance(id)` = saldo inicial + depositos y entradas - retiros
y salidas, calculado siempre desde `bank_transactions`. Un saldo guardado a
mano se desincroniza el dia que se corrija un movimiento.

## Un movimiento registrado es inmutable desde el primer dia

Igual que un asiento contabilizado (0041) o el kardex (0019): ni se edita
ni se borra, ni siquiera como superusuario -los triggers de
`impedir_editar_movimiento()`/`impedir_editar_transferencia()` no hacen
excepcion por rol-. A diferencia de un asiento, aqui no hay ni siquiera un
estado "borrador": un movimiento nace definitivo porque no hay nada que
cuadrar antes de aceptarlo. Si algo se registro mal, se anota el movimiento
contrario -nunca se toca el original-.

## Una transferencia nunca queda a medias

Transferir entre dos cuentas propias no es una fila con dos IDs de cuenta:
el trigger `crear_movimientos_de_transferencia()` genera **las dos
mitades juntas** en `bank_transactions` (`transfer_out` en el origen,
`transfer_in` en el destino) en el mismo `insert`, para que nunca pueda
existir una transferencia con un solo lado registrado. Probado
explicitamente: `supabase/tests/treasury.test.ts` verifica que las dos
mitades aparecen atadas por `reference` y que borrar la transferencia esta
bloqueado -no puede dejar mitades huerfanas-.

## El mismo agujero que 0031/0040/accounting, tapado desde el primer dia

`bank_transactions` y `bank_transfers` tienen su propio `tenant_id`, asi
que su RLS de insercion solo compara ese valor contra `rls.tenant_id()` -no
revisa a quien pertenecen `bank_account_id`/`from_account_id`/
`to_account_id`-. `impedir_transaccion_cuenta_ajena()` e
`impedir_transferencia_cuenta_ajena()` cierran esto desde la migracion
original (0044), no como correccion posterior: mismo criterio que `ap` ya
aplico y que `accounting` tuvo que corregir reactivamente.

## Flujo de caja proyectado: logica pura, no una funcion SQL

La tercera promesa del catalogo -junto a cuentas bancarias y
transferencias- es una composicion de tres fuentes: el saldo bancario real,
lo que `ar` espera cobrar y lo que `ap` tiene que pagar. Esa composicion no
es una invariante de una tabla: es una regla de negocio, y vive en
`buildCashFlowProjection()` (`@regb/operations`), igual que `buildAging()`
ya hace lo mismo para la cartera de `ar`.

`treasury` **recomienda** `ar` y `ap`, no los **exige**: si el tenant no
los tiene activos, sus consultas a `customer_invoices`/`supplier_invoices`
simplemente devuelven cero filas -la propia RLS de esos modulos ya lo
garantiza (`rls.module_active('ar')`/`('ap')`)-, sin que tesoreria necesite
preguntarlo. La proyeccion queda con el efectivo plano, sin esas dos
columnas.

Una factura ya vencida (`due_date` en el pasado) cuenta en la semana 1: ya
deberia haber entrado o salido, no se pierde por quedar "en el pasado". Una
factura mas alla de las 8 semanas del horizonte simplemente no aparece -es
una proyeccion de lo que viene, no un historial de lo que paso-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/tesoreria` | `treasury.view` | Cuentas bancarias con saldo, transferir entre ellas, ultimos movimientos |
| `/tesoreria/:id` | `treasury.view` | Ficha de una cuenta: saldo, historial completo, registrar deposito o retiro |
| `/tesoreria/flujo` | `treasury.view` | Flujo de caja proyectado a 8 semanas |

## Manifiesto

- **Permisos:** `view`, `account.create`, `transaction.record`,
  `transfer.create`, `export`
- **Widgets:** `cash-position` (efectivo total en bancos),
  `cash-flow-warning` (primera semana en rojo, si la hay)
- **Reportes:** `cash-flow-projection`, `bank-statement`
- **Emite:** `treasury.transaction.recorded`, `treasury.transfer.recorded`
- **Requiere:** ninguno · **Recomienda:** `ar`, `ap`, `accounting`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/treasury.test.ts` — 15 casos: aislamiento, spoofing de tenant via cuenta ajena (bloqueado desde el primer dia, en movimientos y en transferencias), saldo derivado, las dos mitades de una transferencia, inmutabilidad (update/delete bloqueados incluso como dueno), modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `treasury.ts` — 17 pruebas, 100% de las ramas: saldo derivado, validacion de transferencia, proyeccion de flujo de caja (vencidas en semana 1, horizonte, semanas mixtas, primera semana en rojo) |
| 4 | UI web responsive | ✅ verificado en navegador: cuenta con movimientos, transferencia genera las dos mitades, flujo de caja con semana en rojo resaltada |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` desde el manifest, igual que `accounting` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ dos cuentas bancarias, tres movimientos y una transferencia entre ellas -la unica forma de ver las dos mitades juntas- |
| 9 | ≥2 widgets | ✅ `cash-position`, `cash-flow-warning` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 3 pantallas nuevas |

## Lo que NO hace

- **Conciliacion bancaria.** Comparar el estado de cuenta del banco contra
  estos movimientos, con emparejamiento automatico, es `bank-rec` (20),
  el modulo hermano del mismo sprint (S30/S31) -no construido todavia-.
- **Multimoneda.** Toda cuenta y todo movimiento es en pesos dominicanos.
  Cuentas en USD con tasa de cambio es `multicurrency` (26).
- **Conectarse al banco.** No hay integracion con ninguna API bancaria: el
  saldo inicial y cada movimiento se registran a mano. Un dia real de
  conexion bancaria en Republica Dominicana pasa por convenios caso por
  caso con cada banco, no por una API publica estandar.

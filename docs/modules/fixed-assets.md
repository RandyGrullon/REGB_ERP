# `fixed-assets` — Activos fijos

**Que resuelve:** alta, depreciacion (linea recta o acelerada), revaluo y
baja de vehiculos, equipos, mobiliario y demas activos del negocio.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `accounting`

---

## El saldo en libros se deriva, nunca se guarda

Mismo principio que `invoice_balance()`/`bank_account_balance()`:
`fixed_asset_book_value(id)` = base actual (costo original, o el ultimo
revaluo si lo hay) menos la depreciacion acumulada. Nada de esto se
guarda como columna -un valor guardado se desincroniza el dia que se
corrija un revaluo o se recalcule un periodo-.

## Dos metodos, una sola regla que ninguno rompe

`straight_line` (monto fijo cada mes) y `declining_balance` (saldos
decrecientes al doble de la tasa lineal -la forma mas comun de
"acelerada" en la practica contable dominicana-). Los dos comparten la
misma barrera: nunca depreciar por debajo del valor de rescate,
impuesta por un `least()`/`Math.min()` en la formula, no por una
validacion aparte. Documentado con honestidad en
`buildDepreciationSchedule()`: la acelerada normalmente **no** llega
exacto al valor de rescate dentro de la vida util nominal -es
asintotica por diseño-, y la linea recta con una vida que no divide
exacto puede dejar hasta un centavo sin depreciar al final. Ninguno de
los dos se esconde; los dos estan probados explicitamente en
`fixed-assets.test.ts` (paquete `@regb/operations`).

## Correr la depreciacion es idempotente

`run_fixed_asset_depreciation(tenant, periodo)` salta cualquier activo
que ya tenga su registro para ese `period_date` -el `unique (tenant_id,
asset_id, period_date)` lo garantiza, no una revision manual-. Correrla
dos veces el mismo dia por accidente no le cobra el gasto dos veces a
nadie.

## Revaluo y depreciacion: historicos, nunca se editan

Un revaluo no sobreescribe el anterior: cada uno queda como una fila
nueva con su fecha y su motivo, y la base actual siempre es "el ultimo
revaluo, o el costo si no hay ninguno". Igual que un movimiento
bancario (0044) o un asiento contabilizado (0041), ni una depreciacion
ni un revaluo se editan ni se borran -corrige con el registro que
corresponda, nunca tocando el original-.

## El mismo agujero de siempre, tapado desde el primer dia

`fixed_asset_depreciations` y `fixed_asset_revaluations` tienen su
propio `tenant_id`, asi que la RLS de insercion solo compara ese valor
-no revisa a quien pertenece `asset_id`-. `impedir_activo_ajeno()`
cierra esto desde la migracion original (0046) para las dos tablas a
la vez -misma forma de fila, misma funcion-, mismo criterio que `ap`
(0042), `treasury` (0044) y `bank-rec` (0045) ya aplicaron.

## Simplificacion declarada: el revaluo no postea a patrimonio

El catalogo promete "revaluo" y aqui se cumple en su forma util para
una PYME: se registra el nuevo valor, con su motivo y su fecha, y la
depreciacion futura se recalcula sobre el. Lo que NO hace es generar el
asiento de superavit/deficit de revaluacion contra patrimonio -eso pide
que `accounting` sepa recibir asientos automaticos desde otro modulo,
una pieza que todavia no existe para ninguno-. Se documenta aqui, no se
esconde.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/activos-fijos` | `fixed-assets.view` | Lista con valor en libros, alta, correr depreciacion del dia |
| `/activos-fijos/:id` | `fixed-assets.view` | Calendario completo, historial, revaluar, dar de baja |

## Manifiesto

- **Permisos:** `view`, `asset.create`, `depreciation.run`,
  `asset.revalue`, `asset.dispose`, `export`
- **Widgets:** `fixed-assets-book-value`, `fixed-assets-due-this-month`
- **Reportes:** `depreciation-schedule`, `fixed-asset-register`
- **Emite:** `fixed-assets.asset.created`, `fixed-assets.depreciation.run`,
  `fixed-assets.asset.disposed`
- **Requiere:** ninguno · **Recomienda:** `accounting`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/fixed-assets.test.ts` — 18 casos: aislamiento, spoofing de tenant en depreciacion/revaluo, revaluar activo ajeno por la funcion, depreciacion idempotente, inmutabilidad de depreciacion/revaluo/activo-de-baja, modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `fixed-assets.ts` — 14 pruebas: saldo en libros, tope de rescate en los dos metodos, calendario completo, casos de redondeo declarados, ganancia/perdida en baja |
| 4 | UI web responsive | ✅ verificado en navegador: activo con historial parcial, calendario de 60 meses, revaluo aplicado en vivo y reflejado en el saldo en libros y en el calendario |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un vehiculo activo con 3 meses de historial en linea recta, un equipo dado de baja con 6 meses de historial en acelerada |
| 9 | ≥2 widgets | ✅ `fixed-assets-book-value`, `fixed-assets-due-this-month` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas nuevas |

## Lo que NO hace

- **Postear el revaluo o la depreciacion contra `accounting`.** Ver
  arriba: ningun modulo tiene todavia auto-contabilizacion desde otro.
- **Multimoneda.** Todo activo se registra en pesos dominicanos.
- **Cambiar de metodo a mitad de la vida util de un activo.** Una
  practica real -y compleja- que se deja para una mejora; hoy el
  metodo se fija al dar de alta.

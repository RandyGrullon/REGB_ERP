# `budgets` — Presupuestos

**Que resuelve:** el plan de gasto e ingreso por cuenta y por mes,
comparado siempre contra lo que de verdad se contabilizo.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `accounting` · **Recomienda:** `cost-centers`

---

## Requiere `accounting` de verdad, aunque el catalogo decia otra cosa

`budget_lines` referencia `public.accounts` -sin cuentas no hay contra
que presupuestar-. La siembra original del catalogo (0009) traia
`requires='{}'` para este modulo porque se sembro antes de decidir esta
dependencia; se corrigio en la migracion 0047, mismo criterio que la
0043 ya aplico para `accounting`/`ap`: el manifest real es la fuente de
verdad, no la copia de exhibicion del marketplace.

## El real se lee en la misma direccion que el presupuesto

Reusa `accountBalance()` de `accounting.ts` sin reinventar el signo:
para una cuenta de gasto, presupuestar RD$50,000 es "planeo gastar
hasta ahi", y el real se lee igual de deudor; para una cuenta de
ingreso, presupuestar RD$50,000 es "espero ganar eso", y el real se lee
igual de acreedor. La misma formula sirve para las dos sin distinguir
casos -ver `buildBudgetVsActual()` en `@regb/operations`-.

## El semaforo avisa antes de pasarse

`budgetStatus()` marca `warning` al 90% de lo presupuestado -no hay que
esperar a llegar al 100% para enterarse-, y marca `over` a cualquier
cuenta con gasto real y **ningun** monto planeado: es la senal mas
seria posible, un gasto que nadie previo en absoluto.

## Una linea de presupuesto SI se edita: es un plan, no dinero ya movido

A diferencia de un asiento contabilizado (0041) o un movimiento
bancario (0044), una linea de presupuesto se edita libremente mientras
el presupuesto este en `draft` o `active` -es una proyeccion que
naturalmente se revisa, no un hecho ya ocurrido-. Cerrar el presupuesto
(`status = 'closed'`) es lo que lo congela: ni el presupuesto ni sus
lineas se editan despues, mismo criterio de congelamiento que un activo
dado de baja (0046).

## El mismo agujero de siempre, tapado desde el primer dia

`budget_lines` tiene su propio `tenant_id`, asi que la RLS de insercion
solo compara ese valor -no revisa a quien pertenecen `budget_id` ni
`account_id`-. `impedir_linea_presupuesto_ajena()` cierra las dos
referencias desde la migracion original (0047), mismo criterio que
`ap`, `treasury`, `bank-rec` y `fixed-assets` ya aplicaron.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/presupuestos` | `budgets.view` | Lista de presupuestos por ano, crear uno nuevo |
| `/presupuestos/:id` | `budgets.view` | Poner monto por cuenta y mes, comparativo real vs. presupuesto, activar/cerrar |

## Manifiesto

- **Permisos:** `view`, `budget.create`, `line.set`, `budget.close`, `export`
- **Widgets:** `budget-alerts`, `budget-ytd-variance`
- **Reportes:** `budget-vs-actual`
- **Emite:** `budgets.budget.created`, `budgets.budget.closed`
- **Requiere:** `accounting` · **Recomienda:** `cost-centers`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/budgets.test.ts` — 11 casos: aislamiento, spoofing de tenant en linea via presupuesto ajeno y via cuenta ajena, presupuesto propio funciona normal, congelamiento al cerrar (linea y status), modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `budgets.ts` — 12 pruebas: semaforo en sus bordes exactos (90%, 100%, sin presupuesto), comparativo para gasto e ingreso, variancePercent null sin presupuesto |
| 4 | UI web responsive | ✅ verificado en navegador con datos reales: cuentas sin presupuestar marcadas en rojo, cuenta sobrepasada al 125%, mes futuro todavia sin ejecutar |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un presupuesto activo comparado contra el asiento ya sembrado por `accounting`, sin inventar una segunda entrada |
| 9 | ≥2 widgets | ✅ `budget-alerts`, `budget-ytd-variance` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas nuevas |

## Lo que NO hace

- **Presupuestar por centro de costo o por proyecto.** Hoy es solo por
  cuenta -la unica dimension real disponible-. Por centro llega con
  `cost-centers`.
- **Distinguir si "sobrepasado" es bueno o malo segun el tipo de
  cuenta.** El semaforo es el mismo para una cuenta de gasto (pasarse
  es malo) y una de ingreso (pasarse podria ser una buena noticia): la
  lectura correcta depende de quien mira el reporte, no la decide el
  sistema.
- **Filtrar cuentas de balance (activo/pasivo) del comparativo.** Una
  cuenta como caja o cuentas por cobrar puede aparecer "sobrepasada"
  simplemente por tener actividad real sin monto planeado -tecnicamente
  correcto, pero puede ser ruido si nunca se pensaba presupuestar esas
  cuentas en primer lugar-.

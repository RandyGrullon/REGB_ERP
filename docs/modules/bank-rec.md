# `bank-rec` — Conciliacion bancaria

**Que resuelve:** importar el estado de cuenta que da el banco y
conciliarlo contra lo que `treasury` (19) ya tiene registrado. El
hermano de la misma fase: `treasury` dice cuanto crees que tienes,
`bank-rec` confirma que el banco esta de acuerdo.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `treasury` · **Recomienda:** `accounting`

---

## "IA" honesta: un heuristico, no un modelo entrenado

El catalogo (§5.2) promete "emparejamiento asistido con IA". Lo que se
construyo es lo que de verdad se puede defender sin inflar la promesa:
`suggestMatches()` (`@regb/operations`) propone por **monto exacto +
mismo signo + fecha cercana** (ventana configurable, 5 dias por
defecto) -nada entrenado, nada probabilistico-. Y es SIEMPRE una
sugerencia: el sistema nunca concilia solo, una persona confirma cada
emparejamiento con un clic (o elige otro movimiento distinto de la
lista si la sugerencia esta mal).

## Resuelve primero lo que tiene menos opciones

Si dos lineas del estado podrian coincidir con el mismo movimiento
-mismo monto, fechas parecidas-, procesarlas en el orden en que llegan
puede dejarle el movimiento correcto a la linea equivocada y sin nada a
la que en realidad no tenia otra opcion. `suggestMatches()` ordena
primero por **cantidad de candidatos**, no por orden de llegada: la
linea con un solo candidato posible se resuelve antes que la que tiene
varios. Probado explicitamente en `bank-rec.test.ts` con un caso donde
el orden naive falla y el orden por escasez no.

## Un movimiento, una sola conciliacion

`bank_transactions` y `bank_statement_lines` viven en tablas separadas
a proposito -no se le agrega una columna "conciliado" a
`bank_transactions`, porque un movimiento no sabe nada de estados de
cuenta, y menos aun de la conciliacion del mes que viene-. La garantia
de que un movimiento no se concilie dos veces es un **indice unico
parcial** sobre `matched_transaction_id` (`where matched_transaction_id
is not null`), no una regla de aplicacion que alguien podria saltarse
con un `insert` directo.

## El mismo agujero de siempre, tapado desde el primer dia

`bank_statement_imports`/`bank_statement_lines` tienen su propio
`tenant_id`, asi que la RLS de insercion solo compara ese valor -no
revisa a quien pertenece `bank_account_id`, ni si una linea de verdad es
de la misma cuenta que su import, ni si el movimiento que se le quiere
asignar es de esa cuenta-. `impedir_import_cuenta_ajena()` e
`impedir_linea_ajena()` cierran todo eso desde la migracion original
(0045), mismo criterio que `ap` (0042) y `treasury` (0044) ya
aplicaron.

## Ignorar no es borrar

Una linea que nunca va a tener pareja -una comision que se registro
distinto en otro lado, un cargo que no aplica- se marca `ignored`, no
se elimina: sigue en el historial del import, y se puede reactivar si
la decision estuvo mal.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/conciliacion` | `bank-rec.view` | Lista de imports, importar estado (pegar lineas) |
| `/conciliacion/:id` | `bank-rec.view` | Lineas del import, sugerencia, confirmar/deshacer/ignorar |

## Manifiesto

- **Permisos:** `view`, `import.create`, `match.confirm`, `export`
- **Widgets:** `pending-reconciliation`, `last-import-status`
- **Reportes:** `reconciliation-status`
- **Emite:** `bank-rec.import.created`, `bank-rec.line.matched`
- **Requiere:** `treasury` · **Recomienda:** `accounting`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/bank-rec.test.ts` — 13 casos: aislamiento, spoofing de tenant en import/linea, linea con cuenta distinta a su import, match contra movimiento de otra cuenta, doble conciliacion bloqueada por el indice unico, desconciliar, modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `bank-rec.ts` — 11 pruebas: signo, monto exacto, ventana de dias, orden por escasez de candidatos, resumen de conciliacion |
| 4 | UI web responsive | ✅ verificado en navegador: import creado pegando lineas, sugerencia automatica confirmada, linea sin candidato ignorada y reactivada, deshacer una conciliacion |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un import con las 3 situaciones reales: linea ya conciliada, pendiente con candidato obvio, pendiente sin candidato -una comision que el banco cobro y nadie registro- |
| 9 | ≥2 widgets | ✅ `pending-reconciliation`, `last-import-status` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'advanced'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas nuevas |

## Lo que NO hace

- **Importar CSV/OFX del banco directamente.** Las lineas se pegan como
  texto (`fecha,descripcion,monto`, una por renglon) y se parsean en el
  servidor. Un parser de los formatos reales de cada banco dominicano
  -que ni siquiera son iguales entre si- es trabajo real y se deja para
  una mejora, no una promesa de esta version.
- **Conciliar automaticamente sin confirmacion.** Ni la sugerencia con
  mas confianza se aplica sola. Es una decision de diseno, no una
  limitacion tecnica: una conciliacion mal hecha rompe la confianza en
  todo el saldo bancario.
- **Multimoneda.** Como `treasury`, todo es en pesos dominicanos.

# `performance` — Desempeno

**Que resuelve:** OKR con progreso calculado, evaluacion 360, 1:1 con
memoria y planes de mejora con fecha de cierre.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `employees`

---

## El progreso nunca se guarda

`progresoResultadoClave()` y `progresoObjetivo()` (`@regb/operations`)
derivan siempre el porcentaje del valor actual contra la meta -mismo
principio que el saldo de vacaciones o el saldo de un prestamo-. Lo
unico que se escribe es `current_value`, cada vez que alguien registra
avance; el porcentaje se calcula en cada lectura, nunca se guarda como
columna que podria desincronizarse.

## No todo necesita un candado de inmutabilidad

A diferencia de casi todos los modulos de F6/F7, aqui la mayoria de las
tablas **no llevan trigger de inmutabilidad**, a proposito: un
objetivo se actualiza seguido, una nota de 1:1 se corrige despues de la
reunion, y forzarlos a comportarse como un asiento contabilizado no
refleja como se usan de verdad. Solo dos tablas si lo necesitan, y por
razones distintas:

- **`performance_reviews`** (una evaluacion): inmutable **desde el
  primer momento**, sin condicion de estado -no hay un flujo de
  "borrador", se inserta ya enviada, y una vez enviada es un hecho
  fijo-. Mismo criterio que `benefit_loan_payments`.
- **`performance_improvement_plans`** (un plan de mejora): editable
  mientras esta `active`, inmutable una vez `completed` o `cancelled`
  -mismo criterio que `benefit_loans` o `expenses`-.

## Evaluacion 360: el promedio se deriva, no se pide

`promedioEvaluacion360()` promedia las calificaciones de todos los que
evaluaron a un empleado en un mismo ciclo -auto-evaluacion, jefe,
pares, reportes directos-, calculado siempre a partir de las filas
individuales, nunca guardado como un numero aparte.

## El mismo agujero de siempre, en cinco tablas

`performance_objectives.employee_id` es **nullable** -un objetivo
puede ser de toda la empresa, no solo de un empleado-, asi que
`impedir_objetivo_ajeno()` valida la referencia solo cuando no es nula.
`performance_key_results.objective_id` referencia el objetivo padre, no
un empleado directamente. Las otras tres tablas (`performance_one_on_ones`,
`performance_reviews`, `performance_improvement_plans`) comparten la
misma forma de referencia -un `employee_id` obligatorio- y reutilizan
una sola funcion de trigger para las tres, mismo patron de reuso que
`impedir_referencia_ajena_empleado()` en `employees` para
`branch_id`/`manager_id`.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/desempeno` | `performance.view` | OKR con progreso derivado, 1:1, evaluaciones 360, planes de mejora -las cuatro secciones del catalogo en una sola pantalla- |

## Manifiesto

- **Permisos:** `view`, `manage-objectives`, `manage-one-on-ones`, `submit-review`, `manage-improvement-plans`
- **Widgets:** `objectives-progress`, `improvement-plans-active`
- **Reportes:** `okr-progress`, `review-summary`
- **Emite:** `performance.objective.created`, `performance.review.submitted`, `performance.improvement-plan.created`
- **Requiere:** `employees`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/performance.test.ts` — 14 casos: aislamiento de las cinco tablas, spoofing de tenant via empleado u objetivo ajenos, una evaluacion nunca editable, un plan de mejora editable mientras esta activo pero inmutable una vez resuelto, modulo apagado, checks de tabla |
| 3 | Logica pura con cobertura | ✅ `performance.ts` — 10 pruebas: progreso de un resultado clave (incluida la meta en cero), progreso de un objetivo como promedio de sus KR, promedio de una evaluacion 360 |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: progreso de un KR actualizado en vivo con el porcentaje del objetivo recalculandose de inmediato, un plan de mejora completado en vivo, un 1:1 cerrado en vivo -y una sonda de accesibilidad que encontro un input y un boton sin nombre accesible, corregido antes de dar el modulo por terminado-. |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un objetivo con dos resultados clave en progreso parcial, un 1:1 agendado, dos evaluaciones del mismo ciclo -para ver el promedio 360-, y un plan de mejora activo |
| 9 | ≥2 widgets | ✅ `objectives-progress`, `improvement-plans-active` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos -despues de corregir el input de progreso y el boton de guardar que la primera pasada encontro sin nombre accesible-, sin ids duplicados, `<main>` presente |

## Lo que NO hace

- **Enviar recordatorios de 1:1 o de evaluaciones pendientes.** El
  modulo registra lo que ya paso o esta agendado; no dispara
  notificaciones automaticas todavia.
- **Imponer quien debe evaluar a quien.** Cualquiera con permiso puede
  enviar una evaluacion de cualquier tipo -no hay un flujo de "ciclo de
  evaluacion" que asigne evaluadores automaticamente-.
- **Vincular un plan de mejora a una consecuencia laboral.** Registra el
  motivo, las metas y el resultado; no se conecta con `employees` para
  cambiar el estado del empleado.

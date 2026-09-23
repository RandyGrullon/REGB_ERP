# `expenses` — Gastos & Reembolsos

**Que resuelve:** de la nota del gasto al reembolso, con el ITBIS
deducible calculado si el proveedor dio un NCF valido -no adivinado-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `employees` · **Recomienda:** `payroll`

---

## Honesto sobre el OCR desde el manifest

El catalogo promete "foto del recibo con OCR" (§5.6): eso pide un
servicio de vision por computadora con credenciales que este sistema
no tiene, mismo criterio que el biometrico de `attendance` o el
gateway de `payments`. El monto, la fecha y el proveedor los escribe
quien reporta el gasto -no se procesa ninguna foto automaticamente-.

## El ITBIS deducible se calcula, no se adivina

`esDeducibleDeItbis(ncf)` (`@regb/operations`) reutiliza `isValidNcf()`
de `dgii.ts` -el mismo validador que ya usa el modulo de facturacion-:
un gasto con un NCF fiscal valido del proveedor es deducible de ITBIS
para la empresa; uno sin NCF se reembolsa igual al empleado, pero la
empresa no puede acreditarse el ITBIS. `itbisIncluidoEn()` extrae la
porcion de ITBIS de un monto bruto cuando hace falta el desglose. Este
calculo se muestra siempre en pantalla, nunca se guarda como columna:
si el NCF resultara invalido despues, no habria un numero guardado
desincronizado que corregir.

## Reembolso en nomina: llega al volante (0132)

Un gasto reembolsado con metodo `payroll` y un `payroll_period_id` se
PAGA en esa nomina: al procesarla, `payroll` lo suma al neto del
empleado como ingreso **no gravado** (columna `reimbursements`: no es
base de TSS ni de ISR). Si el empleado no cobra salario en ese periodo,
igual se le hace una linea con el reembolso.

Solo se puede apuntar a un periodo en **borrador** (trigger
`no_nomina_cerrada`): apuntar a una nomina ya procesada era darlo por
pagado sin que nadie lo pagara. El estado pasa a `reimbursed` al
asignarlo, antes de que la nomina se procese: el pago real ocurre al
procesar ese periodo.

## `approved` no es un estado terminal

A diferencia de `time-off` (donde `pending → resuelto` es la unica
transicion), aqui `approved` todavia puede avanzar a `reimbursed`: el
trigger de inmutabilidad bloquea editar o borrar solo cuando
`OLD.status` ya es `rejected` o `reimbursed` -los dos estados
verdaderamente finales-. `submitted → approved` y `approved →
reimbursed` son ambas transiciones validas.

## El mismo agujero de siempre, con una variante nueva

`expenses.employee_id` referencia `public.employees` -mismo patron de
0031-. Pero `expenses.payroll_period_id` tambien referencia una tabla
de otro modulo (`payroll_periods`), y ese campo se rellena en un
**update** posterior (al reembolsar), no en el insert original: por
eso `impedir_gasto_ajeno()` dispara en `before insert OR update`, no
solo `insert` como el resto de los triggers de este patron -la unica
vez en la serie 0031-0055 que la referencia cruzada se valida tambien
en la actualizacion, porque es la unica vez que esa referencia se
rellena despues de crear la fila-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/gastos` | `expenses.view` | Reportar un gasto, ver todos los gastos con su ITBIS deducible calculado |
| `/gastos/aprobar` | `expenses.approve` | Cola de reportados por aprobar, y de aprobados por reembolsar |

## Manifiesto

- **Permisos:** `view`, `submit`, `approve`, `reimburse`, `export`
- **Widgets:** `expenses-pending`, `expenses-owed`
- **Reportes:** `expenses-by-category`, `itbis-deductible`
- **Emite:** `expenses.expense.submitted`, `expenses.expense.approved`, `expenses.expense.rejected`, `expenses.expense.reimbursed`
- **Requiere:** `employees` · **Recomienda:** `payroll`
- **Movil:** `platforms.mobile = true`, `mobileScope: ['view', 'submit']`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/expenses.test.ts` — 12 casos: aislamiento, spoofing de tenant via empleado ajeno Y via periodo de nomina ajeno (los dos con el PROPIO tenant_id), `approved` avanzando a `reimbursed` con exito, un gasto rechazado o reembolsado no se edita ni se borra, modulo apagado, checks de tabla (monto invalido, categoria/metodo de reembolso inventados) |
| 3 | Logica pura con cobertura | ✅ `expenses.ts` — 10 pruebas: ITBIS incluido en un monto bruto, deducibilidad segun NCF (reutilizando `isValidNcf`), total pendiente de reembolso, desglose por categoria |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: gasto reportado en vivo con NCF valido (badge "Deducible" correcto), aprobado en vivo, reembolsado en vivo con metodo nomina y periodo real seleccionado -confirmado en la base que `payroll_period_id` quedo bien enlazado- |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un gasto reportado sin resolver, uno aprobado esperando reembolso con NCF valido (deducible), y uno ya reembolsado por transferencia -los tres estados visibles junto con `rejected` posible via la cola de aprobacion- |
| 9 | ≥2 widgets | ✅ `expenses-pending`, `expenses-owed` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre, sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Leer la foto del recibo automaticamente.** No hay OCR real -eso
  pide un servicio de vision por computadora con credenciales que este
  sistema no tiene-. El monto, la fecha y el proveedor se escriben a
  mano.
- **Reembolsar por nomina sin periodo.** Con metodo `payroll` y "Sin
  periodo" el gasto queda `reimbursed` y ninguna nomina lo paga: la
  pantalla de aprobar deberia exigir el periodo en ese caso (pendiente del
  dueño de `expenses`).
- **Politicas de gasto por categoria o limite de monto.** Cualquier
  monto en cualquier categoria se puede reportar; la aprobacion es
  manual y sin un limite automatico que la bloquee.

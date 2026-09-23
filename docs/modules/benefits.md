# `benefits` — Beneficios

**Que resuelve:** prestamos internos y adelantos con cuota y saldo
calculados de verdad, e inscripcion a planes de seguro con el aporte
patronal siempre a la vista.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `employees` · **Recomienda:** `payroll`

---

## Honesto sobre la aseguradora desde el manifest

El catalogo promete "seguros" (§5.6): eso implicaria procesar reclamos
ante una ARS o aseguradora real, una integracion que este sistema no
tiene -mismo criterio que el gateway de `payments` o el OCR de
`expenses`-. Lo que si se resuelve es el registro honesto: quien esta
inscrito en que plan, y cuanto aporta el empleado y cuanto la empresa.

## La cuota se calcula, el saldo se deriva -nunca al reves-

`cuotaPrestamo()` (`@regb/operations`) implementa el sistema frances de
amortizacion; con tasa 0 -el caso tipico de un prestamo interno sin
interes- es una simple division. Se calcula UNA vez al crear el
prestamo y se guarda como el compromiso acordado -como `business_days`
en `time-off` o `installment_amount` aqui mismo-. El saldo, en cambio,
**nunca se guarda**: `saldoPrestamo()` lo deriva siempre del principal
menos la suma de los pagos reales en `benefit_loan_payments`.

## Dos niveles de inmutabilidad en la misma tabla de prestamos

- **`benefit_loans`** (el prestamo) es editable mientras esta `active`,
  e inmutable una vez `paid` o `cancelled` -mismo patron que `approved`
  en `expenses`: el estado intermedio SI se puede seguir modificando-.
- **`benefit_loan_payments`** (cada pago) es inmutable **desde el
  primer momento**, sin condicion de estado -igual que un asiento
  contabilizado-: ni siquiera con el prestamo todavia activo se puede
  editar o borrar un pago ya registrado. Es la unica tabla de la serie
  0031-0057 con un trigger de inmutabilidad incondicional en vez de
  "una vez que el estado sea X".

Cuando el saldo de un pago llega a cero, `registrarPago()`
(`apps/web/src/app/beneficios/actions.ts`) marca el prestamo `paid`
automaticamente en la misma transaccion -no hace falta un paso manual
aparte-.

## El mismo agujero de siempre, con la misma variante de `expenses`

`benefit_loans.employee_id` y `benefit_enrollments.employee_id`
referencian `employees` -patron 0031 estandar-.
`benefit_loan_payments.loan_id` y `.payroll_period_id` referencian
otras dos tablas de tenant; como `payroll_period_id` puede rellenarse
en el mismo insert del pago (no en un update posterior, a diferencia de
`expenses`), `impedir_pago_prestamo_ajeno()` valida ambas referencias
en el `insert`, sin necesitar la variante de `update` que si hizo falta
en `expenses`.

## Descuento por nomina (0132)

Al procesar un periodo, `payroll` descuenta de cada prestamo activo del
empleado la cuota (mensual) por la fraccion del periodo -media cuota por
quincena-, nunca mas que el saldo y nunca dejando el neto en negativo (lo
que no alcanza sigue en el saldo). Registra el pago aqui
(`source = 'payroll'`, `payroll_period_id`) y marca `paid` el prestamo que
llega a cero, en la misma transaccion que la linea de nomina. Un pago que
alguien registra a mano con un periodo de nomina se descuenta en esa
nomina tal cual, sin duplicarlo. Un pago solo puede apuntar a un periodo
en BORRADOR: apuntar a uno ya procesado era darlo por pagado sin que la
nomina lo descontara (trigger `no_nomina_cerrada`).

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/beneficios` | `benefits.view` | Prestamos y adelantos con saldo calculado, registrar cuota, crear uno nuevo |
| `/beneficios/planes` | `benefits.manage-enrollments` | Inscripciones a planes, costo patronal total, inscribir o cancelar |

## Manifiesto

- **Permisos:** `view`, `manage-loans`, `record-payment`, `manage-enrollments`
- **Widgets:** `loans-outstanding`, `benefits-cost`
- **Reportes:** `loan-balances`, `enrollment-summary`
- **Emite:** `benefits.loan.created`, `benefits.loan.payment-recorded`, `benefits.loan.paid`, `benefits.enrollment.created`, `benefits.enrollment.cancelled`
- **Requiere:** `employees` · **Recomienda:** `payroll`
- **Plataformas:** web y escritorio -sin movil, `platforms.mobile = false`-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/benefits.test.ts` — 13 casos: aislamiento de prestamos/pagos/inscripciones, spoofing de tenant via empleado, periodo de nomina y prestamo ajenos (todos con el PROPIO tenant_id), un pago inmutable desde el primer momento -incluso con el prestamo activo-, un prestamo editable mientras esta activo pero inmutable una vez saldado, modulo apagado, checks de tabla |
| 3 | Logica pura con cobertura | ✅ `benefits.ts` — 10 pruebas: cuota sin interes y con el sistema frances, saldo derivado de los pagos, si un prestamo esta saldado, aporte patronal total |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: cuota pagada en vivo con el saldo bajando de inmediato, prestamo nuevo creado con la cuota calculada por el servidor (no por el usuario), inscripcion cancelada en vivo con el costo patronal recalculado |
| 5 | UI movil | N/A — el modulo declara `platforms.mobile = false` a proposito |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un prestamo activo con dos cuotas ya pagadas -saldo parcial visible-, un adelanto ya saldado por completo, y dos inscripciones a un plan de seguro |
| 9 | ≥2 widgets | ✅ `loans-outstanding`, `benefits-cost` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre, sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Procesar reclamos ante una ARS o aseguradora real.** Registra quien
  esta inscrito en que plan y cuanto aporta cada quien -no hay
  integracion con ninguna aseguradora-.
- **Cobrar el interes en el saldo.** `saldoPrestamo()` es principal menos
  pagos: un prestamo con interes se da por saldado antes de cobrar todas
  sus cuotas (hallazgo del analisis de flujo, sin cerrar). La nomina usa
  ese mismo saldo, asi que hereda el problema.
- **Editar un pago ya registrado, bajo ninguna circunstancia.** Ni con
  el prestamo todavia activo. Un error se corrige con un ajuste nuevo,
  nunca editando el hecho historico.

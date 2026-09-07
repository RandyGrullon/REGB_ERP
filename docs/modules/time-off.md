# `time-off` — Vacaciones & Permisos

**Que resuelve:** solicitud, aprobacion y saldo de vacaciones calculado
de verdad -Codigo de Trabajo Art. 177-, no a ojo.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `employees`

---

## El saldo NUNCA se guarda

`saldoVacaciones()` (`@regb/operations`) se deriva siempre de la fecha
de contratacion y de lo ya aprobado -mismo principio que el saldo de
una factura, el saldo en libros de un activo fijo, o el saldo TSS de un
volante de nomina-. `vacacionesAcumuladas()` implementa el Art. 177:
14 dias laborables por año durante los primeros cuatro, 18 dias
laborables por año a partir del quinto -y solo los años *completos*
cuentan: 11 meses de antiguedad no acumulan nada-.

## Solo el tipo `vacation` tiene saldo legal

El resto de los tipos de ausencia (enfermedad, personal, maternidad,
paternidad, duelo, otro) se registran y se aprueban exactamente igual,
pero el sistema no calcula un saldo para ellos: eso pide certificacion
medica y reglas -cuantos dias de maternidad, si el empleador cubre el
100% o la TSS, excepciones por convenio- que no se pueden verificar
aqui. Declarado en el manifest, en la migracion y aqui.

## Dias laborables, no dias calendario

`diasLaborablesEntre()` cuenta solo lunes a viernes -sabado y domingo
no cuentan-, calculado una vez al crear la solicitud y guardado en
`business_days` como hecho historico (mismo patron que `within_geofence`
de `attendance`): si mas adelante cambia algo, la solicitud de ayer no
debe releerse distinta.

## Una solicitud resuelta es inmutable

`pending → approved/rejected/cancelled` es la unica transicion valida;
una vez resuelta, no se edita ni se borra -una correccion se hace con
una solicitud nueva-. El trigger compara el estado ANTERIOR de la fila
(`OLD.status <> 'pending'`), asi que la transicion misma si pasa: solo
se bloquea editar o borrar una vez que ya salio de `pending`.

Esta misma regla mordio la limpieza de los datos de prueba: la primera
version de `afterAll()` en el test de aislamiento borraba las filas
sin desactivar el trigger primero, y el borrado fallaba con "ya fue
resuelta y no se edita" -exactamente lo que el trigger deberia hacer,
pero rompiendo la limpieza del propio test-. Corregido copiando el
patron ya usado en `payroll.test.ts`: `disable trigger` antes de
borrar, `enable trigger` despues. Una version intermedia de este mismo
arreglo, corrida una sola vez a mano contra Docker local, dejó el
trigger deshabilitado en la base compartida entre corridas -sin el
`enable` de vuelta-, y la siguiente corrida de `gate:f0` paso de largo
las dos pruebas de inmutabilidad sin que nadie lo notara hasta leer el
resultado con cuidado. Ninguno de los dos era un agujero de seguridad,
pero ambos son un recordatorio de que un trigger deshabilitado a mano
en una base persistente no se revierte solo.

## El mismo agujero de siempre, tapado desde el primer dia

`time_off_requests.employee_id` referencia `public.employees`.
`impedir_solicitud_ausencia_ajena()` tapa el mismo patron de 0031 en la
tabla nueva.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/vacaciones` | `time-off.view` | Saldo por empleado, solicitudes recientes, nueva solicitud, cancelar una propia pendiente |
| `/vacaciones/aprobar` | `time-off.approve` | Cola de solo lo pendiente: aprobar o rechazar |

## Manifiesto

- **Permisos:** `view`, `request`, `approve`, `export`
- **Widgets:** `time-off-pending`, `team-out-today`
- **Reportes:** `time-off-balance`, `absence-report`
- **Emite:** `time-off.request.requested`, `time-off.request.approved`, `time-off.request.rejected`
- **Requiere:** `employees`
- **Movil:** `platforms.mobile = true`, `mobileScope: ['view', 'request']`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/time-off.test.ts` — 12 casos: aislamiento, spoofing de tenant via empleado ajeno con el PROPIO tenant_id, una solicitud resuelta no se edita ni se borra (aprobar funciona, un segundo intento de editar o borrar se rechaza), modulo apagado, checks de tabla (fecha de fin antes que inicio, cero dias laborables, tipo/estado invalido) |
| 3 | Logica pura con cobertura | ✅ `time-off.ts` — 16 pruebas: dias laborables entre fechas (incluido cruzar un fin de semana), la tabla de dias por año de servicio, acumulado multi-año, saldo nunca negativo |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: solicitud creada en vivo, aprobada en vivo (el saldo del empleado bajo de inmediato), cancelada en vivo, y la cola de aprobacion vaciandose al resolver su unica pendiente |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una vacacion ya tomada y aprobada (reduce el saldo mostrado), una pendiente por aprobar, y un permiso personal rechazado -los tres estados visibles de una vez- |
| 9 | ≥2 widgets | ✅ `time-off-pending`, `team-out-today` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre (incluidos los envueltos en `<label>`, que la primera version de la sonda no detectaba y se corrigio antes de confiar en el resultado), sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Calcular un saldo legal para enfermedad, maternidad, paternidad o
  duelo.** Se registran y se aprueban igual, pero sin un numero de dias
  disponibles -esas licencias dependen de certificacion medica y reglas
  que este sistema no puede verificar-.
- **Bloquear una solicitud que exceda el saldo mostrado.** El saldo es
  informativo: el aprobador decide si autoriza dias sin acumular
  -algunas empresas si lo permiten-, el sistema no impone la regla.
- **Calendario visual tipo agenda.** El widget `team-out-today` y la
  tabla de solicitudes muestran quien esta fuera y cuando, pero no hay
  todavia una vista de calendario mensual con celdas por dia.

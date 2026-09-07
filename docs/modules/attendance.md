# `attendance` — Asistencia & Ponches

**Que resuelve:** marcaje de entrada/salida validado por geocerca real,
con horas extra y tardanza siempre calculadas de la hora real -nunca
escritas a mano-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `employees` · **Recomienda:** `payroll`

---

## Honesto sobre el biometrico desde el manifest

El catalogo promete "marcaje", no huella digital: eso es hardware que
este sistema no controla. Lo que SI se resuelve de verdad es la
geocerca -`haversineDistanceMeters()`/`isWithinGeofence()`
(`@regb/operations`), formula real sobre latitud/longitud, no una
casilla que cualquiera puede marcar-. `check_in_method` acepta
`manual`, `qr` o `geofence`; el biometrico queda fuera, declarado en el
manifest, en la migracion y aqui.

## `within_geofence` se calcula una vez y se guarda como hecho historico

La validacion de geocerca ocurre en TypeScript (`marcarEntrada()`,
`apps/web/src/app/asistencia/actions.ts`), nunca en SQL: si mas
adelante alguien cambia el radio de una sucursal, el marcaje de ayer no
debe leerse distinto. `within_geofence` es una columna, no una vista.

## Un solo marcaje abierto por empleado

`unique index ... where check_out is null` sobre `employee_id`: un
empleado no puede entrar dos veces sin haber marcado salida primero -el
sistema no depende de que alguien se de cuenta-. `check_out_attendance()`
(security definer) es la unica puerta para cerrar un marcaje: valida
tenant, que no este ya cerrado, y que la salida sea posterior a la
entrada.

## El agujero de siempre, tapado desde el primer dia

`attendance_geofences.branch_id` y `attendance_records.employee_id`
referencian tablas de otro modulo. `impedir_geocerca_ajena()` e
`impedir_marcaje_ajeno()` tapan el mismo patron de 0031 en las dos
tablas nuevas.

## Dos bugs reales encontrados en verificacion en vivo -no en el review de codigo-

Ninguno de los dos era un agujero de seguridad; los dos hacian que la
tardanza o el cierre de un marcaje se calcularan mal, y solo aparecieron
al usar la pantalla de verdad:

1. **La "hora esperada" se calculaba en la zona horaria del servidor,
   no la de RD.** La primera version hacia `new Date(entrada);
   esperado.setHours(8,0,0,0)` -eso fija las 8:00am en la zona local del
   *proceso*, que en produccion (Vercel, UTC) no es la misma que la de
   Republica Dominicana (UTC-4, sin horario de verano). Con el servidor
   en una zona distinta a RD, todo calculo de tardanza habria salido mal
   por el desfase completo. Corregido con `horaEsperadaEnRD()`
   (`@regb/operations`, con pruebas propias): calcula la fecha
   calendario de RD del marcaje sumando el offset fijo, y construye ahi
   las 8:00am de RD -sin depender de la zona del proceso que corre el
   codigo-. `fechaHora()` en la pantalla tambien fija
   `timeZone: 'America/Santo_Domingo'` explicitamente por la misma razon.

2. **El seed de demo generaba un marcaje "de hoy" en el futuro.**
   `current_date` en el `do $$` bloque usa la zona de la *sesion* de
   Postgres (UTC), no la de RD: entre las 8pm y la medianoche hora de
   RD, UTC ya cambio de fecha, asi que "hoy + 8:17am" quedaba fechado un
   dia adelante de la hora real de RD. El marcaje abierto de demo nunca
   pudo cerrarse -`check_out_attendance()` rechazaba correctamente
   cualquier salida anterior a esa entrada "futura"-, y como la
   `<form action>` de checkout no propaga el error a la pantalla, el
   boton "Salida" parecia simplemente no hacer nada. Corregido calculando
   el dia calendario real de RD (`(now() - interval '4 hours')::date`) y
   retrocediendo un dia si las 8:17am de RD todavia no han llegado.

Un tercer bug, encontrado en la misma sesion de verificacion: los
eventos se emitian como `attendance.checked-in` /
`attendance.checked-out`, dos segmentos, cuando `emit_event()` exige
`<modulo>.<entidad>.<accion>` (tres). El insert de
`check_out_attendance()` SI se ejecutaba, pero como corria en la misma
transaccion que el `emit_event()` fallido, `asUser()` (que envuelve todo
en `db().begin()`) revertia los dos. Corregido a
`attendance.record.checked-in` / `attendance.record.checked-out`.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/asistencia` | `attendance.view` | Marcajes recientes con horas/extra/tardanza calculadas; marcar entrada y salida |
| `/asistencia/geocercas` | `attendance.geofence.manage` | Centro y radio permitido por sucursal |

## Manifiesto

- **Permisos:** `view`, `check-in`, `geofence.manage`, `export`
- **Widgets:** `attendance-today`, `late-arrivals`
- **Reportes:** `attendance-summary`, `overtime-report`
- **Emite:** `attendance.record.checked-in`, `attendance.record.checked-out`
- **Requiere:** `employees` · **Recomienda:** `payroll`
- **Movil:** `platforms.mobile = true`, `mobileScope: ['view', 'check-in']`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/attendance.test.ts` — 12 casos: aislamiento de geocercas y marcajes, spoofing de tenant via sucursal/empleado ajeno con el PROPIO tenant_id, un solo marcaje abierto por empleado, `check_out_attendance` rechaza cerrar de otro tenant/dos veces, modulo apagado, checks de tabla (latitud fuera de rango, salida antes de entrada) |
| 3 | Logica pura con cobertura | ✅ `attendance.ts` — 21 pruebas: haversine, geocerca, horas trabajadas, horas extra, tardanza con margen de gracia, y `horaEsperadaEnRD()` (fijeza horaria de RD independiente del servidor) |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: check-in con geocerca validada en vivo, check-out cerrando un marcaje real, geocerca nueva creada en vivo, y los dos bugs de zona horaria arriba encontrados y corregidos en esta misma verificacion |
| 5 | UI movil | 🔜 F5 — `mobileScope` declarado, sin implementar todavia |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una geocerca de Santo Domingo, un marcaje de ayer ya cerrado con hora extra real, uno de hoy todavia abierto con leve tardanza -ambos con la fecha calendario de RD calculada correctamente, nunca en el futuro- |
| 9 | ≥2 widgets | ✅ `attendance-today`, `late-arrivals` |
| 10 | Eventos documentados | ✅ declarados con el formato correcto de 3 segmentos; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas -controles con nombre, sin ids duplicados, `<main>` presente- |

## Lo que NO hace

- **Lector de huella digital ni ningun biometrico real.** Es hardware
  que este sistema no controla. Marca por geocerca, QR o manual.
- **Aprobar o corregir un marcaje con flujo de excepciones.** Un
  marcaje se cierra o queda abierto; no hay todavia un flujo para que
  un gerente edite una hora equivocada -eso rompería la inmutabilidad
  del hecho historico, y se resolveria como una correccion explicita en
  una fase futura, no como una edicion silenciosa-.

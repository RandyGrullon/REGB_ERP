# `employees` — Empleados

**Que resuelve:** el expediente de cada empleado, su historial de
contratos y el organigrama de a quien le reporta cada quien.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Recomienda:** `payroll`

---

## Puerta de entrada a toda la fase de RRHH

Primer modulo de F7 (S36). `payroll` (62, S37-38) sigue siendo solo un
`manifest.ts` sin esquema real -este modulo es lo primero que hacia
falta antes de poder calcular una nomina de verdad: sin un registro de
empleados, salarios y fechas de ingreso, no hay contra que calcular
nada-.

## El organigrama es logica pura, no una tabla

`buildOrgChart()` (`@regb/operations`) arma el arbol de jefe a
subordinado a partir de `manager_id`, mismo principio que el mayor de
`accounting` se deriva de las lineas de asientos en vez de guardarse.
Un dato sucio -un empleado que en el fondo es su propio jefe, o un
ciclo de dos jefes que se reportan entre si- no cuelga la funcion ni
hace desaparecer gente del reporte: se corta el ciclo y ese empleado se
trata como raiz. Encontrado escribiendo la prueba del ciclo de dos, no
adivinado: la primera version de la funcion dejaba el arbol vacio en
ese caso -los dos empleados desaparecian por completo del organigrama-,
corregido antes de publicar el modulo.

## Un contrato nuevo nunca sobreescribe el anterior

`crear_contrato_empleado()` desactiva el contrato vigente y crea uno
nuevo -una promocion o un cambio de salario quedan en el historial con
su propia fecha, mismo espiritu que un revaluo de activo fijo (0046)
que tampoco sobreescribe el anterior-. La funcion tambien actualiza el
salario y el cargo vigentes en `employees`, para no tener que unir con
"el ultimo contrato" en cada consulta que solo necesita el dato actual.

## Documentos: declarado como pendiente, no fingido

El catalogo promete "documentos" junto a expediente/contratos/
organigrama/historial. Adjuntar la cedula o el contrato firmado de un
empleado es una relacion polimorfica que el gestor documental (`files`,
modulo 11, ya construido) ya resuelve -reimplementarla aqui seria
duplicar trabajo-. Esta version no integra esa pieza todavia.

## El mismo agujero de siempre, tapado desde el primer dia

`employees` referencia `branch_id` y `manager_id` (auto-referencia);
`employee_contracts` referencia `employee_id`. Los dos podrian colarse
con el tenant propio de quien inserta pero apuntando a una sucursal, un
jefe o un empleado ajenos -mismo patron que 0031/0040 y cada modulo de
F6-. `impedir_referencia_ajena_empleado()` e `impedir_contrato_ajeno()`
cierran las tres referencias desde la migracion original (0051).

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/empleados` | `employees.view` | Lista con antiguedad y salario, registrar empleado |
| `/empleados/organigrama` | `employees.view` | Arbol de jefe a subordinado |
| `/empleados/:id` | `employees.view` | Expediente, historial de contratos, registrar contrato, dar de baja |

## Manifiesto

- **Permisos:** `view`, `employee.create`, `contract.create`, `employee.terminate`, `export`
- **Widgets:** `headcount`, `new-hires`
- **Reportes:** `employee-roster`, `org-chart`
- **Emite:** `employees.employee.created`, `employees.employee.terminated`
- **Requiere:** ninguno · **Recomienda:** `payroll`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/employees.test.ts` — 11 casos: aislamiento, spoofing de tenant en sucursal/jefe/contrato ajenos, historial de contratos correcto (desactiva el anterior, actualiza el vigente), crear contrato para empleado ajeno bloqueado, modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `employees.ts` — 16 pruebas: organigrama con arboles de 2 y 3 niveles, jefe fantasma, auto-jefe, ciclo de dos -encontro un bug real, corregido-, antiguedad en anos y dias, salario proporcional |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: organigrama de 3 niveles renderizado correctamente, contrato nuevo registrado en vivo con el anterior pasando a historico |
| 5 | UI movil | 🔜 F5 — sin `mobileScope`: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ jerarquia real de 3 niveles (Gerente General → Encargada de Sucursal → Vendedor), con una promocion real de dos contratos y un ingreso reciente |
| 9 | ≥2 widgets | ✅ `headcount`, `new-hires` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'standard'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 3 pantallas nuevas |

## Lo que NO hace

- **Adjuntar documentos.** Ver arriba: pendiente de integrar con `files`.
- **Calcular prestaciones laborales, vacaciones o antiguedad para
  fines legales.** `yearsOfService()`/`daysOfService()` son la base
  aritmetica que `payroll` va a necesitar, no el calculo legal completo
  del Codigo de Trabajo dominicano.
- **Biometrico, geocerca o control de asistencia.** Eso es `attendance`
  (63, S39), modulo hermano de esta misma fase, no construido todavia.

# `payroll` — Nomina

**Que resuelve:** calcula TSS e ISR por periodo, guarda un volante por
empleado, y deja el resultado fijo despues de procesar.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes + RD$2/usuario (mediano/grande) · **Requiere:**
`employees` · **Recomienda:** `accounting`

---

## De un manifest sin esquema a un modulo real

`payroll` existia desde antes de esta fase como un `manifest.ts`
registrado en el catalogo, pero sin una sola migracion, tabla, prueba o
pantalla detras -un scaffold, no un modulo-. Esta version le da el
esquema real que le faltaba, y corrige tambien su `requires`: el
scaffold original traia `requires: []`, pero `payroll_lines`
referencia `public.employees` de verdad -sin empleados no hay a quien
pagarle-. Mismo criterio que la 0043/0047 ya aplicaron para
accounting/ap/budgets.

## Las tasas NUNCA se hardcodean como una promesa fija

TSS (AFP + SFS del empleado) e ISR viven en `calculatePayrollLine()`
(`@regb/operations`) como **parametros**, no como constantes escritas
"para siempre". `TASAS_TSS_REFERENCIA_2024` trae los valores conocidos
al escribir esto -incluida la tabla progresiva de ISR-, con un aviso
explicito en el codigo: **el ISR se ajusta cada ano por inflacion, y
hay que verificarlo contra la DGII antes de correr una nomina real**.
Cada periodo procesado guarda una FOTO de las tasas que uso
(`tax_params`), asi que un cambio de tasa el ano que viene no
recalcula solas las nominas ya procesadas.

## El ISR mensual se calcula como se calcula de verdad

`monthlyIncomeTaxWithholding()` no aplica el tramo de ISR directamente
sobre el salario del mes: proyecta el salario neto de TSS a un ano,
busca el tramo con esa base anualizada, y reparte el impuesto anual
entre 12. Es el metodo real que usa una nomina dominicana -un atajo
que aplicara el tramo mensual directamente sobre un doceavo del salario
da un numero distinto y equivocado-.

## Un periodo procesado es inmutable -en insert, no solo en update-

Mismo criterio que un asiento contabilizado (0041) o un presupuesto
cerrado (0047), con un matiz que se encontro escribiendo la propia
prueba de inmutabilidad: la primera version del trigger de
`payroll_lines` solo bloqueaba `UPDATE`/`DELETE`, no `INSERT` -un
periodo ya procesado seguia aceptando lineas nuevas sin que nada lo
impidiera-. El test esperaba el mensaje "no se edita" y en cambio
recibio una violacion de unicidad, prueba de que el insert nunca llego
a bloquearse. Corregido antes de aplicar la migracion a Supabase real:
el trigger ahora dispara tambien en `before insert`.

## Cesantia: la pieza que mas necesita ojo humano

`severanceDays()` implementa el caso general del Codigo de Trabajo
(Art. 82): los primeros 5 anos a 21 dias por ano, y **solo el
excedente** sobre 5 anos a 23 -no toda la antiguedad recalculada a 23,
un error facil de cometer-. No cubre las excepciones legales (dimision,
causa justificada, contrato por tiempo determinado): es la base
aritmetica, no una asesoria legal.

## El mismo agujero de siempre, tapado desde el primer dia

`payroll_lines` referencia `employee_id`. `impedir_linea_nomina_ajena()`
tapa el mismo agujero de 0031/0040 y cada modulo de F6/F7 desde la
migracion original.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/payroll` | `payroll.view` | Lista de periodos, crear uno nuevo |
| `/payroll/run` | `payroll.run` | Previsualiza y procesa el periodo mas antiguo en borrador |
| `/payroll/reports` | `payroll.export` | Volante de cada empleado por periodo ya procesado |

## Manifiesto

- **Permisos:** `view`, `run`, `approve`, `export`, `view.own`
- **Widgets:** `payroll-next-run`, `payroll-cost`
- **Reportes:** `payroll-summary`, `tss-report`
- **Emite:** `payroll.period.closed`
- **Requiere:** `employees` · **Recomienda:** `accounting`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ (corregido: `requires`, `dashboardWidgets` de 1 a 2, `reports` agregado) |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/payroll.test.ts` — 11 casos: aislamiento, spoofing de tenant en linea via empleado ajeno, procesar la nomina propia funciona normal, inmutabilidad de periodo y de linea -incluido el hueco de INSERT encontrado y corregido-, modulo apagado, restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `payroll.ts` — 25 pruebas: TSS con y sin tope, los 4 tramos de ISR, retencion mensual anualizada, desglose completo, regalia, cesantia con el tramo de 5 anos correcto, preaviso |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: previsualizacion antes de procesar, periodo procesado en vivo reflejando el salario actual de un empleado ya promocionado, volantes con los totales correctos |
| 5 | UI movil | 🔜 F5 — deliberadamente sin movil: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un periodo del mes pasado ya procesado (calculado a mano con la misma formula, para no reimplementar la aritmetica en el seed) y uno del mes actual en borrador para procesar en vivo |
| 9 | ≥2 widgets | ✅ `payroll-next-run`, `payroll-cost` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'advanced'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 3 pantallas |

## Lo que NO hace

- **Generar el archivo que exige el portal de la TSS.** Calcula y
  guarda el desglose; el formato de archivo especifico de cada portal
  es una integracion aparte.
- **Cubrir las excepciones legales de cesantia y preaviso.** Solo el
  caso general de despido sin causa justificada.
- **Actualizar las tasas de TSS/ISR solo.** Son parametros que hay que
  verificar y actualizar a mano contra la ley vigente -el sistema no se
  conecta a ninguna fuente oficial para traerlas-.
- **Aprobacion en varios pasos, ni pago bancario real.** `status =
  'paid'` es un campo, no una transferencia -el pago sigue siendo un
  hecho fuera del sistema, igual que en `payments` (27) y en `ap` (18).

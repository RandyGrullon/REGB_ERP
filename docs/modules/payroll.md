# `payroll` — Nomina

**Que resuelve:** calcula lo que le toca a cada empleado en un periodo
(mensual o quincenal, con ingresos y salidas a mitad de periodo), con TSS
e ISR de una tabla por vigencia, descuenta prestamos internos, paga
reembolsos de gastos, guarda un volante por empleado y deja el resultado
fijo despues de procesar.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes + RD$2/usuario (mediano/grande) · **Requiere:**
`employees` · **Recomienda:** `accounting`, `benefits`, `expenses`

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

## Lo que arreglo 0132 (hallazgo 10 del analisis de flujo, 23-sep-2026)

| Antes | Ahora |
|---|---|
| Cada periodo pagaba el salario mensual completo: dos quincenas = dos salarios (E-001 cobraba 142,798.88 netos en vez de 71,399.44). | Cada periodo paga su parte del mes (regla abajo). Dos quincenas de 85,000 = 42,500 + 42,500 de bruto y 35,699.72 + 35,699.72 de neto = 71,399.44. |
| Periodos que se cruzan convivian (solo `unique (tenant, inicio, fin)`). | `crearPeriodo` rechaza el cruce diciendo con cual choca, y la base lo impide **por empleado** con una restriccion de exclusion. |
| Quien entraba o salia a mitad de periodo cobraba el mes entero. `proratedSalary()` existia y nadie la usaba. | Se pagan solo los dias contratados. Los dados de baja dentro del periodo cobran su ultimo tramo. |
| Un solo tope de TSS (415,492) para AFP y SFS juntos, escrito en el codigo, que no correspondia a ninguna resolucion. | Topes separados -SFS 10 y AFP 20 salarios minimos cotizables- en `payroll_tax_params`, una fila por vigencia con su fuente. Cero valores en el codigo. |
| Prestamos "por nomina" y reembolsos "por nomina" se daban por pagados sin que nadie los pagara. | La nomina descuenta la cuota y paga el reembolso en la misma linea, y registra el pago del prestamo. |
| `/payroll/run` pedia `payroll.view`. | Pide `payroll.run`, como declara el manifest. |

## Regla de periodos (y su base)

El salario pactado es **mensual** y se paga por unidad de tiempo, en
periodos convenidos (Codigo de Trabajo, Ley 16-92, libro tercero, del
salario). Para pasar de "salario del mes" a "lo de este periodo" la
nomina usa el **mes comercial de 30 dias**, que es la base de salario
diario (salario mensual / 30) que ya usaba `proratedSalary()` y la
practica de nomina dominicana:

1. **Un periodo vale sus dias comerciales / 30** de un salario. Cada mes
   cuenta 30: el dia 31 no suma y el ultimo de febrero completa hasta 30.
   Asi el mes vale **1**, y **cada quincena (1-15 y 16-fin) vale 1/2**
   tenga el mes 28, 30 o 31 dias.
2. La cuenta es aditiva: **cualquier forma de partir el ano en periodos
   suma 360 dias = 12 salarios**. Ni las quincenas ni las semanas pagan de
   mas (probado con periodos semanales que cubren 2026).
3. **Ingreso o salida dentro del periodo:** se pagan los dias comerciales
   que la persona estuvo contratada. Entrar el 16 = medio mes. Si lo unico
   trabajado de un mes es el dia 31, ese dia vale 1: el trabajo hecho se
   paga.
4. **Los topes de TSS se escalan por la fraccion del periodo** (en una
   quincena, medio tope): dos quincenas cotizan lo de un mes.
5. **ISR de un periodo que no es un mes:** su base se lleva a mes (base /
   fraccion), se aplica el metodo mensual de siempre (proyectar a un ano,
   buscar el tramo, dividir entre 12) y se vuelve a la fraccion. Dos
   quincenas iguales retienen lo mismo que un mes.

**Por que 30 y no 23.83:** 23.83 (dias laborables promedio del mes) es la
base del salario diario para calcular **prestaciones y vacaciones**, no
para el salario ordinario de un periodo.

**Por confirmar con un abogado laboral:** la regla es la practica
comun y cumple "todo trabajo se paga, nada se paga dos veces"; los
articulos exactos del CT sobre periodicidad de pago no se verificaron en
esta sesion.

La logica vive en `packages/operations/src/payroll.ts`
(`diasComerciales`, `fraccionDeMes`, `salarioDelPeriodo`,
`calculatePayrollLine`) y el calculo de un periodo en
`apps/web/src/app/payroll/calculo.ts`, que usan **igual** la
previsualizacion y `procesarPeriodo()`.

## Quien cobra en un periodo

- Activos y **dados de baja dentro del periodo** (su ultimo tramo).
  Los que estan de licencia (`on_leave`) siguen fuera, como antes.
- Quien tenga un reembolso asignado al periodo, aunque no tenga salario
  en el (linea con bruto 0 y el reembolso).
- Si alguien ya cobro dias de este periodo en otra nomina, **se detiene
  todo** y se dice quien y en que nomina.
- Un periodo sin nadie a quien pagarle **no se procesa**: procesado queda
  congelado para siempre (pasa tambien si el rol no ve los expedientes).

## Un dia se paga una sola vez, por empleado (0132)

`payroll_lines.period_range` (copia del rango del periodo, la mantiene un
trigger) + `exclude using gist (tenant_id with =, employee_id with =,
period_range with &&)`. Es por empleado a proposito: el que cobra dos
veces es una persona. Si un borrador cambia de fechas, sus lineas se
mueven con el y la restriccion vuelve a mirar. Necesita `btree_gist`
(esquema `extensions`). Si una base ya tuviera lineas cruzadas, la
migracion para y dice cuales.

## Tasas: una tabla por vigencia, nunca en el codigo

`public.payroll_tax_params` (catalogo global, como `currencies`): salario
minimo cotizable, multiplos de tope (SFS 10, AFP 20), tasas del empleado
(SFS 3.04%, AFP 2.87%), escala de ISR, `source` y `verified`. La nomina
toma la fila vigente al **fin del periodo** (`parametros_nomina(fecha)`);
sin fila, no procesa. Cualquiera la lee; nadie con token la escribe: una
fila nueva entra por migracion con su fuente.

| Vigente desde | Salario minimo | Tope SFS | Tope AFP | Estado |
|---|---|---|---|---|
| 1-feb-2024 | 19,352.50 | 193,525 | 387,050 | TSS Res. 01-2024 (tss.gob.do). ISR 2024 **por confirmar** |
| 1-abr-2025 | 21,674.80 | 216,748 | 433,496 | TSS Res. 01-2025, 1er tramo (presidencia.gob.do). ISR 2025 **por confirmar** |
| 1-feb-2026 | 23,223.00 | 232,230 | 464,460 | TSS Res. 01-2025, 2do tramo. ISR 2026 confirmado por la DGII (CA687). **Verificada** |

**De donde sacar la siguiente:** la TSS publica los topes por resolucion
cuando cambia el salario minimo (tss.gob.do, "topes de cotizacion"); la
DGII publica la escala de ISR de asalariados cada ano. La **Ley 30-26
(art. 10) cambia la escala de ISR a partir del ejercicio 2027**: esa fila
hay que cargarla cuando se publique.

Cada periodo procesado guarda una FOTO de los parametros que uso
(`tax_params`, con `sfsCap`, `afpCap` y la vigencia), asi que un cambio de
tasa no recalcula nominas ya procesadas.

## Prestamos y reembolsos (0132)

- **Prestamos** (`benefits`): a cada prestamo activo se le descuenta la
  cuota (mensual) por la fraccion del periodo -media cuota por quincena-,
  nunca mas que el saldo y **nunca dejando el neto negativo** (lo que no
  alcanza sigue en el saldo). El pago se registra en
  `benefit_loan_payments` (`source = 'payroll'`, con el periodo) y el
  prestamo que llega a cero queda `paid`. Un pago que alguien ya asigno a
  mano a este periodo se descuenta tal cual, sin crearlo otra vez.
- **Reembolsos** (`expenses`): los gastos reembolsados con metodo
  `payroll` y este periodo suman al neto como ingreso **no gravado** (no
  son base de TSS ni de ISR), en la columna `reimbursements`.
- Un reembolso o un pago de prestamo solo puede apuntar a un periodo en
  **borrador**: apuntar a uno procesado era darlo por pagado sin que nadie
  lo pagara (trigger `no_nomina_cerrada`).
- Sin `benefits` o `expenses` activos, la RLS devuelve cero filas: nada
  que descontar ni reembolsar.

## El ISR mensual se calcula como se calcula de verdad

`monthlyIncomeTaxWithholding()` no aplica el tramo de ISR directamente
sobre el salario del mes: proyecta el salario neto de TSS a un ano,
busca el tramo con esa base anualizada, y reparte el impuesto anual
entre 12. Es el metodo real que usa una nomina dominicana.

## Un periodo procesado es inmutable -en insert, no solo en update-

Mismo criterio que un asiento contabilizado (0041). El trigger de
`payroll_lines` bloquea tambien `INSERT` en un periodo procesado (hueco
encontrado escribiendo la propia prueba de inmutabilidad). Desde 0132 hay
ademas `payroll_lines_neto_cuadra` (`NOT VALID`: solo lineas nuevas): el
neto es bruto + reembolsos - TSS - ISR - otros descuentos.

## RLS (0132)

- **Leer una linea** exige `payroll.view` (igual que 0109). El empleado lee
  **sus** volantes con `mis_volantes()` (del portal), que resuelve por el
  token y el vinculo `employees.user_id`; directo a la tabla, sin
  `payroll.view`, no lee ninguna -ni la suya ni la de otro-. "Lo mio" no
  entra a la politica de la tabla porque el respaldo (0122) deriva de las
  politicas quien ve que.
- **Escribir** linea o periodo exige `payroll.run` (en `WITH CHECK`, sale
  42501 y no "0 filas"); **borrar**, lo mismo por trigger. Antes bastaba
  `payroll.view` para insertar una linea por PostgREST. Mismo patron que
  0127.

## Cesantia: la pieza que mas necesita ojo humano

`severanceDays()` implementa el caso general del Codigo de Trabajo: los
primeros 5 anos a 21 dias por ano, y **solo el excedente** sobre 5 anos
a 23. No cubre las excepciones legales: es la base aritmetica, no una
asesoria legal.

## El mismo agujero de siempre, tapado desde el primer dia

`payroll_lines` referencia `employee_id`. `impedir_linea_nomina_ajena()`
tapa el mismo agujero de 0031/0040 desde la migracion original.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/payroll` | `payroll.view` | Lista de periodos, crear uno nuevo (rechaza el que se cruza) |
| `/payroll/run` | `payroll.run` | Previsualiza con el mismo calculo que guarda: dias, bruto, reembolsos, TSS, ISR, prestamos, neto, y de que vigencia salen las tasas |
| `/payroll/reports` | `payroll.export` | Volante de cada empleado por periodo ya procesado |

## Manifiesto

- **Permisos:** `view`, `run`, `approve`, `export`, `view.own`
- **Widgets:** `payroll-next-run`, `payroll-cost`
- **Reportes:** `payroll-summary`, `tss-report`
- **Emite:** `payroll.period.closed` (con empleados, prestamos descontados y reembolsos pagados)
- **Requiere:** `employees` · **Recomienda:** `accounting`, `benefits`, `expenses`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/payroll.test.ts` (11) y `supabase/tests/nomina-vinculo-y-periodos.test.ts` (30): exclusion por empleado (quincenas contiguas si, mes encima no, otro empleado si, mover fechas de un borrador no), RLS directa con token (empleado 0 lineas por la tabla y la suya por la RPC, `payroll.view` lee pero no escribe ni borra), tabla de parametros por vigencia (2024/2025/2026, antes de 2024 nada, nadie la escribe), nada se cuelga a una nomina procesada |
| 3 | Logica pura con cobertura | ✅ `payroll.ts` — 51 pruebas: topes SFS/AFP separados y por fraccion, escala validada, quincena = mitad y dos quincenas = un mes al centavo, mes comercial (28/30/31, ano = 360, semanas = 360), prorrateo (16, 13, salida el 10, entrada el 31), prestamos con tope de saldo y de neto |
| 4 | UI web responsive | ✅ acciones reales en `apps/web/src/app/payroll/nomina.accion.test.ts` (11) y verificado en navegador (tema oscuro y claro) contra `regb_nomina`: previsualizacion con prorrateo y prestamo, procesar, volantes, cruce rechazado con el aviso |
| 5 | UI movil | 🔜 F5 — deliberadamente sin movil: `platforms.mobile = false` |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ agosto procesado y septiembre en borrador (con un ingreso a mitad de mes y un prestamo con cuota) |
| 9 | ≥2 widgets | ✅ `payroll-next-run`, `payroll-cost` |
| 10 | Eventos documentados | ✅ declarados; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 3 pantallas (pendiente repetirla tras 0132) |

## Lo que NO hace

- **Aportes patronales, SRL, INFOTEP, archivo del SUIR, IR-3/IR-13,
  archivo de banco ni asiento contable.** Calcula y guarda lo retenido al
  empleado.
- **Horas extra.** La asistencia todavia no sirve como base de pago (la
  geocerca no bloquea, la hora de entrada esta fija a las 8:00): pagar
  recargos (CT art. 203, 35% / 100%, por confirmar) sobre esos datos
  seria pagar mal. Ver `attendance.md`.
- **Cambios de salario a mitad de periodo.** Usa el salario vigente del
  expediente; un contrato nuevo con fecha futura ya cambia
  `employees.salary` antes de tiempo (hallazgo del analisis, sin cerrar).
- **Pagar a quien esta de licencia (`on_leave`).**
- **Salario por hora o por dia.** El modelo es salario mensual; en
  periodos semanales el monto de cada semana varia con el mes comercial
  (una semana con dia 31 vale 6 dias), aunque el ano cuadra en 12
  salarios.
- **Reabrir un periodo procesado.** Se corrige con el siguiente.
- **Cubrir las excepciones legales de cesantia y preaviso.**

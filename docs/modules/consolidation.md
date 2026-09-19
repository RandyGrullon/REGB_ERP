# `consolidation` — Consolidacion

**Que resuelve:** sumar los estados de varias empresas del mismo cliente
en una sola balanza de grupo, quitando lo que se venden y se deben entre
ellas.

**Categoria:** `enterprise` · **Precio:** 0/0/12,000 instalacion ·
0/0/900 mes · **Requiere:** `accounting`, `orgs`

---

## El modulo era imposible hasta esta migracion

`public.journal_entries` no tenia `company_id`: la contabilidad era del
**cliente**, no de la empresa. Con dos razones sociales en el mismo
tenant no habia forma de separar sus estados, asi que un "consolidado"
habria sido una hoja de calculo con RLS. La 0117 agrega esa columna
—precedente en el repo: la 0062 altera `customers` desde `price-lists` y
la 0066 altera `products` desde `lots-serials`— con su trigger
`no_empresa_ajena` para que nadie etiquete un asiento con la empresa de
otro cliente.

La columna es **nullable a proposito**. La pantalla de contabilidad
todavia no pregunta a que empresa pertenece el asiento —eso es un cambio
de `accounting`, no de este modulo— y obligar a llenarla romperia todo lo
ya capturado. Un asiento sin empresa se suma a la empresa principal
(`is_default`), que es lo que era antes de que existiera multi-empresa, y
la pantalla de la corrida **dice en numero** cuantos estan asi. Esconder
el supuesto es lo que hace que un consolidado se entregue mal sin que
nadie lo note.

## Se congela la entrada, nunca el resultado

Al generar una corrida se guarda `consolidation_run_balances`: cuanto
debito y cuanto credito aporto cada empresa en cada cuenta dentro del
periodo, leido de los asientos **ya contabilizados** (un borrador no es un
hecho contable, mismo criterio que la balanza de `accounting`). Esa foto
hace falta porque un asiento con fecha atrasada puede entrar manana y
cambiar el pasado — mismo patron que `payroll_periods.tax_params` (0052).

Lo que **no** existe, a proposito, es una tabla `consolidation_lines`. La
0041 ya fijo la regla del repo: *el mayor y la balanza no son tablas, se
derivan; un saldo guardado se desincroniza el dia que algo se corrija*. La
columna consolidada se calcula entera en
`buildConsolidationWorksheet()` cada vez que se pinta la pantalla.

## Por que la aritmetica vive en TypeScript

La hoja se pinta **en vivo** sobre una corrida en borrador mientras el
contador teclea eliminaciones, antes de guardar nada. Si el calculo
viviera en SQL habria que ir y volver a la base por cada tecla, o
mantener dos versiones —una para la pantalla y otra para el cierre—.
Ademas se prueba sin base, en milisegundos, con los casos incomodos: una
empresa sin movimiento en una cuenta, una eliminacion mayor que el saldo
combinado, un activo con saldo al reves.

`buildConsolidationWorksheet()` **reusa** `normalBalance()` y
`accountBalance()` de `accounting.ts` en vez de reescribir el signo del
saldo. Dos implementaciones del saldo normal serian dos verdades.

## Lo que si vive en SQL, porque solo SQL lo garantiza

- **Cinco triggers anti-tenant-ajeno**, uno por tabla. Una funcion
  generica compartida revienta con `record new has no field`: `NEW` es
  `RECORD` en PL/pgSQL y el nombre de columna se resuelve en tiempo de
  ejecucion contra la tabla real del trigger. La leccion ya estaba
  escrita en la 0041.
- **Una corrida cerrada es inmutable**: ni ella, ni su foto de saldos,
  ni sus eliminaciones. Mismo criterio que un asiento contabilizado
  (0041) o un periodo de nomina procesado (0052).
- **La moneda cierra la puerta**: una empresa cuya `currency` no sea la
  `presentation_currency` del grupo **no entra**. Este corte no traduce
  moneda, y una nota al pie no impide que alguien lea una suma de pesos
  con dolares como un numero real.
- **Las dos empresas de una eliminacion tienen que ser miembros del
  grupo de esa corrida.** Eso no lo puede expresar ninguna llave foranea.
- **Un grupo con corridas no se puede borrar.**
  `consolidation_runs.group_id` va **sin** `on delete cascade` justamente
  para eso: si cascadeara, un consolidado ya entregado desapareceria con
  un clic.

## Una eliminacion es un par, no una lista de lineas

Una cuenta al debito, una al credito, un solo monto. Asi una eliminacion
**no puede descuadrar el grupo por construccion**, y no hace falta un
`post_journal_entry()` que lo vigile. Los casos de tres patas —quitar el
margen de un inventario comprado al grupo junto con su impuesto
diferido— se capturan como dos eliminaciones separadas.

## El numero que justifica el modulo

`eliminationImpact()` calcula cuanto ingreso, gasto, activo y pasivo se
habrian inflado sin eliminar, y va **arriba** en la pantalla de la
corrida. Es el argumento de venta del modulo, asi que tiene que ser un
numero calculado y no una frase.

## Sin `ownership_pct`

`consolidation_group_members` no tiene columna de porcentaje. Este corte
consolida al 100% (integracion global) y el interes minoritario esta
declarado como no-hace: una columna que nadie lee seria fingir que la
consolidacion parcial existe, y alguien la llenaria creyendo que hace
algo.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/consolidacion` | `consolidation.view` | Grupos con sus empresas miembro, corridas recientes, crear grupo, agregar/quitar empresa, generar corrida |
| `/consolidacion/:id` | `consolidation.view` | Hoja de trabajo (una columna por empresa, eliminaciones, consolidada), captura de eliminaciones, aviso de asientos sin empresa, cerrar corrida |

## Manifiesto

- **Permisos:** `view`, `group.manage`, `run.create`,
  `elimination.create`, `run.close`, `export`
- **Widgets:** `consolidation-impacto`, `consolidation-ultima-corrida`
- **Reportes:** `consolidation-worksheet`
- **Emite:** `consolidation.run.created`, `consolidation.run.closed`
- **Requiere:** `accounting`, `orgs` · **Recomienda:** ninguno

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/consolidation.test.ts` — 30 casos: aislamiento en las 5 tablas, spoofing de tenant en miembro/corrida/foto/eliminacion, modulo apagado, moneda distinta, inmutabilidad de corrida cerrada (editar, borrar, eliminar, foto), eliminacion contra empresa no miembro, `journal_entries.company_id` ajeno, y las restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `consolidation.ts` — 19 pruebas: hoja con dos empresas, empresa sin movimiento, cuenta dormida, activo al reves, eliminacion mayor que el saldo, totales, impacto, validacion |
| 4 | UI web responsive | 🔜 pendiente de verificar en navegador: el import de `@regb/operations` no resuelve hasta que el coordinador exporte `./consolidation.js` y registre el paquete |
| 5 | UI movil | ➖ `platforms.mobile = false` — una hoja de siete columnas no se lee en un telefono |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente (`tours.ts` es archivo compartido) |
| 8 | Datos demo | 🔜 pendiente: `demo.sql` es archivo compartido y el tenant mediano tiene una sola empresa |
| 9 | ≥2 widgets | 🔶 declarados en el manifiesto; falta el renderizador en `widgets.tsx` (archivo compartido) |
| 10 | Eventos documentados | ✅ `run.created` y `run.closed`; nadie los escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargado desde la siembra original (0009), derivado de `category = 'enterprise'` |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | 🔜 pendiente de sonda |

## Lo que NO hace

- **Interes minoritario ni metodo de participacion.** Toda empresa del
  grupo entra al 100%.
- **Traducir moneda.** Si una empresa lleva USD y el grupo presenta DOP,
  la base directamente no la deja entrar al grupo. `multicurrency` (0049)
  existe, pero reexpresar estados financieros a tasa de cierre, tasa
  promedio y tasa historica es otro trabajo, no un `coalesce`.
- **Detectar solo las operaciones inter-compania.** Cada eliminacion se
  captura a mano. Emparejar por monto coincidente seria adivinar sobre la
  contabilidad de alguien; automatizarlo pide una marca de contraparte en
  la linea del asiento, que hoy no existe.
- **Balance general ni estado de resultados con formato.** La salida es
  la hoja de trabajo / balanza consolidada por cuenta. El repo todavia no
  tiene ningun armador de estados financieros con formato, y este modulo
  no lo inventa de paso.
- **Postear la consolidacion en los libros.** El consolidado es de
  presentacion; las eliminaciones viven en la corrida, no en la
  contabilidad de nadie. Es asi en la practica real y ademas evita
  ensuciar los libros individuales con asientos que la DGII no espera.
- **Cambiar la pantalla de contabilidad para preguntar la empresa.** Se
  agrega la columna y se respeta; llenarla desde `/contabilidad` es un
  cambio del modulo `accounting`.
- **Consolidar por sucursal.** La unidad es la empresa
  (`public.companies`). Sumar por `branches` es otra pregunta con otra
  respuesta.
- **Comparar periodos ni acumular el ano.** Cada corrida es un periodo
  suelto.
- **Eliminaciones de mas de dos patas.** Una eliminacion es un par
  debito/credito.

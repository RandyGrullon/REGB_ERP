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
debito y cuanto credito aporto cada empresa en cada cuenta **acumulado
hasta la fecha de corte** (`period_end`), leido de los asientos **ya
contabilizados** (un borrador no es un hecho contable, mismo criterio que
la balanza de `accounting`). Esa foto hace falta porque un asiento con
fecha atrasada puede entrar manana y cambiar el pasado — mismo patron que
`payroll_periods.tax_params` (0052).

**Acumulado, no el movimiento del periodo**, y esta dicho en la pantalla
con esas palabras. El que rompe todo si la foto solo mirara el periodo es
el **balance**: una cuenta por cobrar entre dos empresas del grupo que
nacio en marzo valdria cero en octubre, y la eliminacion de
`receivable_payable` —el caso estrella del modulo— no tendria nada que
eliminar; el grupo publicaria como activo propio lo que una empresa le
debe a la otra. El precio es que ingresos y gastos tambien salen
acumulados mientras el repo no tenga cierre anual. `period_start`
etiqueta el periodo que se reporta y **no** recorta la foto.

Congelar es un solo acto y vive en un solo sitio:
`public.consolidation_freeze(run)` (0117). La ventana estaba escrita dos
veces —una en la accion, otra distinta en la pantalla del aviso— y las dos
versiones se separaron: la pantalla decia *cero asientos sin empresa*
mientras la foto ya los habia sumado. La funcion ademas anota en la
corrida cuantos asientos sin etiquetar vio, por cuanto, y si de verdad
entraron (`unlabeled_entries`, `unlabeled_amount`, `unlabeled_included`):
eso es parte de la entrada congelada, no del presente.

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
  (0041) o un periodo de nomina procesado (0052). Los triggers miran las
  **dos puntas** del `update`: mirando solo el destino, mover una fila de
  una corrida cerrada a un borrador vaciaba el consolidado entregado sin
  dejar rastro —y `consolidation_run_balances` no lleva bitacora—.
- **Una corrida que ya tiene foto no cambia de grupo ni de periodo.**
  Nada la recalcula al moverla: acabaria colgando de un grupo cuyos
  miembros no son las empresas de sus saldos.
- **La empresa de un saldo tiene que ser miembro del grupo**, igual que
  las de una eliminacion. La tabla que suma dinero se valida como la que
  lo resta: una empresa fuera del grupo aparecia como una columna mas de
  la hoja sin descuadrar nada.
- **La moneda del grupo no se cambia por detras.** Ni con miembros en
  otra moneda dentro, ni nunca si el grupo ya tiene consolidados
  cerrados: seria la misma suma de pesos con una etiqueta de dolares.
- **La hoja historica se pinta con las cuentas de la corrida**, no con el
  catalogo activo de hoy (`public.consolidation_run_accounts(run)`).
  Desactivar una cuenta es un clic y le borraba a un consolidado ya
  entregado su fila y su dinero.
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
habrian inflado sin eliminar. **Arriba** en la pantalla de la corrida van
dos de los cuatro —ingreso y activo, que son los que resumen el caso—;
gasto y pasivo se calculan y hoy no se pintan. Es el argumento de venta del modulo, asi que tiene que ser un
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
  `elimination.create`, `run.close`
- **Widgets:** `consolidation-impacto`, `consolidation-ultima-corrida`
- **Reportes:** ninguno. `consolidation.export` y
  `consolidation-worksheet` estaban declarados y no existian en ningun
  sitio: no hay boton de exportar, ni route handler, ni descarga. Un
  permiso que no gobierna nada engana a quien arma los roles, asi que se
  quitaron. Vuelven el dia que la hoja se pueda bajar.
- **Emite:** `consolidation.run.created`, `consolidation.run.closed`
- **Requiere:** `accounting`, `orgs` · **Recomienda:** ninguno

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/consolidation.test.ts` — 46 casos: aislamiento en las 5 tablas, spoofing de tenant en miembro/corrida/foto/eliminacion, modulo apagado, moneda distinta, inmutabilidad de corrida cerrada (editar, borrar, eliminar, foto), eliminacion contra empresa no miembro, `journal_entries.company_id` ajeno, las restricciones de tabla, mudar una fila de una corrida cerrada a un borrador, saldo de empresa no miembro, cambio de grupo/periodo con foto, cambio de moneda del grupo, y `consolidation_freeze()` / `consolidation_run_accounts()` |
| 3 | Logica pura con cobertura | ✅ `consolidation.ts` — 23 pruebas: hoja con dos empresas, empresa sin movimiento, cuenta dormida, activo al reves, eliminacion mayor que el saldo, totales, impacto, validacion, aviso de asientos sin empresa |
| 4 | UI web responsive | 🔜 pendiente de verificar en navegador; el import ya resuelve (`packages/operations/src/index.ts` exporta `./consolidation.js`) |
| 5 | UI movil | ➖ `platforms.mobile = false` — una hoja de siete columnas no se lee en un telefono |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 el tour existe (`f6.consolidacion`, `packages/core/src/tours.ts`) pero tiene **4 pasos** y se exigen 6; `tours.ts` es archivo compartido |
| 8 | Datos demo | 🔜 pendiente: `demo.sql` es archivo compartido y el tenant mediano tiene una sola empresa |
| 9 | ≥2 widgets | ✅ declarados y pintandose: consulta y renderizadores ya estan en `apps/web/src/components/widgets.tsx` |
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
- **Comparar periodos.** Cada corrida se lee sola; no hay columna del
  periodo anterior ni variacion.
- **Recortar la foto al periodo.** La foto es el acumulado hasta la fecha
  de corte, a proposito y dicho en la pantalla: sin cierre anual, un
  balance recortado al mes mentiria en las cuentas que vienen de atras
  —y son justo las que se eliminan—.
- **Exportar la hoja.** Todavia no hay descarga; se lee en pantalla.
- **Eliminaciones de mas de dos patas.** Una eliminacion es un par
  debito/credito.

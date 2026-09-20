# `taxes` — Impuestos

**Que resuelve:** la retencion del proveedor deja de calcularse en una
hoja aparte y sobre la base equivocada, las tasas de ITBIS quedan
nombradas en un sitio con su vigencia, y el IT-1 del mes se liquida con
su saldo a favor arrastrado. Encima, el calendario de vencimientos.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Recomienda:** `ap`, `ar`, `accounting`

---

## Los 606/607/608 NO son de este modulo, aunque el catalogo lo dijera

El manifiesto de `accounting` dice textualmente que los formatos
606/607/608 son de `taxes` (24). Ese comentario quedo viejo: se
construyeron dentro de `ap` y `ar`, y funcionan —vistas
`public.dgii_606`, `dgii_607` y `dgii_608` con `security_invoker`, la
descarga CSV y TXT en `/api/dgii/[reporte]`, y la pantalla
`/cobrar/dgii`—. La decision aqui fue **corregir la ficha, no reabrir la
discusion duplicando las vistas**: dos verdades sobre lo que se le
declara a la DGII es la peor clase de duplicado que existe. El calendario
de este modulo **enlaza** a esa pantalla.

## El hueco real que llena: `ap` dice que no calcula la retencion

`public.supplier_invoices` ya tiene `retention_amount`, `isr_retained` e
`isr_retention_type` desde la 0042 y la 0099, y se capturan **a mano** en
`/pagar`. La ficha de `ap` lo declara en su "Lo que NO hace": *calcular
la retencion es una decision del negocio, no una formula de la DGII que
este sistema conozca*. Ese es exactamente el hueco: el campo existe, el
numero que va dentro no lo calculaba nadie.

Este modulo calcula ese numero y lo enseña. **No lo escribe**: escribir
en `supplier_invoices` sigue siendo de `ap`, que es de otro dueño. Si
mañana `ap` tambien calculara, habria dos verdades; la ficha de `ap` dice
que no lo hace, y eso se respeta en las dos direcciones.

## La base de la retencion no la elige el usuario

La retencion de **ITBIS** es un porcentaje del **ITBIS facturado**. La de
**ISR** es un porcentaje del **subtotal pagado**. Aplicar una sobre la
base de la otra hace que la retencion salga unas seis veces mal, y —lo
peligroso— con un numero que parece razonable. Por eso `base` se deriva
de `tax` en la accion y la tabla lo verifica con un check **simetrico**
(`(tax = 'itbis' and base = 'itbis') or (tax = 'isr' and base =
'subtotal')`): ofrecerlo como opcion es ofrecer la forma de equivocarse.

El check cubria una sola direccion y una regla de ISR con `base =
'itbis'` entraba sin protesta —el mismo error de seis veces, al reves y
hacia abajo, que es el que nadie reclama—. La UI tapaba el hueco porque
`crearRegla` deriva `base` de `tax`, pero la promesa del catalogo es
sobre la **tabla**, y un importador o un seed escriben por otra puerta.
Por lo mismo, `impedir_perfil_fiscal_ajeno()` comprueba ahora que la
ranura de ITBIS del perfil lleve una regla de ITBIS y la de ISR una de
ISR: las dos FK van a la misma tabla y nada mas lo impedia.

## El ISR se retiene sobre los servicios, no sobre los bienes

`BaseRetencion` acepta `servicios`: de ese subtotal, cuanto es mano de
obra. Sin ese dato la base es el subtotal completo —el proveedor de puro
servicio, que es el caso normal—; con el, el ISR sale solo de la parte de
servicios. En una factura mixta —un tecnico que cobra las piezas y la
mano de obra en el mismo documento— retener el 10% de todo le paga de
menos al proveedor, y el numero no cuadra despues contra el desglose que
el 606 obliga a declarar por separado
(`supplier_invoices.services_amount`, campo 8 contra campo 9). Es el
mismo dato que hay que teclear despues, asi que no es una pregunta nueva.

## Entre varias reglas candidatas gana una declarada, no la primera

`elegirRegla` resolvia con `activas.find(...)`: entre dos reglas de ISR
para persona fisica ganaba la primera del arreglo, o sea la que Postgres
devolviera esa vez. Y no es un caso raro: los nueve codigos 01–09 de
`TIPOS_RETENCION_ISR_606` existen porque alquileres, honorarios e
intereses se retienen distinto, y la unica restriccion de la tabla es
`unique (tenant_id, code)`. Si las tasas difieren se retiene mal; si solo
difiere el codigo, el 606 del mes sale con el tipo que no era.

Ahora el desempate es explicito —**`effective_from` mas reciente, y a
igual fecha el `code` alfabetico**— y `calcularRetenciones` devuelve
`candidatas`, para que la pantalla **diga** que aplico una de entre N y
sugiera asignarle su regla al proveedor. Un numero limpio que salio de un
desempate es peor que un numero con aviso.

## Las tasas van en fraccion, y no es un detalle

`rate` es `numeric(5,4)` con check `0..1`, la **misma** convencion que la
0021 dejo fijada en `products.tax_rate`, `sales_order_lines.tax_rate`,
`pos_sale_lines.tax_rate`, `purchase_order_lines.tax_rate` y
`quote_lines.tax_rate` despues de corregir el lio de 18 vs 0.18. Tener
dos convenciones de tasa conviviendo en el mismo esquema es, literalmente,
como se cobra un 1800% de ITBIS.

El campo de la pantalla es un **porcentaje** y siempre se divide entre
100 (`porcentajeAFraccion` en `@regb/operations`). Antes aceptaba "18" y
"0.18" como lo mismo, con `n > 1 ? n / 100 : n`, y esa comodidad tenia un
precio justo en el rango 0–1, que es donde la heuristica no puede
acertar: quien escribia **1** queriendo 1% guardaba **100%**, y la
validacion posterior solo rechazaba `> 1`, asi que pasaba limpio. Una
tasa cien veces mas alta se ve en la primera factura; una regla de
retencion cien veces mas alta se ve cuando el proveedor reclama.

## `supplier_tax_profiles` es tabla aparte, no columnas de `suppliers`

`public.suppliers` vive bajo la RLS del modulo `suppliers`. Colgarle
columnas fiscales ataria un modulo a otro y romperia el aislamiento por
modulo que sostiene el marketplace: apagar `taxes` dejaria columnas
muertas dentro de una tabla de otro dueño.

## El agujero de siempre, aqui por triplicado y tambien en UPDATE

`supplier_tax_profiles` tiene **tres** FKs a tablas con `tenant_id`:
`supplier_id` y dos veces `tax_withholding_rules`. La RLS de insercion
solo compara el `tenant_id` de la fila nueva, asi que
`impedir_perfil_fiscal_ajeno()` comprueba las tres.

La desviacion consciente del molde de la 0048: alli el trigger es solo
`before insert`, y es suficiente porque nadie reasigna el centro de una
asignacion ya escrita. **Aqui si**: cambiar `itbis_rule_id` por el de
otro cliente es una via de escape que un trigger de solo insert no ve.
Por eso corre tambien en `update`, y hay una prueba dedicada a ese caso.

## Cerrar una liquidacion guarda una FOTO

`tax_filings` tiene columnas de monto propias y no es una vista. Si mañana
se corrige una factura de enero, la declaracion de enero **no cambia**:
es lo que se entrego, y la diferencia se arregla con una rectificativa.
La pantalla enseña las dos columnas —lo declarado y lo que hoy daria—
justamente para que el usuario no crea que el sistema esta roto cuando no
coinciden. Por eso tampoco existe "recalcular": solo hay `insert`.

Y desde ahora la base lo sostiene, no solo la app. `tax_filings` se quedo
fuera de la 0108 ("lo fiscal no se borra") aunque es la unica tabla que
guarda lo que se le **dijo** a la DGII: `authenticated` podia mandar
`DELETE /rest/v1/tax_filings?...` y `PATCH {"credit_forward": 500000}`
desde el movil, sin pasar por `taxes.filing.close` —la politica solo mira
tenant y modulo—. El DELETE reabre un periodo cerrado; el PATCH mueve
dinero en silencio, porque el `previous_credit` del mes siguiente sale de
ese `credit_forward`. Ahora:

- `revoke delete on public.tax_filings from authenticated` (patron literal
  de la 0108; en el repo no hay un solo `delete from tax_filings` fuera
  del `afterAll` de las pruebas, que corre como dueño).
- Un trigger `before update` que congela el periodo, las fechas, quien
  cerro y las **siete** columnas de monto en cuanto el estado deja de ser
  `pending`, y que no deja al estado ir hacia atras. Quedan libres
  `status`, `receipt_number` y `notes`, que es lo que necesita
  `marcarPagada`.
- El comentario de tabla dice "inmutable", asi que
  `supabase/tests/inmutabilidad.test.ts` la **adopta sola** y esto no se
  puede volver a perder en el modulo 25.

## El saldo a favor se arrastra en cadena, un mes a la vez

`previous_credit` sale del `credit_forward` del periodo **inmediatamente
anterior** y de ningun otro (`creditoArrastrado` en `@regb/operations`).
Antes se tomaba "la ultima declaracion que hubiera" —`period < X order by
period desc limit 1`— y nada obligaba a cerrar en orden: cerrar 202609
con 5,000 de saldo, saltarse octubre y cerrar 202611 se los comia, y
volver despues a cerrar 202610 se los comia **otra vez**. Dos
declaraciones bajando el ITBIS a pagar por el mismo dinero, las dos
cerradas como foto: hay que rectificar las dos.

Si falta el eslabon no se inventa un cero —eso es declarar de mas en
silencio—: se nombra el mes que falta y no se deja cerrar, con la misma
negativa asimetrica que cuando `ar` esta apagado. La unica excepcion es
la primera declaracion de la historia, donde el cero es la verdad.

## El IT-1 declara operaciones; el 607, comprobantes

Lo cobrado del IT-1 es la suma del 607 **mas el ITBIS de las ventas sin
NCF** del periodo. La vista `dgii_607` filtra `ncf is not null`, y el POS
deja vender sin NCF a proposito —"un colmado que recien abre vende antes
de que la DGII le autorice el primer rango"—. Ese ITBIS se le cobro al
cliente igual, asi que se declara igual; usar el 607 como fuente hacia
que todo ticket sin NCF desapareciera de la declaracion, en silencio y
con cara de numero correcto. La pantalla muestra aparte cuanto de lo
cobrado viene de ventas sin NCF, para que la diferencia contra el 607 se
entienda en vez de parecer un error.

Los montos que se guardan **no salen del formulario**. Al cerrar se
vuelven a sumar contra `dgii_607` y `dgii_606` bajo RLS. Un formulario es
un campo de texto que cualquiera edita, y esto es lo que se le declara a
la DGII. Lo unico que viene de afuera es el ITBIS que **me** retuvieron:
ese dato no existe en ninguna tabla del repo.

## Lo que se nego a cerrar, y por que

`dgii_607` vive bajo la RLS de `ar` y `dgii_606` bajo la de `ap`. Con uno
apagado, esa mitad de la suma vuelve en cero y el IT-1 sale mal
**pareciendo correcto**. La regla no es simetrica a proposito:

| Modulo apagado | Que pasa | Decision |
|---|---|---|
| `ar` | No se ve el ITBIS cobrado → se declararia de menos | **No se deja cerrar.** Declarar de menos es una multa |
| `ap` | No se ve el ITBIS adelantado → se declara de mas | Se deja cerrar, con aviso. Cuesta dinero, no una sancion |

## La logica fiscal vive en `@regb/operations`, no en SQL

`packages/operations/src/taxes.ts`: `TASAS_ITBIS_RD`,
`porcentajeAFraccion`, `VENCIMIENTOS_RD`, `proximoDiaHabil`,
`calendarioFiscal`, `desglosarItbis`, `calcularRetenciones`,
`periodoAnterior`, `creditoArrastrado` y `liquidarItbis`. Cuatro razones,
no una:

1. Es el area que **mas cambia por decreto** (riesgo 5 del documento
   maestro). `dgii.ts` ya gano esa discusion con el mismo argumento.
2. El redondeo tiene que ser `roundBankers` de `@regb/core`, el mismo de
   `splitAmount()`. `round()` de Postgres redondea half-up: una retencion
   cuyo residuo cae en `.005` saldria un centavo distinta en la base y en
   la pantalla, y ese centavo es justo el que no cuadra contra el 606.
3. Que pasa cuando la liquidacion da negativo es una **decision de
   negocio** —se arrastra, nunca se declara en negativo—, no una formula.
   La tabla solo la **verifica** con `check (amount_due = 0 or
   credit_forward = 0)`.
4. La calculadora se usa **antes** de guardar nada: el usuario tiene que
   ver el numero para aceptarlo. Una funcion en SQL obligaria a un viaje
   a la base para una multiplicacion.

Lo que **no** subio a JavaScript: la suma del ITBIS del periodo. Eso es un
`sum()` sobre `dgii_606` y `dgii_607`, y vive donde estan las filas.

## El check de `period` usa `[0-9]`, no `\d`

Por la leccion que ya pago el TXT de envio en `api/dgii/[reporte]/route.ts`:
dentro de una plantilla de JavaScript la barra invertida se pierde antes
de llegar a Postgres y el patron viaja como la letra D. Sin barra
invertida no hay nada que perder —y las pruebas de BD escriben este SQL
dentro de plantillas—.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/impuestos` | `taxes.view` | Catalogo de tasas y reglas de retencion. Escribir pide `taxes.rate.manage` o `taxes.rule.manage` |
| `/impuestos/retenciones` | `taxes.view` | Perfil fiscal por proveedor + calculadora (GET: el resultado se comparte por enlace). Asignar pide `taxes.profile.assign` |
| `/impuestos/liquidacion` | `taxes.view` | IT-1 del periodo, calculo vivo contra la foto cerrada. Cerrar pide `taxes.filing.close` |
| `/impuestos/calendario` | `taxes.view` | Vencimientos del periodo y del siguiente, con enlace a `/cobrar/dgii` |

## Manifiesto

- **Permisos:** `view`, `rate.manage`, `rule.manage`, `profile.assign`,
  `filing.close`. Eran seis: `export` se quito por muerto —no hay
  reportes, ninguna ruta lo pide y ninguna accion lo exige—, y un permiso
  que nadie comprueba es una casilla que en `/roles` se marca sin que
  cambie nada
- **Widgets:** `taxes-next-due`, `taxes-itbis-due` *(pintados en
  `components/widgets.tsx`; `taxes-next-due` tiene un defecto abierto, ver
  "Riesgo abierto")*
- **Reportes:** ninguno. Los del periodo ya los da `/cobrar/dgii`
- **Emite:** `taxes.filing.closed`
- **Requiere:** ninguno · **Recomienda:** `ap`, `ar`, `accounting`

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ validado contra `defineModule` |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/taxes.test.ts` — 37 casos: aislamiento en las 4 tablas, escritura con `tenant_id` ajeno, modulo apagado (lectura y escritura), el trigger por triplicado, el trigger **en UPDATE**, la declaracion presentada que no se borra ni se reescribe (9 casos), el 607 que deja fuera lo vendido sin NCF, y 15 restricciones de tabla |
| 3 | Logica pura con cobertura | ✅ `packages/operations/src/taxes.test.ts` — 53 pruebas: fin de semana al lunes, diciembre rodando a enero, dias restantes, desglose que cuadra al centavo, base de ITBIS vs base de ISR, base de servicios en factura mixta, desempate entre varias reglas candidatas, porcentaje a fraccion, cadena del saldo a favor, comodin `ambas`, exento |
| 4 | UI web responsive | ⚠️ registrado en `bootstrap.ts` y las 4 rutas responden en verde con los 3 roles de `pnpm sonda:rutas`. Lo que falta es mirarlas: nadie las ha abierto en un navegador de verdad, ni a ancho de telefono |
| 5 | UI movil | 🔜 `platforms.mobile = false`, `mobileScope` vacio, igual que la fila del catalogo |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente — `packages/core/src/tours.ts` es de quien coordina |
| 8 | Datos demo | 🔜 pendiente — `supabase/seed/demo.sql` es compartido. La pantalla trae un boton para sembrar 18/16/exento |
| 9 | ≥2 widgets | ⚠️ los dos pintados en `components/widgets.tsx`. Pero `taxes-next-due` busca `status = 'pending'` y este modulo no escribe esa fila nunca: siempre dice "nada pendiente". Ver "Riesgo abierto" |
| 10 | Eventos documentados | ✅ emite `taxes.filing.closed`; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ ya cargados en `regb.module_pricing` (400/1500/4000 · 45/160/420) y la migracion lo verifica |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | 🔜 sin sonda: las pantallas no se pueden abrir todavia |

## Lo que NO hace

- **No genera ni toca los 606, 607 ni 608.** Ya existen completos. El
  calendario enlaza a `/cobrar/dgii`; no lo duplica ni lo mueve.
- **No escribe la retencion en la factura del proveedor.**
  `supplier_invoices.retention_amount`, `isr_retained` e
  `isr_retention_type` siguen siendo de `/pagar`. Enganchar la
  calculadora ahi es el paso siguiente obvio, y esta declarado.
- **No postea a contabilidad.** El asiento de ITBIS por pagar contra
  ITBIS adelantado al cerrar no se genera: `accounting` es
  `recommends`, no `requires`, y un modulo opcional no puede escribir
  asientos.
- **No conoce los feriados dominicanos.** El vencimiento solo corre de
  sabado o domingo al lunes. Mejor un vencimiento un dia antes de tiempo
  que uno inventado.
- **No modela el RST, ni zonas francas, ni regimenes especiales.** Asume
  contribuyente ordinario de ITBIS con declaracion mensual. Un proveedor
  de zona franca se marca `is_exempt` a mano y ya.
- **No calcula el ISR anual (IR-2 / IR-1) ni el anticipo.** Solo
  retenciones mensuales, que es lo que alimenta el 606 y el IR-17.
- **No transmite nada a la DGII ni a la Oficina Virtual.** Eso es
  `e-invoice` (25), que tiene su propio `ecf.ts` y su certificado
  digital.
- **No hay IVA de otros paises** pese a que el catalogo dice "ITBIS/IVA".
  El esquema no lo impide —`kind` y `rate` en fraccion dan para mas—,
  pero las tasas, los codigos y los vencimientos sembrados son de la DGII
  y de nadie mas.
- **No trae el ITBIS que los clientes me retuvieron a mi.** Ese dato no
  existe en ninguna tabla del repo: las facturas de venta no tienen campo
  de retencion recibida. `itbis_withheld` se escribe a mano al cerrar y
  nadie lo valida contra nada.
- **No recalcula una declaracion cerrada**, y es el punto entero de
  guardarla. Corregir se hace con una rectificativa, fuera del sistema.
- **Ningun otro modulo lee `public.tax_rates` todavia.** El catalogo es
  la lista de tasas con su vigencia, para consultarla y ponerse de
  acuerdo; el unico calculo que la usa es el contraste del ITBIS en la
  calculadora de retenciones. `products`, `pos_sale_lines`,
  `sales_order_lines`, `purchase_order_lines` y `quote_lines` siguen con
  su `default 0.18` y con la tasa por linea que se teclea en Productos,
  asi que **cambiar la tasa por defecto aqui no cambia lo que factura la
  caja**. La pantalla lo dice donde se ve, el tagline y la feature 1 del
  catalogo se reescribieron para no prometerlo, y engancharlo es el paso
  siguiente declarado.

## Riesgo abierto

**El widget `taxes-next-due` siempre dice que no hay nada pendiente.**
Consulta `tax_filings where status = 'pending'`, y ningun camino de este
modulo escribe esa fila: `cerrarLiquidacion` inserta `'filed'`,
`registrarInformativo` inserta `'filed'` y `marcarPagada` pasa a
`'paid'`. El modelo del calendario es el contrario —lo pendiente se
deriva de la **ausencia** de fila—, asi que en `tax_filings` solo hay lo
ya presentado. El widget no pinta vacio: afirma lo contrario de lo que
pasa, y contradice a `/impuestos/calendario`, que en ese mismo momento
puede tener tres obligaciones en rojo. Se arregla dandole la vuelta a la
consulta (calcular las obligaciones con `calendarioFiscal` y restar las
filas que existan, como hace el calendario) **o** sembrando filas
`'pending'` al abrir el periodo, que cambiaria el modelo del calendario y
la guarda de duplicado de `cerrarLiquidacion`. `components/widgets.tsx`
lo coordina otra persona: hay que acordar de que lado se arregla antes de
tocarlo.

Las tasas (18% / 16%) y los dias de vencimiento (10 / 15 / 20) son de la
ley dominicana **segun se entiende hoy, sin verificar contra una norma
publicada este año**. Se siembran como punto de partida editable y la
pantalla lo dice —con el mismo tono con que el aviso del TXT de envio en
`/cobrar/dgii` admite que no se ha comparado contra un archivo aceptado—,
pero el riesgo real es que el primer cliente confie en el valor sembrado
sin revisarlo. Por eso el boton dice "sembrar" y no "configurar", y solo
aparece cuando no hay ninguna tasa.

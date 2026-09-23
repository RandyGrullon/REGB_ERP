# `imports` — Importar

**Que resuelve:** traer el catalogo de productos -con codigo de barras e
ITBIS- y las **existencias iniciales** desde un CSV sin teclearlos, con el
motivo de cada fila rechazada y un **deshacer** exacto: borra los
productos que ese archivo creo, o registra el movimiento contrario de las
existencias que cargo.

**Categoria:** `core` (§5.1 #14) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** `products` ·
**Plataformas:** web ✔️ desktop ✔️ movil ✖️

---

## El permiso del destino manda

Importar productos exige `imports.create` **y** `products.create`; deshacer
exige `imports.edit` **y** `products.delete`. Si no, un rol sin permiso de
crear productos los crearia de a 3,000 por la puerta de importar. Por eso el
manifiesto declara `requires: ['products']`: la dependencia es dato, y
`audit:registry` solo tolera referencias a lo declarado.

Cargar **existencias** exige `imports.create` **y** `inventory.adjust`, y
cada fila pasa ademas por el `max_amount` del rol con su valor
(cantidad x costo), igual que el ajuste manual: una fila por encima del
limite se rechaza con el motivo y las demas entran. Deshacerlas exige
`imports.edit` **y** `inventory.adjust`. Sin el modulo `inventory` activo,
`exigir()` lo niega y la tarjeta no aparece.

## Deshacer es exacto porque cada producto sabe de que lote vino

Cada importacion crea una fila en `public.import_batches`
([`0016_core_platform.sql`](../../supabase/migrations/0016_core_platform.sql))
y cada producto que inserta lleva `import_batch_id`. Deshacer borra
`where import_batch_id = <lote>` y nada mas, y marca el lote con
`undone_at`: el historial de la importacion no se borra.

- Un SKU que ya existia **no se inserto**, asi que conserva su
  `import_batch_id` (el de otro lote, o ninguno) y deshacer no lo toca.
  Probado: deshacer un lote donde todo ya existia borra 0 productos.
- El lote se **reclama primero** (`update ... where undone_at is null
  returning id`): un segundo clic dice "Esa importacion ya estaba
  deshecha." y no emite un segundo evento.
- **Todo o nada.** Las FK hacia `products` son sin cascada (ventas,
  kardex, conteos, escaneos...). Si un producto del lote ya se uso, el
  `delete` falla con `23503`, la transaccion entera vuelve atras -el lote
  sigue sin deshacer, ningun producto se borra- y la pantalla dice
  "algunos productos de esta importacion ya se usaron... Desactivalos
  desde Productos". Antes era un error de servidor.
- Un `batchId` que no es un uuid se niega con "Esa importacion no
  existe." en vez de reventar en la base.

## Cada fila cae en uno de tres montones

`total_rows = nuevos + ya existian + rechazadas`, y el lote guarda los tres:

| Monton | Donde queda | Que le pasa al producto |
|---|---|---|
| **Nuevo** | `inserted` | Se crea con `import_batch_id` del lote |
| **Ya existia** | entradas `kind: 'skipped'` en `errors`, con linea y codigo | Nada: `on conflict (tenant_id, sku) do nothing`. Importar no sobrescribe |
| **Rechazada** | `rejected`, y su motivo en `errors` (sin `kind`) | No se crea |

`inserted` sale del `returning id` de cada insert: sin fila de vuelta, el
SKU ya existia. Antes se guardaba `valid.length` y un archivo de 200
productos que ya estaban decia "Entraron: 200" sin haber entrado ninguno.

`rejected` cuenta **filas**, no mensajes: si falta la columna del codigo o
del nombre hay uno o dos mensajes de encabezado y caen todas las filas
(`validateProducts().rejectedRows`).

El aviso lo dice con numeros: "Importamos 2 productos nuevos. 1 ya existia
y lo dejamos como estaba. 2 filas rechazadas: mira el detalle abajo." Si
no entro ningun producto nuevo es un aviso de **error**, aunque el
archivo se procesara: nadie debe cerrar la pantalla creyendo que subio su
catalogo.

Los "ya existian" viven en la columna `errors` porque la tabla no tiene
una columna propia y esta entrega no crea migraciones. Una columna
`skipped integer` seria mas limpia; queda como pendiente opcional.

El `errors` del lote se guarda con `${JSON.stringify(errors)}::text::jsonb`
y no con `::jsonb` directo: con el cast directo postgres.js serializa dos
veces y la columna guarda un string. Fijado en
`supabase/tests/jsonb-params.test.ts`.

## Lectura del CSV

`detectarDelimitador()`, `parseCsv()` y `validateProducts()`
([`packages/core/src/csv.ts`](../../packages/core/src/csv.ts)):

| Acepta | Ejemplo |
|---|---|
| Coma **o** punto y coma como separador: uno por archivo, el que mas aparece en la linea de encabezados | `sku;nombre` (lo que exporta Excel en espanol) |
| Comillas, separador dentro de comillas, comillas escapadas, CRLF | `"Arroz, selecto"` |
| Encabezados en varios idiomas, con o sin acentos | `Código`, `Descripción`, `PVP` |

Antes se cortaba por `,` y `;` a la vez: el CSV de un Excel en espanol
(`;` y `1.234,56` sin comillas, porque ahi la coma no separa) partia cada
precio en dos columnas y el precio entraba como `1.234` -> RD$1.23.

Obligatorias: codigo (`sku`/`codigo`/`referencia`) y nombre. Sin precio se
asume 0. Un codigo repetido **dentro del mismo archivo** se rechaza con su
linea. Precio o costo negativos se rechazan por fila (el costo negativo
antes pasaba y el `check (cost >= 0)` de la base tumbaba la importacion
entera).

## Codigo de barras e ITBIS

`PRIMER-CLIENTE.md` y `HARDWARE-Y-DGII.md` decian que el CSV traia el
codigo de barras, y no lo traia: el lector no servia hasta editar cada
producto, y cada exento (arroz, habichuela, platano) igual. Ahora
`PRODUCT_COLUMNS` tiene tres columnas mas
([`csv.ts`](../../packages/core/src/csv.ts)):

| Columna | Encabezados | Que acepta |
|---|---|---|
| `barcode` | codigo de barras, barcode, cod barras, ean, upc, gtin | Numeros, letras y guiones, 3 a 64, tal cual (un `0` delante se conserva) |
| `taxRate` | itbis, tasa, tasa itbis, tasa de itbis, impuesto, tax, tax rate | `18%`, `18`, `0.18`, `0,18`, `16%`, `0.16`, `0`, `0%`, `exento` |
| `exempt` | exento, exenta, exento de itbis | si / no, `x`, `1` / `0` |

- **No pasan por la regla de los numeros.** Un codigo de barras es texto, y
  una tasa solo puede ser 0, 16% o 18%: `0,18` no es ambiguo y no decide
  como se leen los precios del archivo (fijado en
  `csv-barras-itbis.test.ts`).
- **Tasa vacia = la del cliente.** La base pone
  `public.tasa_itbis_por_defecto()` (0118), no el 0.18 fijo del default de
  columna. Con ITBIS-16 por defecto en Impuestos, un producto sin tasa
  nace al 16%.
- **Se rechaza, no se adivina:** una tasa que no es 0/16/18 (`12%`, `1`,
  `100%`); `exento = si` con tasa positiva; `exento = no` con tasa 0; un
  codigo en notacion cientifica (`7.46E+12`, lo que hace Excel si la
  columna no es Texto: ya perdio digitos); un codigo con espacios o
  simbolos; un codigo repetido en el archivo.
- **Un codigo de barras que ya tiene OTRO producto** se rechaza en su fila
  con el SKU del dueño. Antes de esto el indice unico
  `(tenant_id, barcode)` habria tumbado la importacion entera. Si el
  dueño es el mismo SKU, la fila cae en "ya existia". Estos rechazos los
  ve solo la base: la accion los suma a `rejected` y a `errors`, y el
  invariante `total_rows = nuevos + ya existian + rechazadas` sigue.

## Existencias iniciales (`target = 'stock'`, 0133)

El unico camino con costo era el "Ajuste manual" de `/inventory`, pegando
el UUID del producto, uno por uno. Ahora un CSV con **codigo, almacen,
cantidad y costo unitario** (`STOCK_COLUMNS`, `validateStock()`):

| Columna | Encabezados | Regla |
|---|---|---|
| `sku` | sku, codigo, code, referencia, codigo de barras | **Obligatoria.** El SKU o el codigo de barras del producto |
| `warehouse` | almacen, warehouse, bodega, deposito | Nombre o codigo del almacen activo. Vacio = el predeterminado (o el unico) |
| `qty` | cantidad, qty, existencia, existencias, stock, unidades | **Obligatoria.** Mayor que cero: esto carga, no saca |
| `unitCost` | costo unitario, costo, cost, unit cost, precio compra | Vacio = el costo del catalogo; si tampoco hay, la fila se rechaza |

- **Los numeros siguen la misma regla** (cantidad y costo deciden el
  formato del archivo): `1,500` en un archivo de RD es 1500; `1.500` se
  rechaza como ambiguo; en un Excel en español, `1.500` es 1500.
- **Cada fila buena es un `adjustment_in` CON costo**, con
  `reference_type = 'import_batch'` y el id del lote. Alimenta el costo
  promedio por el trigger de 0019 (probado: 10 a 1,000 -> promedio 1,000).
  Sin costo, el promedio naceria contra un monton fantasma de costo cero
  ([inventory.md](inventory.md), "La trampa que subvaloro el inventario").
- **Ya tenia existencia -> se deja** (`kind: 'skipped'`, "ya tiene 5 en
  Principal"): si el producto no esta en cero en ese almacen, la fila no
  entra. Corregirla es un ajuste. Esta regla es la que hace exacto el
  deshacer.
- **Se rechaza con motivo:** codigo que no existe ("importalo primero en
  Productos"); producto sin control de existencias (el trigger de 0100
  tumbaria el archivo entero); almacen que no existe (lista los validos);
  el mismo producto dos veces en el mismo almacen -tambien si una fila lo
  dice por nombre y otra lo deja vacio-; sin costo en la fila ni en el
  catalogo; por encima del `max_amount` del rol.
- **Sin ningun almacen activo** no se crea lote: "Crea uno en
  Existencias > Almacenes".

### Deshacer existencias: el movimiento contrario

El kardex no se borra. Deshacer inserta, por cada movimiento del lote, un
`adjustment_out` por la misma cantidad con `reference_type =
'import_batch_undo'`: cada linea vuelve a cero y el kardex conserva los
dos. Como solo se carga donde habia cero, volver a cero es exacto en
cantidad y en valor (a cero, el promedio no pesa; la siguiente entrada lo
reinicia).

- Se **niega entero** si algo movio esas existencias despues de cargarlas
  (una venta, un ajuste, un traslado): revertir ya no las dejaria en cero.
  El lote sigue sin deshacer y no se inserta nada. Probado con una venta.
  (La prueba destapo el caso: una venta trae `reference_type` NULL y un
  `not (... = ...)` la dejaba pasar; ahora es `is distinct from`.)
- El lote se reclama primero, como el de productos: un segundo clic dice
  "ya estaba deshecha". Despues de deshacer se puede volver a cargar.
- El deshacer **de productos** solo reclama lotes `target = 'products'`:
  con un lote de existencias dice "se deshace con su propio boton" y no lo
  marca (antes lo habria marcado deshecho sin tocar sus movimientos).

## La regla de los numeros

**Se lee lo inequivoco. Lo ambiguo solo se resuelve como separador de
miles, y solo si el archivo lo respalda. Lo demas se rechaza con su
motivo; nunca se adivina.**

Ambiguo es **una sola forma**: un unico separador, 1 a 3 digitos antes (sin
cero delante) y exactamente 3 despues -`1,234`, `1.234`, `12.500`-.
Cualquier otra forma dice sola cual es el decimal: el separador de miles
va seguido siempre de 3 digitos, y el decimal aparece una sola vez.

**El formato del archivo** (`formatoDelArchivo()`) sale de sus celdas de
precio **y** costo -un archivo sale de un solo Excel-:

| El archivo tiene... | Formato |
|---|---|
| Alguna celda que prueba punto decimal (`215.00`, `1,234.56`, `1,234,567`) y ninguna con coma decimal | `rd` |
| Alguna celda que prueba coma decimal (`12,50`, `1.234,56`, `1.234.567`) y ninguna con punto decimal | `eu` |
| De las dos | `mixto` |
| Ninguna prueba (solo enteros y formas ambiguas) | el separador del CSV: `,` -> `rd`, `;` -> `eu` |

**La tabla completa** (fijada en `csv.test.ts`):

| Celda | Archivo `rd` | Archivo `eu` | Archivo `mixto` |
|---|---|---|---|
| `1234` | 1234 | 1234 | 1234 |
| `1,234` | **1234** | rechazo: ambiguo | rechazo: ambiguo |
| `1.234` | rechazo: ambiguo | **1234** | rechazo: ambiguo |
| `1,234.56` | 1234.56 | 1234.56 | 1234.56 |
| `1.234,56` | 1234.56 | 1234.56 | 1234.56 |
| `1234.56` / `215.00` | 1234.56 / 215 | igual | igual |
| `12,50` / `0,500` | 12.50 / 0.50 | igual | igual |
| `1,234,567` / `1.234.567` | 1234567 | 1234567 | 1234567 |
| `RD$ 1,234.00`, `RD $ 215`, `US$ 10.50`, `DOP 1,500.00`, espacio duro | se quita la moneda y los espacios de los bordes | | |
| `-1,234.56`, `RD$ -500`, `-RD$ 500`, `(1,234.56)`, `−500` | negativo -> rechazo "no puede ser negativo" en precio y costo | | |
| `gratis`, `12 34`, `1 234,56`, `1,23.45`, `1.234.56`, `1234.`, `--5`, `(-5)`, `10 lb` | rechazo: "no es un numero" | | |

Por que `1.234` se rechaza en un archivo `rd` aunque "en RD el punto es
decimal": un monto con tres decimales no cabe en `numeric(12,2)` -se
redondearia a 1.23, que es justo el dano que se arregla-, y en RD hay
quien escribe `RD$1.500` queriendo decir mil quinientos. Lo mismo, al
reves, para `1,234` en un archivo `eu`.

El rechazo de un ambiguo dice los dos valores posibles, cita la celda que
fijo el formato y como escribirlo:

> "1,234" es ambiguo: puede ser 1234 o 1 con 234 milesimas. Este archivo
> usa coma decimal (linea 3: "12,50"). No adivinamos: escribelo sin
> separador de miles (1234) o con sus decimales (1.234,00).

Un valor inequivoco con mas de dos decimales (`0.125`, `1234,567`) se lee
tal cual y la columna `numeric(12,2)` lo redondea al guardar.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/importar` | `imports.view` | Tarjeta **Productos** (con codigo de barras e ITBIS) y tarjeta **Existencias iniciales** (`#existencias`, solo con `inventory.adjust`); historial de 25 lotes con tipo, nuevos / ya existian / rechazadas, el deshacer que corresponde a cada tipo y el detalle de cada monton |

`/inventory` enlaza a `/importar#existencias` desde su estado vacio y
desde el ajuste manual.

```
┌─ Catalogo > Importar ──────────────────────────────────────────────────┐
│ Importar                                                               │
│ ┌Importaciones┐ ┌Productos creados┐ ┌Existencias┐ ┌Ya exist.┐ ┌Rech.┐  │
│ │      3      │ │       398       │ │    210    │ │   13    │ │  7  │  │
│ └─────────────┘ └─────────────────┘ └───────────┘ └─────────┘ └─────┘  │
│ ┌ Productos ─────────────────────────────────────────────────────────┐ │
│ │ [Elegir archivo…]                           (Importar productos)   │ │
│ │ codigo — sku · codigo · código · code · referencia   [obligatoria] │ │
│ │ codigo de barras — … · ean · upc     tasa de ITBIS — itbis · tasa… │ │
│ │ Numeros: 1,234.56 y 1.234,56 se leen igual; si uno se puede leer   │ │
│ │ de dos maneras (1.234) la fila se rechaza y te decimos por que.    │ │
│ │ ITBIS: 18%, 16%, 0 o exento. Vacio = la tasa por defecto.          │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ ┌ Existencias iniciales ─────────────────────────────────────────────┐ │
│ │ [Elegir archivo…]                           (Cargar existencias)   │ │
│ │ codigo · almacen · cantidad [obligatoria] · costo unitario         │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ Archivo             Tipo        Cuando        Filas Nuevos Ya ex. Rech.│
│ ferreteria-sept.csv Productos   18 sept 10:05   215    198    13    4  │
│ existencias.csv     Existencias 18 sept 22:40   214    210     1    3  │
│                                                          (Deshacer)    │
│ > 4 filas rechazadas y 13 que ya existian en ferreteria-sept.csv       │
│   Rechazadas: no entraron                                              │
│   Linea 17 · price — "gratis" no es un numero.                         │
│   Linea 40 · price — "1.234" es ambiguo: puede ser 1234 o 1 con 234…   │
│   Ya existian: los dejamos como estaban                                │
│   Linea 3 · sku — El codigo "EXIST-1" ya existia: lo dejamos como…     │
└────────────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `imports.view` | Abre `/importar` |
| `imports.create` | Importar productos (junto con `products.create`) o existencias (junto con `inventory.adjust` y su `max_amount`) |
| `imports.edit` | Deshacer productos (con `products.delete`) o existencias (con `inventory.adjust`) |
| `imports.delete`, `imports.export` | Declarados; ninguna accion los usa |

## Eventos

Se emiten con `public.emit_event()` **dentro** de la transaccion del
lote: si la importacion o el deshacer se revierten, el evento tampoco
existe.

| Evento | Cuando | Payload |
|---|---|---|
| `imports.batch.completed` | Al terminar cada importacion, entre o no algo nuevo (el lote existe igual) | `{ batchId, target: 'products' \| 'stock', fileName, totalRows, inserted, skipped, rejected }` |
| `imports.batch.undone` | Al deshacer un lote, una sola vez por lote. No se emite si el deshacer se niega | productos: `{ batchId, deleted }` · existencias: `{ batchId, target: 'stock', reversed }` |

No escucha ninguno. Fijados en `importar.accion.test.ts` y en el contrato
de `apps/web/src/lib/eventos-declarados.test.ts`.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega. El catalogo (0009) no declara el `requires: products` que si declara el manifiesto |
| 2 | Migraciones + RLS probadas | ⚠️ la red de `isolation.test.ts`, la trampa del jsonb (`jsonb-params.test.ts`) y 26 pruebas de accion contra la base: **`importar.accion.test.ts`** (11: `1,234` guardado como 1234.00, SKU existente intacto, conteos, eventos, deshacer exacto, FK, permiso del destino), **`barras-itbis.accion.test.ts`** (5: codigo de barras, exento, 18/16%, tasa por defecto del cliente, codigo ajeno rechazado en su fila, deshacer) y **`existencias.accion.test.ts`** (10: carga con costo al promedio, ya tenia, 6 motivos de rechazo, evento, deshacer con el movimiento contrario, negado tras una venta, max_amount, sin almacen). 0133 amplia `import_batches.target` a `'stock'`. Sin prueba de aislamiento propia de `import_batches` |
| 3 | Logica pura con cobertura | ✅ `csv.test.ts` — 89 pruebas: la tabla de numeros entera (incluidos los ambiguos), el formato del archivo, el separador del CSV, costo negativo y conteo de filas rechazadas. `csv-barras-itbis.test.ts` — 52: encabezados, tasas validas e invalidas, exento, codigo de barras, contradicciones, la tasa no decide el formato. `csv-existencias.test.ts` — 12: encabezados, cantidad con la regla de numeros, ambiguos, cero/negativo, costo negativo, repetido por almacen |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ➖ no aplica: `platforms.mobile = false` |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ⚠️ `f13.importar` tiene 5 pasos; `core.bienvenida` (modulo `tour`) le dedica uno mas |
| 8 | Datos demo | ❌ la siembra no crea lotes |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ✅ los dos declarados se emiten, con su payload (ver Eventos) |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/importar` en la sonda de F4: la subida de CSV fue uno de los 5 controles sin nombre corregidos; tercera pasada sin fallos |

## Lo que NO hace

- **Vista previa antes de cargar.** En un mismo clic se validan las filas,
  las buenas se insertan y las malas se reportan con su motivo -incluido el
  numero ambiguo-. No hay paso de confirmacion. La pantalla ya no dice
  "validamos antes de guardar"; el tour `f13.importar`
  (`packages/core/src/tours.ts`, fuera del alcance de esta entrega) todavia
  dice "te avisa ANTES de cargar".
- **Actualizar un producto que ya existe.** Un SKU existente se deja como
  estaba y se cuenta aparte ("ya existian"). Para cambiarlo hay que
  editarlo en Productos.
- **Tratar `a1` y `A1` como el mismo codigo contra la base.** Dentro del
  archivo el repetido se detecta sin distinguir mayusculas; pero el
  `unique (tenant_id, sku)` de la base si distingue, asi que `a1` en el
  archivo con `A1` ya en el catalogo entra como producto nuevo.
- **Clientes, saldos de cuentas por cobrar, XLSX, plantilla descargable.**
  El tour `f13.importar` habla de clientes y de "baja la plantilla"; §5.1 y
  el catalogo prometen XLSX y mapeo visual. Hoy hay CSV de productos y de
  existencias iniciales, y el mapeo es automatico por nombre de columna.
- **Existencias: lotes y series.** La carga no asigna lote a un producto
  con `tracks_lots`; esos se cargan desde Lotes.
- **Existencias: corregir una que ya tenia.** Un producto que no esta en
  cero en ese almacen se deja como estaba; se corrige con un ajuste en
  `/inventory`, que ahora busca el producto por nombre, codigo o codigo de
  barras.
- **Cambiar el codigo de barras o la tasa de un producto que ya existe.**
  Importar no sobrescribe (se cuenta en "ya existian").
- **Deshacer un lote cuyos productos ya se usaron.** Se niega entero y lo
  dice (ver "Deshacer es exacto"); no borra la parte que no se uso. El
  camino para esos productos es desactivarlos.

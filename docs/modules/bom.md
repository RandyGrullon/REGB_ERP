# `bom` — Lista de materiales

**Que resuelve:** costeo multinivel real -un componente puede tener su
propia receta, y el costo se resuelve recursivamente-, versiones -solo
una activa por producto a la vez, corregir crea la version siguiente-,
y sustitutos con criterio real segun stock disponible.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `products` · **Recomienda:** `inventory`

---

## Multinivel de verdad, no de un solo nivel

`costoUnitarioMultinivel()` (`@regb/operations`) es una funcion
recursiva pura: si un nodo no tiene sub-receta, su costo es el directo
del producto; si la tiene, es la suma de sus sub-componentes -cada uno
resuelto de la MISMA manera-. La recursion en si vive en el servidor
(`resolverNodo()` en la pagina de detalle), que arma el arbol
consultando, para cada componente, si tiene su propia lista de
materiales ACTIVA antes de decidir si expandirlo o usar su costo
directo. Verificado en vivo con un caso real de dos niveles: un "kit
basico de reparacion" que usa una "varilla reforzada" como componente,
y esa varilla reforzada tiene su PROPIA receta (varilla + un poco de
pintura). El costo del kit se calculo en RD$1,081.00 -no el costo
directo declarado en el catalogo del sub-ensamble, sino el resultado
real de expandir su receta-. Para confirmar que la recursion es
genuina y no una coincidencia (el costo directo del sub-ensamble
coincidia a proposito con su costo calculado), se alteró
temporalmente una cantidad dentro de la receta del sub-ensamble: el
costo del kit cambio de inmediato a RD$1,793.00, reflejando el nuevo
calculo -confirmando que de verdad recorre el arbol, no usa un valor
plano-.

## Versiones, no ediciones silenciosas

Solo una version por producto puede estar `active` a la vez (indice
unico parcial). Un BOM deja de ser editable en cuanto sale de `draft`
-corregirlo significa crear la version siguiente, no reescribir la que
ya se publico-. La unica excepcion es la transicion natural
`active → obsolete` cuando se activa una version nueva del mismo
producto: eso no es una correccion, es el ciclo de vida esperado, y el
trigger de inmutabilidad la permite explicitamente sin abrir la puerta
a ninguna otra edicion.

## Sustitutos con la misma tabla, no una aparte

`bom_lines.is_substitute_for` apunta a la linea principal que
reemplaza -no hay una tabla de sustitutos por separado-.
`elegirComponente()` decide cual usar segun el stock disponible de
cada uno: el principal si alcanza, el sustituto si el principal no
alcanza pero el sustituto si, o faltante real si ninguno alcanza -nunca
se inventa disponibilidad-.

## Un producto no puede ser componente de su propio BOM

Un trigger bloquea el caso directo de referencia circular. Ciclos mas
profundos entre varios productos (A usa B, B usa A) NO se detectan
-limitacion conocida, declarada explicitamente-; el resolvedor de
costo tiene un tope de profundidad (10 niveles) como red de seguridad
para no entrar en un bucle infinito si un ciclo asi llegara a existir.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/bom` | `bom.view` | Lista de BOMs con su estado, crear uno nuevo |
| `/bom/[id]` | `bom.view` | Componentes con sustitutos anidados, costeo multinivel calculado, activar version |

## Manifiesto

- **Permisos:** `view`, `manage`
- **Widgets:** `boms-active`
- **Requiere:** `products` · **Recomienda:** `inventory`
- **Emite:** `bom.version.activated`
- **Plataformas:** web y escritorio -sin movil, `platforms.mobile = false`-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/bom.test.ts` — 11 casos: aislamiento, spoofing de tenant via producto/componente/BOM ajenos, un producto no puede ser su propio componente, BOM editable solo en draft, una sola version activa por producto, modulo apagado, checks de tabla (estado invalido, version duplicada) |
| 3 | Logica pura con cobertura | ✅ `bom.ts` — 8 pruebas: costeo de un solo nivel, costeo multinivel real (un componente con su propia receta), explosion de cantidad, seleccion de componente segun stock |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: un BOM de dos niveles calculando su costo correctamente (RD$1,081.00), la recursion confirmada genuina alterando la receta del sub-ensamble y viendo el costo del padre cambiar (RD$1,793.00), y el BOM activado en vivo con su inmutabilidad posterior confirmada |
| 5 | UI movil | N/A — el modulo declara `platforms.mobile = false` a proposito |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un sub-ensamble ya activo (varilla reforzada, con su propia receta) y un producto terminado (kit basico de reparacion) cuyo BOM se activo en vivo durante la verificacion |
| 9 | ≥2 widgets | ⚠️ solo 1 (`boms-active`): el modulo es principalmente costeo y estructura de receta, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Detectar ciclos profundos.** Solo bloquea el caso directo (un
  producto como su propio componente); un ciclo entre varios productos
  no se detecta -el resolvedor de costo tiene un tope de profundidad
  como red de seguridad, no una deteccion real-.
- **Escribir el costo calculado de vuelta a `products.cost`.** El
  costeo multinivel es para consulta; el costo directo del producto en
  el catalogo no se actualiza automaticamente.
- **Reabrir un BOM obsoleto o activo para editarlo.** Corregir
  significa crear la version siguiente, nunca reescribir la anterior.

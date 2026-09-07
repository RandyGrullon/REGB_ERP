# `lots-serials` — Lotes, series y vencimientos

**Que resuelve:** trazabilidad real por lote o numero de serie, con
FEFO -first-expired-first-out- resuelto por un algoritmo, alertas de
vencimiento antes de que sea tarde, y recall real sobre un producto
entero o un lote especifico.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `inventory`

---

## FEFO es un algoritmo, no una tabla que alguien revisa a mano

`seleccionFefo()` (`@regb/operations`) recibe los lotes disponibles de
un producto en un almacen y reparte la cantidad pedida empezando por
el que vence mas pronto -los lotes sin vencimiento van al final,
porque un lote CON fecha siempre es mas urgente-. `consumirFefo()` en
`actions.ts` corre este algoritmo de verdad: postea un movimiento de
inventario POR CADA LOTE que toca, no uno solo con el total. Verificado
en vivo consumiendo 10 unidades de pintura con tres lotes disponibles
(3 ya vencidas, 8 por vencer, 20 lejanas): el sistema tomo las 3
vencidas primero y 7 de las por vencer, dejando 1 sin tocar -nunca
toco el lote lejano-.

## Un item serializado no es un concepto aparte

No existe una columna `serial_number` separada. Un item serializado es
simplemente un lote de cantidad 1 cuyo `lot_number` ES el numero de
serie -mantiene el esquema en una sola idea (lote), no dos conceptos
que hacer coincidir-.

## La vigencia de un lote reutiliza lo que ya existia

`loteVigente()` es literalmente `certificadoVigente()` de
`training.ts` reexportada con otro nombre -la misma pregunta ("esto ya
vencio?") que ya se resolvio para certificados de empleados, sin
reinventarla-. `loteProximoAVencer()` es la unica funcion nueva:
clasifica un lote como "por vencer" solo si todavia esta vigente pero
le quedan pocos dias -nunca confunde un lote por vencer con uno YA
vencido, son dos alertas distintas-.

## Una tabla nueva de existencia, un movimiento nuevo en la existente

`lot_stock` desglosa `stock_levels` (0019) por lote, no lo reemplaza:
sigue siendo una proyeccion que muta con cada movimiento, sin trigger
de inmutabilidad -igual que `stock_levels`-. `inventory_movements`
(0019) gana una columna nueva y opcional, `lot_id` -aditiva, ningun
movimiento viejo ni de un producto sin `tracks_lots` necesita
llenarla-. El trigger que ya proyecta el kardex a `stock_levels` sigue
funcionando exactamente igual, sin saber que esta columna existe.

## Un lote es un registro vivo; un recall cerrado es terminal

A diferencia de la mayoria de tablas de esta serie, `product_lots` NO
lleva trigger de inmutabilidad -corregir una fecha de vencimiento mal
capturada es una correccion de datos legitima, mismo criterio que los
objetivos de OKR en `performance` (0059)-. `product_recalls` si es un
flujo con estados: `open` es editable, `closed` es terminal.

## Honesto sobre lo que todavia no hace

`consumirFefo()` es una accion MANUAL -todavia NO esta conectada al
checkout de `sales-orders` o `pos`, que seguirian vendiendo sin elegir
lote automaticamente-. Tampoco distingue el PROPOSITO del consumo: el
algoritmo elige el lote que vence mas pronto sin importar si ya esta
vencido, asi que "vender" y "dar de baja por vencimiento" usan la
misma accion sin que el sistema imponga la diferencia -la razon que
escribe quien consume es la unica documentacion de cual fue-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/lotes` | `lots-serials.view` | Lotes con vencimiento y existencia total, registrar lote, consumir por FEFO, abrir/cerrar recalls |

## Manifiesto

- **Permisos:** `view`, `manage`, `recall`
- **Widgets:** `lots-expiring-soon`
- **Requiere:** `inventory`
- **Emite:** `lots-serials.lot.registered`, `lots-serials.recall.opened`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/lots-serials.test.ts` — 13 casos: aislamiento, spoofing de tenant via producto/almacen/lote ajenos en las tres tablas nuevas, lote editable siempre, recall editable solo mientras `open`, modulo apagado, checks de tabla (lote duplicado, estado de recall inventado, existencia negativa) |
| 3 | Logica pura con cobertura | ✅ `lots-serials.ts` — 11 pruebas: FEFO elige el que vence primero, sigue al siguiente lote si el primero no alcanza, lotes sin vencimiento al final, cobertura insuficiente, clasificacion por-vencer vs vencido. Reutiliza `certificadoVigente()` de `training.ts` sin duplicar |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: consumidas 10 unidades reales por FEFO (3 del lote vencido + 7 del por vencer, confirmado en `inventory_movements` y `lot_stock`), recall cerrado y bloqueado contra edicion posterior. Estado restaurado al canonico de la siembra despues de verificar |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ tres lotes de la misma pintura -uno por vencer en 10 dias, uno vencido hace 15 dias con un recall abierto de verdad, uno lejano sin problema- |
| 9 | ≥2 widgets | ⚠️ solo 1 (`lots-expiring-soon`): el modulo es principalmente trazabilidad, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos |

## Lo que NO hace

- **Elegir el lote automaticamente al vender.** `consumirFefo()` es una
  accion manual; la integracion con el checkout de `sales-orders`/`pos`
  es un paso futuro.
- **Bloquear la venta de un lote vencido.** El algoritmo FEFO no
  distingue "vencido" de "por vencer": ambos son candidatos, el que
  vence mas pronto siempre gana. No hay una validacion que impida
  despachar unidades de un lote ya vencido.
- **Numeros de serie como columna aparte.** Un item serializado es un
  lote de cantidad 1; no hay una tabla ni columna de series
  independiente del concepto de lote.

# `manufacturing` — Ordenes de produccion

**Que resuelve:** lanzamiento sobre el BOM activo de un producto,
consumo real de componentes, reporte de avance con su propio
historial, y mermas contabilizadas por separado -no perdidas dentro de
"lo completado"-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `bom` · **Recomienda:** `inventory`

---

## Reutiliza infraestructura en vez de reinventarla, dos veces

`explotarCantidad()` -la misma funcion de `bom.ts` que ya calcula
cuanto de un componente hace falta para una cantidad deseada- se
reutiliza tal cual para la explosion de materiales al liberar una
orden. `progresoResultadoClave()` -la misma funcion de `performance.ts`
que calcula el avance de un resultado clave de OKR- se reutiliza para
el porcentaje de avance de la orden: es la misma pregunta ("cuanto se
ha completado de la meta?"), sin importar si la meta es un resultado
clave o una orden de produccion.

## Consumo real, no una estimacion

Liberar una orden es el UNICO momento que toca inventario de entrada:
explota la receta del BOM activo del producto -reutilizando
`explotarCantidad()`- y postea un ajuste de salida por cada componente,
de una sola vez (simplificacion deliberada tipo "backflush al
liberar", no proporcional al avance reportado despues). Verificado en
vivo liberando una orden real de 5 unidades de un kit con dos niveles
de componentes: los tres consumos (2.5, 10 y 1.25 unidades)
coincidieron exactamente con lo que la receta multinivel exigia,
confirmados en `inventory_movements`.

## Honesto sobre el consumo: por eso no se cancela liberada

Como el consumo ya paso al liberar (no es progresivo), una orden
liberada NO se puede cancelar -revertir ese consumo es un ajuste manual
de inventario, no una accion de este modulo, y se declara
explicitamente-.

## Mermas con su propio historial, no un numero final

Cada reporte de avance (`production_reports`) es un hecho historico
inmutable desde el insert, igual que una carga de combustible de
`fleet`: cuanto se completo y cuanto se mermo en ESE reporte, nunca
sobrescrito. `ordenCompleta()` decide sola cuando la orden ya cubrio lo
planificado -completado mas mermado, no solo completado- y la mueve a
`completed` automaticamente, posteando la entrada del producto
terminado por lo completado de cada reporte. Verificado en vivo: un
reporte de 3 completadas y 1 mermada (60% de avance, 25% de esa
produccion en merma), seguido de un reporte final de 1 completada mas
-4 completadas + 1 mermada = 5 planificadas- que completo la orden
sola, con las dos entradas de inventario del producto terminado
(3 y 1 unidades) confirmadas.

## Inmutabilidad por campo, no por fila entera

Una orden liberada ya no puede cambiar su "receta" (`bom_id`,
`warehouse_id`, `qty_planned`, `notes`) -eso quedo fijo al momento de
consumir el inventario-, pero `status`/`qty_completed`/`qty_scrapped`
SI avanzan libremente: es el progreso mismo de la orden, no una
correccion. Verificado que incluso una orden ya `completed` sigue
bloqueando un intento de editar `notes`.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/produccion` | `manufacturing.view` | Lista de ordenes con su avance y merma, crear una nueva sobre un BOM activo |
| `/produccion/[id]` | `manufacturing.view` | Componentes consumidos, liberar, reportar avance/merma, cancelar (solo en borrador) |

## Manifiesto

- **Permisos:** `view`, `manage`, `report`
- **Widgets:** `production-orders-in-progress`
- **Requiere:** `bom` · **Recomienda:** `inventory`
- **Emite:** `manufacturing.order.released`, `manufacturing.order.completed`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'report']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/manufacturing.test.ts` — 14 casos: aislamiento, spoofing de tenant via BOM/almacen/orden/componente ajenos en las tres tablas nuevas, receta editable solo en draft (pero progreso avanza fuera de draft), lineas y reportes inmutables desde el insert, orden completada no se borra, modulo apagado, checks de tabla (cantidad invalida, reporte vacio) |
| 3 | Logica pura con cobertura | ✅ `manufacturing.ts` — 11 pruebas: maquina de estados (liberada no se cancela), completitud de la orden, tasa de merma. Reutiliza `explotarCantidad()` de `bom.ts` y `progresoResultadoClave()` de `performance.ts` sin duplicar |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: una orden real liberada con la explosion de materiales multinivel consumida correctamente (confirmada en `inventory_movements`), dos reportes de avance -uno con merma real, otro que completo la orden sola- con las entradas de producto terminado confirmadas, e inmutabilidad de la receta verificada incluso ya completada |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una orden sobre el BOM activo del kit basico de reparacion, llevada a completada durante la propia verificacion en vivo -queda como demo real con su historial completo, mas informativo que un borrador vacio- |
| 9 | ≥2 widgets | ⚠️ solo 1 (`production-orders-in-progress`): el modulo es principalmente lanzamiento y reporte, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Consumo proporcional al avance.** Todo el consumo pasa de una vez
  al liberar (backflush), no poco a poco segun se reporta produccion.
- **Cancelar una orden ya liberada.** El inventario ya se consumio;
  revertirlo es un ajuste manual, no una accion de este modulo.
- **Ordenes multinivel de produccion.** Si un componente tiene su
  propia receta (como en `bom`), este modulo no lanza automaticamente
  una orden para producirlo -solo consume lo que ya existe en
  inventario del componente, sin importar si tiene su propio BOM-.

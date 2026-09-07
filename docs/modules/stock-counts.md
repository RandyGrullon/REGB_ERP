# `stock-counts` — Conteos ciclicos

**Que resuelve:** clasificacion ABC real -Pareto sobre el valor
acumulado, no una etiqueta a mano-, conteo CIEGO de verdad -quien
cuenta no ve el numero del sistema mientras cuenta-, y un ajuste que
necesita aprobacion antes de tocar el inventario.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `inventory` · **Recomienda:** `barcode`

---

## No reemplaza el conteo simple que ya existe

`inventory` (0019) ya trae `stock_counts`/`stock_count_lines`: abrir un
conteo, escribir lo contado junto al numero del sistema, cerrar y
ajustar de una vez. Sigue funcionando igual, sin tocarla. Este modulo
agrega las tres cosas que el catalogo promete y esa version no tiene.

## ABC es un Pareto real sobre el valor acumulado

`clasificarAbc()` (`@regb/operations`) ordena los productos de mayor a
menor valor y corta en 80% (A) / 95% (B) / resto (C) del valor
acumulado **antes** de cada producto, no despues -asi el producto que
por si solo empuja el acumulado mas alla del 80% todavia cae en A, en
vez de quedar cortado a la mitad-. Es una proporcion de VALOR, no de
cantidad de productos: un catalogo de 10 productos donde uno solo
concentra el 90% del valor total deja ese producto como el unico en
clase A, sin importar que sean 9 productos mas. El "valor" que usa
`recalcularAbc()` es el actual en inventario (costo promedio ×
existencia), no ventas anuales reales -esa integracion con el
historial de `sales-orders` es un paso futuro, declarado
explicitamente-.

## Un bug real, encontrado en la prueba unitaria antes de tocar la base

La primera version de `clasificarAbc()` acumulaba el valor DESPUES de
cada producto para decidir su clase. Con un producto que por si solo
es el 90% del valor total, esa version lo clasificaba como B -su
propio acumulado (90%) ya superaba el corte de 80% para A-, un
resultado que contradice el proposito mismo de un analisis ABC (el
producto de mayor valor SIEMPRE deberia ser A). El test
"un solo producto domina" lo encontro antes de escribir una sola linea
de SQL. Corregido acumulando el valor ANTES de cada producto para
decidir su clase, dejando el acumulado DESPUES solo para el siguiente.

## Conteo ciego de verdad

Mientras el conteo sigue en `counting`, la pantalla de `/conteos-ciclicos/[id]`
no incluye `system_qty` en ningun lado del HTML -no es una columna
oculta con CSS, la consulta ni siquiera la trae a esa vista-. Solo al
pasar a `pending_approval` aparece el comparativo con la diferencia y
su impacto en pesos (`countVariance()`/`varianceValue()` de
`costing.ts`, reutilizadas tal cual).

## El ajuste espera aprobacion

Contar dejo el conteo en `counting`; enviarlo lo mueve a
`pending_approval` -solo si TODAS las lineas ya tienen algo contado-;
desde ahi, alguien con `stock-counts.approve` lo aprueba (postea
`count_adjustment` en `inventory_movements` por cada linea con
diferencia, y marca `count_schedules.last_counted_at`) o lo rechaza
(no ajusta nada). `transicionValidaConteo()` valida que nunca se salte
de `counting` directo a `approved`.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/conteos-ciclicos` | `stock-counts.view` | Programacion ABC, recalcular, lista de conteos, iniciar uno nuevo |
| `/conteos-ciclicos/[id]` | `stock-counts.view` | Conteo ciego mientras cuenta; comparativo con diferencia e impacto, aprobar/rechazar una vez enviado |

## Manifiesto

- **Permisos:** `view`, `manage`, `count`, `approve`
- **Widgets:** `cycle-counts-pending-approval`
- **Requiere:** `inventory` · **Recomienda:** `barcode`
- **Emite:** `stock-counts.count.submitted`, `stock-counts.count.approved`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'count']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/stock-counts.test.ts` — 12 casos: aislamiento, spoofing de tenant via producto/almacen/conteo ajenos, lineas editables solo mientras `counting`, encabezado inmutable tras `approved`, modulo apagado, checks de tabla (clase ABC invalida, estado invalido, producto duplicado en el mismo conteo) |
| 3 | Logica pura con cobertura | ✅ `stock-counts.ts` — 14 pruebas: clasificacion ABC (incluido el caso de un solo producto dominante que encontro el bug real), frecuencia por clase, vencimiento de la programacion, maquina de estados. Reutiliza `countVariance()`/`varianceValue()` de `costing.ts` sin duplicar |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: clasificacion ABC ya calculada visible sin interactuar, un conteo real aprobado con ajuste confirmado en `inventory_movements`/`stock_levels`, un conteo nuevo iniciado y contado a ciegas -confirmado que `system_qty` nunca aparece en esa pantalla-, enviado a aprobacion y rechazado sin tocar el inventario. Estado restaurado al canonico de la siembra despues de verificar |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ los tres productos del tenant clasificados (A/B/C) con distintos estados de vencimiento, un conteo real esperando aprobacion con una discrepancia de verdad (55 en sistema, 53 contados) |
| 9 | ≥2 widgets | ⚠️ solo 1 (`cycle-counts-pending-approval`): el modulo es principalmente un flujo de conteo y aprobacion, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **ABC sobre ventas anuales reales.** La clasificacion usa el valor
  actual en inventario (costo promedio × existencia), no el historial
  de ventas de `sales-orders`. Esa integracion es un paso futuro.
- **Reabrir un conteo rechazado.** `rejected` es terminal; volver a
  intentar significa iniciar un conteo nuevo, no reactivar el viejo.
- **Reemplazar el conteo simple de `inventory`.** Esa version sigue
  disponible para quien no necesita programacion, conteo ciego ni
  aprobacion.

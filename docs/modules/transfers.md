# `transfers` — Transferencias

**Que resuelve:** traslado entre almacenes con estado de transito real
-despachado y recibido son dos movimientos distintos, no uno solo-, y
la discrepancia se ve si lo que llega no es lo mismo que salio.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `inventory`

---

## No reemplaza la transferencia simple que ya existe

`inventory` (0019) ya trae `stock_transfers`: un movimiento en un solo
paso, pensado para un colmado con un almacen y una sucursal cercana
moviendo pocas cajas. Este modulo NO la toca ni la reemplaza -sigue
funcionando exactamente igual para quien no necesita mas-. Agrega el
flujo completo para quien de verdad necesita rastrear un traslado
entre almacenes lejanos: `transicionValidaTransferencia()`
(`@regb/operations`) valida `draft → in_transit → received`, con
`cancelled` solo alcanzable desde `draft` -no se cancela algo que ya
salio fisicamente del almacen-.

## Despachado y recibido son dos movimientos de inventario distintos

Despachar postea `transfer_out` en el almacen de origen -el stock sale
de ahi de inmediato-. Recibir postea `transfer_in` en el destino, pero
usando lo que **de verdad llego**, no lo que salio: si el camion perdio
2 sacos en el camino, el destino recibe 2 sacos menos de lo que el
origen despacho, y esa diferencia queda registrada, no oculta en el
promedio. La discrepancia se calcula con `detectarDiscrepancia()`
-la misma funcion de `receipts.ts`, reutilizada tal cual, no una
version nueva para transferencias-.

## Inmutabilidad por campo, no por fila entera

Una linea de transferencia tiene tres momentos: `qty_requested`
(editable mientras la orden sigue en `draft`), `qty_sent` (se fija una
sola vez al despachar; desde ahi `qty_requested` ya no se puede
cambiar -el camion salio con esa cantidad-), `qty_received` (se fija
una sola vez al recibir; desde ahi la linea entera queda fija, es un
hecho historico completo). Verificado en el navegador: recibida una
transferencia real de 15 sacos con solo 14 llegando, el sistema marco
"Falto 1" automaticamente, y un intento posterior de editar
`qty_received` por SQL directo fue rechazado con "Esa linea ya fue
recibida y no se edita".

## Honesto sobre lo que todavia no hace

El costo no viaja con la transferencia: `transfer_in` no declara
`unit_cost`, asi que el promedio ponderado del almacen de destino no
cambia por una transferencia -sigue siendo el que ya tenia, o queda en
cero si nunca recibio nada mas-. Calcular un costo de transferencia
real (el mismo costo promedio que tenia el origen al momento de
despachar) es un paso futuro.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/transferencias` | `transfers.view` | Lista con estado, crear una nueva |
| `/transferencias/[id]` | `transfers.view` | Agregar lineas (en borrador), despachar, recibir con discrepancia visible, cancelar |

## Manifiesto

- **Permisos:** `view`, `create`, `dispatch`, `receive`
- **Widgets:** `transfers-in-transit`
- **Requiere:** `inventory`
- **Emite:** `transfers.order.dispatched`, `transfers.order.received`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'receive']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/transfers.test.ts` — 12 casos: aislamiento, spoofing de tenant via almacen/orden/producto ajenos, edicion libre en borrador, bloqueo de `qty_requested` tras despachar, bloqueo total tras recibir, borrado bloqueado tras despachar, modulo apagado, checks de tabla (cantidad invalida, mismo almacen de origen y destino, estado inventado) |
| 3 | Logica pura con cobertura | ✅ `transfers.ts` — 7 pruebas: la maquina de estados completa, incluyendo que `in_transit` NO puede cancelarse |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: recibida una transferencia real de 15 sacos con solo 14 llegando -discrepancia "Falto 1" mostrada automaticamente, movimientos `transfer_out`/`transfer_in` confirmados en la base, inmutabilidad posterior confirmada-. Estado restaurado al canonico de la siembra despues de verificar |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ un segundo almacen sembrado (Santiago), una transferencia en transito para probar "recibir" en vivo, una ya recibida con discrepancia real (10 despachados, 8 llegados) |
| 9 | ≥2 widgets | ⚠️ solo 1 (`transfers-in-transit`): el modulo es principalmente un flujo de transito, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Costo de transferencia.** El destino no recibe un costo declarado;
  el promedio ponderado del almacen de destino no se actualiza por una
  transferencia. Calcular el costo real de traslado es un paso futuro.
- **Reemplazar la transferencia simple de `inventory`.** Esa sigue
  funcionando para traslados de un solo paso sin este modulo instalado.
- **Cancelar una transferencia ya despachada.** Una vez `in_transit`,
  la unica salida es recibirla -aunque sea con discrepancia-; no se
  revierte un despacho ya hecho.

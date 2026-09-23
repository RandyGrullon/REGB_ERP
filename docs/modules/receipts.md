# `receipts` — Recepciones

**Que resuelve:** inspeccion real al recibir mercancia -aceptado contra
rechazado, no solo "cuanto llego"-, discrepancia detectada sola contra
lo esperado, y devolucion al proveedor de lo que no paso, con su propio
movimiento de inventario en sentido contrario.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `purchase-orders`

---

## No reinventa lo que `purchase-orders` ya hace

`purchase-orders` ya sabe recibir una linea a la vez
(`recibirLinea()`): incrementa `qty_received`, postea el movimiento de
inventario, deriva el estado de la orden. Este modulo reutiliza esa
misma logica pura -`pendingReceipt()`, `validateReceipt()`,
`costVariance()` de `@regb/operations/procurement.ts`- en vez de
duplicarla. Lo que agrega de verdad es lo que la orden de compra por
si sola no tiene:

1. Un **documento de recepcion** que agrupa varias lineas de un mismo
   camion, no una accion suelta por linea.
2. **Inspeccion real**: `qty_accepted` y `qty_rejected` por separado,
   validadas para que sumen exactamente `qty_received`
   (`validateInspeccion()`).
3. **Discrepancia detectada sola**: `detectarDiscrepancia()` compara
   lo esperado contra lo recibido; si cualquier linea difiere, el
   documento entero queda `with_discrepancies`
   (`deriveGoodsReceiptStatus()`).
4. **Devolucion al proveedor**, de lo rechazado o de algo ya aceptado
   que salio malo. Solo la de lo aceptado mueve inventario (movimiento
   `return_to_supplier`, ver abajo).

## Recibir menos de lo pedido es el caso normal (corregido en 0131)

La pantalla precargaba "Aceptado" con lo **pedido**. Si llegaban 30 de 50
sacos y el almacenista solo corregia "Recibido", la inspeccion no sumaba
(50 + 0 ≠ 30) y la accion hacia `throw`: la pagina entera caia en el error
generico de Next y se perdia lo escrito (hallazgo 2 del analisis de flujo).

Ahora:

- **"Aceptado" en blanco = recibido − rechazado** (`aceptadoPorDefecto()`).
  El campo ya no viene precargado.
- **Ningun error de captura lanza.** La accion devuelve el motivo con el
  producto ("Cemento gris 42.5 kg: Aceptado (50) + rechazado (0) debe sumar
  lo recibido (30).") y no escribe nada; un rechazo de la base (trigger,
  restriccion, id mal formado) tambien vuelve como texto.
- **Costo en blanco = el cotizado de la orden**, no 0. Antes un costo vacio
  entraba en 0 y hundia el costo promedio de todo el inventario de ese
  producto.
- `validateInspeccion()` compara en milesimas: 2.2 + 0.1 no es 2.3 en coma
  flotante, y en la base (`numeric(14,3)`) si.

## Solo sale del inventario lo que entro (corregido en 0131)

Lo rechazado nunca entra al on_hand (solo se postea lo aceptado), pero
`enviarDevolucion` restaba la cantidad devuelta igual: el almacen quedaba
con menos de lo que tenia en el estante (hallazgo 11: CEM-100 de 55 a 50).

`supplier_returns.origin` distingue de donde sale lo devuelto:

| Origen | Tope | Al enviarse |
|---|---|---|
| `rejected` (por defecto) | lo rechazado − lo ya devuelto de lo rechazado | **no** mueve inventario: nunca entro |
| `accepted` | lo aceptado − lo ya devuelto de lo aceptado | movimiento `return_to_supplier` por la cantidad |

Las devoluciones canceladas no ocupan cupo. El tope se comprueba en la
accion (bajo candado de la linea de recepcion, para que dos devoluciones
simultaneas no pasen el mismo cupo) y en la base: el trigger
`tope_de_devolucion` (`limitar_devolucion()`) lo exige aunque alguien se
salte la accion. Se llama con "t" a proposito: Postgres dispara los BEFORE
por orden alfabetico, y la guarda de cliente ajeno (`no_devolucion_ajena`)
tiene que hablar primero. Tampoco tapa los CHECK de la tabla: una cantidad
≤ 0 o un estado inventado los rechaza su restriccion, con su mensaje.

La pantalla de la orden sigue abierta cuando la orden ya esta `received`:
la ultima recepcion la cierra aunque traiga rechazos, y esos rechazos hay
que poder devolverlos. El historial de recepciones enlaza a cada orden.

## Solo lo aceptado entra al inventario vendible

Una decision de alcance deliberada: no existe una "cuarentena" de
inventario para lo rechazado en esta version. El movimiento de
`receipt` se postea por `qty_accepted`, nunca por `qty_received` -si
se rechazaron 5 de 25, solo 20 entran al `on_hand`-. Lo rechazado
quedafuera del inventario disponible hasta que se resuelva
(devolucion enviada o cancelada); no ocupa un estado intermedio de
"en cuarentena en el almacen".

## Un bug real, encontrado al probar el flujo completo en el navegador

`goods_receipts` se diseño inmutable desde el primer insert -un
documento de recepcion es un hecho historico, mismo criterio que
`rfq_quotes`-. Pero la primera version de `registrarRecepcion()`
insertaba el encabezado SIN el `status` derivado, procesaba las
lineas, y luego intentaba un `UPDATE` separado para fijar
`with_discrepancies`/`completed` -exactamente lo que el propio
trigger de inmutabilidad bloquea, incluso dentro de la misma
transaccion que el insert-. El resultado: **ninguna recepcion se
podia registrar nunca**, porque el paso final siempre fallaba con
"Una recepcion ya registrada no se edita ni se borra", revirtiendo
toda la transaccion. Se encontro probando el flujo real en el
navegador (recibir 30 de 50 sacos con 2 rechazados) y viendo el error
de servidor. Corregido restructurando la accion: primero se valida e
inspecciona CADA linea sin escribir nada, se calcula el status final
de todo el documento, y el encabezado se inserta YA con ese status
-nunca hay un update posterior-.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/recepciones` | `receipts.view` | Ordenes pendientes de recibir, devoluciones pendientes (enviar/cancelar, con su origen), historial de recepciones con su estado y enlace a la orden |
| `/recepciones/[orderId]` | `receipts.receive` | Inspeccion linea por linea de una orden -recibido/aceptado (en blanco = recibido − rechazado)/rechazado/razon/costo real (en blanco = cotizado)-, y devolucion de lo rechazado o de lo ya aceptado de recepciones previas, tambien con la orden ya recibida |

## Manifiesto

- **Permisos:** `view`, `receive`, `return`
- **Widgets:** `receipts-with-discrepancies`
- **Requiere:** `purchase-orders` · **Recomienda:** `inventory`
- **Emite:** `receipts.receipt.registered`, `receipts.return.sent`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'receive']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/receipts.test.ts` — 16 casos: aislamiento, spoofing de tenant via orden/almacen/proveedor/linea-de-orden/producto ajenos en las tres tablas nuevas, inmutabilidad incondicional de recepcion y su linea, devolucion editable solo mientras `pending`, modulo apagado, checks de tabla (inspeccion que no suma, monto de devolucion invalido, estado inventado). **0131:** `apps/web/src/app/recepciones/recepciones.accion.test.ts` — 10 casos con las acciones reales: inspeccion que no suma → error legible sin escribir nada, linea ajena → error legible, recepcion parcial 30 de 50 con 2 rechazados sin tocar "Aceptado", costo en blanco = cotizado, devolver lo rechazado no resta existencia, tope de rechazado, tope de aceptado, devolver lo aceptado si resta, cancelada libera cupo, tope en la base por SQL directo |
| 3 | Logica pura con cobertura | ✅ `receipts.ts` — 22 pruebas: deteccion de discrepancia, estado derivado del documento, validacion de inspeccion (tambien con decimales), aceptado por defecto, maquina de estados de devolucion, si una devolucion mueve inventario segun su origen, cupo disponible para devolver. Reutiliza `pendingReceipt`/`validateReceipt`/`costVariance` de `procurement.ts` sin duplicar |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: recibida una orden real (30 de 50 sacos, 28 aceptados/2 rechazados a un costo distinto al cotizado), discrepancia detectada y marcada automaticamente, devolucion registrada y enviada con su movimiento `return_to_supplier` confirmado en la base -momento en el que se encontro y corrigio el bug de inmutabilidad del encabezado-. Estado restaurado al canonico de la siembra despues de verificar |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una orden confirmada sin nada recibido (para probar el flujo en vivo) y una orden ya recibida con discrepancia real -5 de 25 sacos rechazados por humedad- y su devolucion pendiente, sin tocar la orden ya recibida con el mecanismo viejo de `purchase-orders` |
| 9 | ≥2 widgets | ⚠️ solo 1 (`receipts-with-discrepancies`): el modulo es principalmente un flujo de inspeccion, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Cuarentena de inventario para lo rechazado.** Lo rechazado nunca
  entra al `on_hand`; no hay un estado intermedio de "en almacen pero
  no disponible".
- **Nota de credito, ajuste en `ap` ni asiento contable.** La devolucion
  de lo aceptado mueve inventario de verdad, pero no genera un documento
  contable ni ajusta lo que se le debe al proveedor; la recepcion tampoco
  asienta (el inventario del mayor sube con la factura del proveedor, ADR
  0001). Esa integracion es un paso futuro.
- **Comprobar existencia al devolver lo aceptado.** El tope es lo
  aceptado de esa linea, no lo que queda hoy en el almacen: si ya se
  vendio, el on_hand puede quedar negativo, igual que en la caja.
- **Limite de cuantas devoluciones parciales.** `qtyDisponibleParaDevolver()`
  descuenta lo ya devuelto (sin contar lo cancelado) por origen, para que
  no se pueda devolver mas de lo rechazado ni de lo aceptado -pero no hay
  un limite de cuantas devoluciones parciales se pueden abrir-.

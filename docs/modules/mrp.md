# `mrp` — Planificacion MRP

**Que resuelve:** explosion de necesidades real sobre un BOM
multinivel -si un componente tiene su propia receta activa, tambien
explota SUS componentes, y la misma materia prima entre ramas
distintas se suma en vez de contarse dos veces- y una sugerencia por
componente (comprar o producir) que nunca se ejecuta sola.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `manufacturing` · **Recomienda:**
`purchase-orders`

---

## Reutiliza la misma acumulacion recursiva que `bom`

`explotarNecesidadesMrp()` recorre exactamente el mismo tipo de arbol
que `costoUnitarioMultinivel()` de `bom.ts` -un nodo o es una hoja
comprada (`esComprado: true`) o tiene su propia receta y se expande
(`esComprado: false`, con `subComponentes`)-, pero en vez de acumular
costo acumula CANTIDAD por `productId` en un `Map`, sumando entre
ramas repetidas. `necesidadNeta()` es la resta clasica de MRP: bruta
menos disponible, nunca negativa.

Verificado en vivo con el mismo par KIT-100/VAR-REF que `bom` uso para
probar su recursion: correr MRP para 10 kits explota en cemento (5,
comprar), VAR-REF (20, **producir** -tiene su propia receta activa-)
que a su vez explota en varilla (20, comprar) y pintura (2, comprar), y
la pintura DIRECTA del kit (2.5, comprar) se ACUMULA con la de arriba:
2 + 2.5 = 4.5, la misma materia prima en dos ramas distintas del
mismo arbol, confirmado en `mrp_suggestions` como una sola fila con
`qty_suggested = 4.5` en vez de dos filas separadas.

## Sugerencia, nunca ejecucion automatica

Aceptar una sugerencia de **producir** crea una orden de produccion en
`draft` sobre el BOM activo del producto -`manufacturing` es un
`requires` real, ese acoplamiento esta declarado y es legitimo-.
Aceptar una de **comprar** solo cambia su propio `status` a
`accepted`: NO crea una requisicion ni una orden de compra por su
cuenta, porque ese acoplamiento no esta declarado (`recommends`, no
`requires`) y crearlo en silencio violaria la regla del registry que
ya se aplico en cada modulo desde F6.

Verificado en vivo los tres caminos sobre la corrida sembrada (10 kits,
4 sugerencias): aceptar la de cemento (`purchase`) dejo
`production_order_id` en `null` y el conteo total de
`production_orders` sin cambiar; aceptar la de VAR-REF (`produce`)
creo una orden real en borrador -20 planificadas, el almacen elegido
en el formulario- confirmada abriendo `/produccion/<id>`; descartar la
de pintura la dejo en `dismissed` sin ningun efecto. Los tres se
revirtieron despues -la corrida sembrada es el punto de partida para
que cualquiera que entre a la demo pruebe los tres caminos desde cero,
no un historial ya resuelto-.

## Ni siquiera considera lo que ya viene en camino

La necesidad neta resta unicamente `stock_levels` -lo disponible
ahora mismo-, nunca las ordenes de compra ya emitidas y pendientes de
recibir. Declarado explicitamente en el FAQ del marketplace: es una
limitacion real, no un descuido.

## Inmutabilidad: corrida siempre congelada, sugerencia hasta que se resuelve

Una corrida (`mrp_runs`) es un hecho historico -que se calculo, cuando,
para que producto y cantidad- inmutable desde el primer insert, igual
que `audit.log`. Una sugerencia SI se puede editar mientras sigue
`pending` (por ejemplo, para ajustar la cantidad sugerida a mano antes
de aceptarla), pero en cuanto se acepta o se descarta, congela: el
mismo patron de `time-off`/`expenses`, no el de "campo por campo" de
`transfers`/`bom`/`manufacturing`, porque aqui no hay un campo que
deba seguir cambiando despues de resuelta.

## El agujero de siempre (0031), esta vez en dos tablas

`mrp_runs` valida que su `target_product_id` pertenezca al mismo
tenant antes de insertar -si no, "Ese producto no pertenece a esta
cuenta"-. `mrp_suggestions` valida DOS referencias por separado: que
`run_id` sea de una corrida del mismo tenant, y que `product_id`
tambien lo sea. Cubierto en la prueba de RLS con ambos casos por
separado (colar el `run_id` ajeno con el producto propio, y viceversa)
mas el caso nuevo de una corrida con el producto ajeno.

## Lo que NO hace

- No detecta ciclos multi-producto en el arbol que explota -hereda esa
  limitacion de `bom`, que solo bloquea el ciclo directo (un producto
  como componente de si mismo)-. El mismo tope de profundidad 10 de
  `bom` se aplica aqui como red de seguridad.
- No considera ordenes de compra pendientes de recibir al calcular la
  necesidad neta, solo el stock disponible ahora.
- No crea automaticamente una requisicion ni una orden de compra al
  aceptar una sugerencia de comprar -queda registrado como decision,
  nada mas-.
- No tiene una nocion de horizonte de tiempo ni de lead time por
  proveedor: la sugerencia es "cuanto", no "para cuando pedirlo".

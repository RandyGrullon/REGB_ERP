# `field-service` — Servicio en campo

**Que resuelve:** poder responderle al cliente que dice "aqui no vino
nadie" o "eso no lo revisaron" -con constancia, no con la palabra del
tecnico contra la del cliente-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** nada · **Recomienda:** `inventory`

Unico modulo de S69 (F10). Movil-primero segun §13.5.

---

## La regla que sostiene el modulo

Una orden NO se cierra con pasos obligatorios del checklist sin marcar
ni sin la firma de quien recibio. Esas dos cosas son lo unico que hace
verificable "si lo revisamos" y "si fuimos" tres semanas despues.

Vive en un trigger (`impedir_cerrar_orden_incompleta`), no solo en la
pantalla: el telefono del tecnico es un cliente remoto y no se le cree
nada. La UI pre-valida con `motivoNoCierre()` de `@regb/operations`
antes de tocar la fila -el mismo calculo, pero alli para EXPLICAR y en
la accion para DECIDIR-. La pre-validacion no es cortesia: atrapar el
error del trigger dentro de un `sql.begin()` envenena la transaccion
completa, que es el tropiezo que ya dejo `projects` con las
dependencias de tareas.

`motivoNoCierre()` devuelve el motivo en texto y no un booleano pelado
porque el tecnico esta parado en el sitio con el telefono en la mano:
"no se puede" sin decir que falta lo obliga a adivinar.

## Obligatorio y opcional no son lo mismo

Solo los pasos marcados como obligatorios bloquean el cierre. "Tomar
foto del equipo terminado" es util, pero si el telefono se quedo sin
bateria no puede dejar una orden cobrada sin cerrar.

Verificado en vivo sobre OS-1: con "Medir presion del gas" sin marcar,
el boton de cerrar con firma no cerro nada y la pantalla dijo por que.
Marcado ese paso, cerro de una -con el paso OPCIONAL todavia pendiente-
y quedo "Recibido por Ramon Peralta", 41 minutos en sitio, checklist al
75%.

## Reprogramar no es cancelar

`scheduled → scheduled` es una transicion valida a proposito. Mover una
visita es lo mas normal del mundo en campo; obligar a cancelar la orden
y abrir otra borraria el historial de por que se movio y se veria como
si el trabajo nunca se hubiera pedido.

## La firma es un nombre, no un garabato

Se guarda quien recibio y la hora exacta. En un telefono barato el
trazo de un canvas se pierde o sale ilegible; el nombre no. Un
`btrim()` en el trigger impide que un espacio en blanco pase por firma.

## El costo de repuestos se deriva

`service_order_parts_cost()` suma las lineas al preguntar -mismo
criterio que `project_cost_total()` en `project-costing` y
`loyalty_balance()` en `loyalty`-. `costoRepuestos()` suma antes de
redondear y no pieza por pieza: redondear cada linea arrastra el error
hacia arriba cuando hay muchas piezas baratas, que es justo el caso de
una orden de servicio.

Un repuesto consumido es inmutable desde el insert: salio de la gaveta
y se quedo en casa del cliente.

## Sin `requires` a proposito

Recomienda `inventory` pero no lo exige. Un plomero que compra el
repuesto en la ferreteria de la esquina no tiene inventario y aun asi
necesita ordenes de servicio: el repuesto se registra por descripcion y
el `product_id` queda nulo.

## El agujero de siempre (0031)

Un paso de checklist valida que su orden sea del mismo tenant; un
repuesto valida que su orden Y su producto lo sean.

## Lo que NO hace

- No descuenta del inventario -registra que se uso un repuesto, pero el
  movimiento de almacen no se genera solo todavia-.
- No factura la orden -no hay puente a `ar` ni a `sales-orders`-.
- No tiene agenda visual ni asignacion automatica por cercania: el
  tecnico se pone a mano en la orden.
- No guarda fotos ni GPS todavia, aunque el `mobileScope` los
  contempla.
- No cobra en el sitio.

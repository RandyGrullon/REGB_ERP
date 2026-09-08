# `ecommerce` — E-commerce sync

**Que resuelve:** un registro formal de los pedidos que llegan de una
tienda Shopify/WooCommerce/Tiendanube -en vez de copiarlos a mano a
otra parte- y del catalogo vinculado a cada canal.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `products` · **Recomienda:** `inventory`

Unico modulo de S60 (F9).

---

## El total no se reinventa

Deliberadamente NO llama a la API de ningun proveedor externo -no hay
integracion real todavia-. Un pedido entrante se registra TAL CUAL
llegaria por un webhook: su total nunca se recalcula con una formula
propia, porque ya lo calculo el canal externo -reinventar esa cuenta
aqui podria mostrar un numero distinto al que el cliente realmente
pago-. Es la misma disciplina de honestidad que `marketing` aplica al
declarar que no manda correos de verdad, y que `e-sign` aplico primero
para su firma sin PKI certificado.

## Un vinculo de catalogo es una FK real

`channel_product_links` conecta un producto real (`requires:
['products']`) con su SKU en el canal externo. "Sincronizar" solo
registra `synced_at = now()` -no hay una llamada de red real-, honesto
sobre que esto cataloga el vinculo, no empuja datos a ningun servidor
externo. Verificado en vivo: sincronizar el vinculo de "Cemento gris
42.5 kg" con la tienda Shopify sembrada actualizo la fecha mostrada al
instante.

## Un pedido resuelto es terminal

`transicionValidaPedidoCanal()`: `received → imported | cancelled`,
ambos terminales -mismo criterio que `contracts` y `helpdesk`-. Sus
lineas (`channel_order_lines`) son inmutables desde el insert, igual
que un mensaje de ticket: son el hecho tal cual llego, no una cotizacion
que se pueda seguir editando. Verificado en vivo: el pedido sembrado
`#SHOP-1042` (Yolanda Perez, RD$2,325.00 = 5 sacos de cemento a RD$465)
paso de "Recibido" a "Importado" al hacer clic, y desaparecieron los
botones de transicion -confirmando que es terminal de verdad-.
Revertido despues -pedido devuelto a `received`- para que la demo
siga teniendo un pedido real por importar.

## `diasPedidoCanalPendiente()` reutiliza `diasAbierto()` de quality.ts

Tercera vez que se reusa esta funcion en el proyecto (original en
`quality`, luego `helpdesk` como `diasTicketAbierto`, ahora aqui) para
saber cuantos dias lleva un pedido sin importarse.

## El agujero de siempre (0031)

Un vinculo valida que su producto sea del mismo tenant; un pedido
valida que su canal lo sea; una linea valida que su pedido Y su
producto (si tiene) lo sean.

## Lo que NO hace

- No se conecta de verdad con Shopify, WooCommerce ni Tiendanube -no
  hay integracion con ningun proveedor externo todavia, declarado sin
  rodeos en el FAQ del marketplace-.
- No empuja el catalogo ni el stock al canal externo -"sincronizar"
  solo registra la fecha, es un marcador, no una llamada de red real-.
- No crea automaticamente un pedido de venta interno al importar -el
  staff sigue registrando la venta formal donde corresponda; importar
  aqui solo marca que el pedido ya se atendio-.

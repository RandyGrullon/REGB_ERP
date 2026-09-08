# `quotes` — Cotizaciones

**Que resuelve:** cotizaciones de venta con versiones reales -revisar
una nunca sobrescribe la anterior-, contenido congelado al enviarla,
y los mismos totales exactos que ya usan pedidos, POS y facturas.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `products` · **Recomienda:** `crm`

---

## Los mismos totales, en un solo lugar

`documentTotals()`/`lineTotals()` de `documents.ts` -las MISMAS
funciones que ya usan pedidos, POS y facturas- calculan cada total
aqui tambien: nunca se escribio una formula de dinero nueva. La
puerta F5 exige que un `grep` de una formula de dinero de UNA sola
ocurrencia en `packages/`, y esta cotizacion la respeta sin
excepcion. Verificado en vivo agregando una segunda linea real (20
unidades a RD$380, ITBIS 18%): el subtotal combinado, el ITBIS
combinado y el total combinado calzaron exactos con la suma de cada
linea calculada por separado.

## Versiones reales, nunca una sobrescritura

Revisar una cotizacion enviada NO la edita: `crearVersionNueva()`
marca la actual `superseded`, crea una fila nueva con
`supersedes_id` apuntando a la anterior, y copia cliente, terminos y
lineas. El historial completo de que se cotizo cada vez queda
intacto -nunca se pierde la version original-. Verificado en vivo:
enviar la cotizacion sembrada y crear una version nueva produjo una
v2 real en borrador, con "Sustituye a la version anterior" enlazando
de vuelta a la v1 ya `superseded`. Revertido despues -v2 borrada, v1
devuelta a `draft`- para que la demo siga teniendo una cotizacion
real por enviar desde cero.

## Contenido congelado al salir de borrador

Un trigger de campo por campo (no fila completa) bloquea cambiar
`quote_number`, `customer_id`, `valid_until`, `terms` o los totales
una vez la cotizacion deja `draft` -pero el `status` mismo SI puede
seguir avanzando-, el mismo patron que ya uso `bom`. Las lineas son
mas estrictas: se congelan por completo en cuanto la cotizacion
padre deja `draft`, sin importar que campo se intente cambiar -son
"lo que se cotizo", un hecho historico una vez enviado-.

## Deliberadamente sin FK a leads

Recomienda `crm`, no lo exige -mismo criterio que `logistics` dejando
el vehiculo como texto libre en vez de una FK a `fleet`-: una
cotizacion no tiene una columna `lead_id`, solo `customer_id` (una FK
real, porque el catalogo de clientes es base del ERP, no de un modulo
opcional).

## El agujero de siempre (0031), dos veces

Una cotizacion valida que su cliente y la version que sustituye sean
del mismo tenant; una linea valida que su cotizacion y su producto
sean del mismo tenant.

## Lo que NO hace

- No firma electronicamente -eso es responsabilidad del futuro modulo
  `e-sign`, que recomienda `quotes` pero no lo exige-.
- No genera un PDF con membrete propio todavia -el numero y las
  lineas existen, el documento visual para imprimir o enviar por
  correo es un paso posterior-.
- No convierte automaticamente una cotizacion aprobada en un pedido
  de venta -esa conexion con `sales-orders` no esta implementada-.

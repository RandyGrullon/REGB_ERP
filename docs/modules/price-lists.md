# `price-lists` — Listas de precios

**Que resuelve:** precio por cliente, canal o volumen, con la lista
mas especifica ganando siempre segun la misma regla -nunca a criterio
de quien cotiza-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `products`

---

## Un scaffold muerto, encontrado antes de escribir la primera tabla

`public.customers.price_list` (0020) era una columna de texto libre
que **nunca** se leyo ni se escribio desde ningun codigo de la app -un
scaffold sin sustancia, mismo hallazgo de esta sesion que `payroll` o
`attendance` antes de que esta fase les diera contenido real-. Se
elimina y se reemplaza por `customers.price_list_id`, una referencia
real a este modulo, con su propia validacion cruzada de tenant.

## La lista mas especifica gana, siempre con la misma regla

`listaAplicable()` (`@regb/operations`) resuelve la precedencia:
`customer` > `channel` > `general`, y entre varias vigentes del mismo
alcance, la de inicio mas reciente. `listaVigente()` filtra por estado
y rango de fechas. Ninguna de las dos vive en SQL -mismo principio que
`within_geofence` en `attendance` o `transicionValida` en `recruiting`-.

## El descuento por volumen es un algoritmo real, no una tabla plana

`precioPorVolumen()` toma la cuota de cantidad minima MAS ALTA que la
cantidad pedida todavia alcanza -pedir 300 unidades con cuotas en 1, 50
y 200 usa el precio de la cuota de 200, no el de 50 ni el de 1-. Cada
resultado clave del ejemplo en `/listas-precio/[id]` se calcula con
esta misma funcion, nunca a mano.

## Honesto sobre lo que todavia no hace

Este modulo resuelve el precio **para consulta** -un cotizador-, pero
todavia NO se conecta automaticamente al checkout de `sales-orders` o
`pos`. Esa integracion cruzada es un paso futuro, declarado
explicitamente aqui, en el manifest y en la migracion: conectarla bien
significa tocar el flujo de captura de esos dos modulos, no solo
agregar una tabla nueva.

## El mismo agujero de siempre, con una variante: una tabla ya existente

`price_lists.customer_id` y `price_list_entries.price_list_id`/`product_id`
siguen el patron estandar. Pero `customers.price_list_id` es una
referencia **nueva sobre una tabla que ya existia desde 0020** -la
primera vez en la serie que el agujero aparece en una columna agregada
despues, no en la tabla original-. `impedir_lista_precio_ajena_en_cliente()`
lo tapa igual que si fuera una tabla nueva.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/listas-precio` | `price-lists.view` | Listas con vigencia calculada, crear una nueva, asignar la lista de un cliente |
| `/listas-precio/[id]` | `price-lists.manage` | Cuotas de precio por producto, con un ejemplo de resolucion en vivo |

## Manifiesto

- **Permisos:** `view`, `manage`
- **Widgets:** `active-price-lists`
- **Reportes:** `price-list-coverage`
- **Emite:** `price-lists.list.created`
- **Requiere:** `products`
- **Plataformas:** web y escritorio -sin movil, `platforms.mobile = false`-

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/price-lists.test.ts` — 12 casos: aislamiento, spoofing de tenant via cliente/lista/producto ajenos (incluida la asignacion de `customers.price_list_id`, la referencia nueva sobre la tabla vieja), modulo apagado, checks de tabla (alcance sin su referencia obligatoria, fechas invertidas, cuota duplicada) |
| 3 | Logica pura con cobertura | ✅ `price-lists.ts` — 13 pruebas: vigencia por estado y fechas, precedencia cliente/canal/general con desempate por fecha, resolucion de precio por volumen |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: las tres listas sembradas (general, de cliente, de canal) con su vigencia correcta, una cuota nueva agregada en vivo con el ejemplo de resolucion recalculandose de inmediato |
| 5 | UI movil | N/A — el modulo declara `platforms.mobile = false` a proposito |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una lista general con tres cuotas de volumen en cemento, una lista de cliente con precio especial en varilla -asignada de verdad a Constructora Duarte SRL-, y una lista de canal online con precio especial en pintura |
| 9 | ≥2 widgets | ⚠️ solo 1 (`active-price-lists`): el modulo es principalmente un cotizador de consulta, no genera mas metricas de dashboard propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'standard'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Aplicar el precio automaticamente al vender.** Resuelve el precio
  para consulta; la integracion con el checkout de `sales-orders` y
  `pos` es un paso futuro.
- **Descuentos combinables.** Una sola lista aplica a la vez -la mas
  especifica-, nunca se suman varios descuentos de listas distintas.
- **Precios en otra moneda.** Los precios se registran en la moneda
  base del tenant; no hay conversion automatica via `multicurrency`.

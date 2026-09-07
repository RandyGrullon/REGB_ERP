# `logistics` — Logistica & Rutas

**Que resuelve:** planificar rutas de entrega y registrar la prueba de
entrega real -quien recibio, cuando, en que estado quedo cada parada-,
con una tasa de exito calculada de las paradas de verdad.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Recomienda:** `sales-orders`

---

## Honesto desde el primer dia sobre lo que el catalogo promete

El catalogo dice "seguimiento GPS" y "planificacion de rutas". Ninguno
de los dos existe de verdad aqui: no hay ningun dispositivo de rastreo
conectado, y no hay optimizacion de ruta por distancia -eso pediria
geocodificacion real y un motor de rutas, que este sistema no tiene-.
El orden de las paradas lo decide quien planifica, escribiendolas en
el orden que quiera. Lo que SI es real: la maquina de estados de la
ruta y de cada parada, y la tasa de entrega exitosa calculada de las
paradas resueltas, no un numero que alguien estima al final del dia.

## Sin acoplamiento duro a `fleet`

El vehiculo de una ruta es texto libre (la placa), no una referencia a
`public.vehicles`. `logistics` solo RECOMIENDA `sales-orders`, no
requiere `fleet` -un acoplamiento silencioso a una tabla de otro
modulo violaria la regla del registry (§2.2: el core no conoce los
modulos)-. `customer_id`/`sales_order_id` en cada parada SI son
referencias reales, porque esas tablas ya existen en el esquema base
independientemente de si el modulo `sales-orders` esta activo.

## Prueba de entrega: quien recibio, no una firma digital

Marcar una parada como entregada exige escribir quien la recibio
-`recipient_name`-. No hay captura de firma ni foto: eso es un paso
futuro, declarado explicitamente en la migracion y aqui. Una vez
resuelta (entregada o fallida), la parada es inmutable -es la prueba
de lo que paso, no se corrige despues-.

## La ruta se completa sola cuando ya no queda nada pendiente

`rutaCompleta()` valida que ninguna parada siga `pending` antes de
permitir completar la ruta -no se puede cerrar una ruta con entregas a
medias-. `tasaEntregaExitosa()` calcula el porcentaje sobre las
paradas YA resueltas: las pendientes no cuentan ni para arriba ni para
abajo, todavia no se sabe que van a ser.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/rutas` | `logistics.view` | Lista de rutas con progreso de entregas, planificar una nueva |
| `/rutas/[id]` | `logistics.view` | Agregar paradas (en planificacion), despachar, marcar entregada/fallida con prueba de entrega, completar |

## Manifiesto

- **Permisos:** `view`, `manage`, `deliver`
- **Widgets:** `routes-in-progress`
- **Recomienda:** `sales-orders`
- **Emite:** `logistics.route.completed`, `logistics.stop.delivered`
- **Plataformas:** web, escritorio y movil (`mobileScope: ['view', 'deliver']`)

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ |
| 2 | Migraciones + RLS probadas | ✅ `supabase/tests/logistics.test.ts` — 10 casos: aislamiento, spoofing de tenant via conductor/ruta/cliente/orden ajenos, parada pendiente editable pero resuelta inmutable, ruta resuelta inmutable, modulo apagado, checks de tabla (estado invalido, secuencia duplicada) |
| 3 | Logica pura con cobertura | ✅ `logistics.ts` — 12 pruebas: maquina de estados de la ruta, completitud de ruta, tasa de entrega exitosa (incluido que las pendientes no cuentan) |
| 4 | UI web responsive | ✅ verificado en navegador end-to-end: una ruta en progreso con una parada entregada y una pendiente, la pendiente resuelta en vivo con su prueba de entrega, la ruta completada, y una ruta en planificacion despachada en vivo -todo confirmado inmutable despues y restaurado al canonico de la siembra- |
| 5 | UI movil | 🔜 F9 |
| 6 | Desktop verificado | 🔜 F5 |
| 7 | Tour ≥6 pasos | 🔜 pendiente |
| 8 | Datos demo | ✅ una ruta en progreso con una parada ya entregada y una pendiente, una ruta en planificacion con una parada -para despachar en vivo- |
| 9 | ≥2 widgets | ⚠️ solo 1 (`routes-in-progress`): el modulo es principalmente planificacion y prueba de entrega, no genera mas metricas propias por ahora |
| 10 | Eventos documentados | ✅ declarado con el formato correcto de 3 segmentos; nadie lo escucha todavia |
| 11 | Precio en 3 tiers | ✅ `category = 'advanced'`, ya en el catalogo desde la siembra original (0009) |
| 12 | E2E en 3 plataformas | 🔜 F5 |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ sonda sin fallos en las 2 pantallas |

## Lo que NO hace

- **Seguimiento GPS.** Ningun dispositivo real esta conectado; no hay
  mapa en vivo ni posicion del conductor.
- **Optimizacion de ruta por distancia.** El orden de las paradas lo
  decide quien planifica; no hay geocodificacion ni motor de rutas.
- **Firma digital o foto como prueba de entrega.** Solo el nombre de
  quien recibio, escrito por el conductor.
- **Acoplamiento con `fleet`.** El vehiculo es texto libre (la placa),
  no una referencia real a un vehiculo de ese modulo.

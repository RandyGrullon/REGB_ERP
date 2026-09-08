# `shopfloor` — Piso de planta

**Que resuelve:** terminal tactil para operarios -marcar entrada,
marcar salida, iniciar o terminar un paro- y OEE calculado de esas
mismas marcas, nunca estimado de memoria.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `manufacturing` · **Recomienda:**
ninguno

Ultimo modulo de F8 (Cadena de suministro y produccion): al
completarlo, F8 queda en **18/18**.

---

## OEE real, no una estimacion

`calcularOee()` multiplica tres factores -disponibilidad, rendimiento,
calidad-, cada uno recortado a `[0,1]` ANTES de multiplicar: un ciclo
ideal mal estimado no puede inflar el rendimiento por encima de 100% y
arrastrar el OEE final con el.

- **Disponibilidad** = tiempo planificado menos tiempo de paro, sobre
  el planificado -`disponibilidad()`-.
- **Rendimiento** = lo que se hubiera producido al ciclo ideal, sobre
  el tiempo que de verdad se opero -`rendimiento()`-.
- **Calidad** = 1 menos la tasa de merma -`calidadOee()` reutiliza
  `tasaMerma()` de `manufacturing.ts` tal cual, con el signo
  invertido: es la misma pregunta ("que proporcion salio buena?")
  resuelta dos veces-.

Verificado en vivo con la orden sembrada (VAR-REF, liberada hace 6
horas, con un paro de 45 minutos ya cerrado): disponibilidad,
rendimiento y calidad se leyeron directo de `production_orders` y
`shopfloor_downtime` -sin ningun numero guardado de antemano-, y el
OEE final confirmado como el producto de los tres.

## El tiempo trabajado reutiliza `attendance.ts`

`horasEnTerminal` es un alias directo de `workedHours()` -la misma
resta entre entrada y salida que ya usa el marcaje de asistencia de
empleados-. `horasInactivoTotal()` sale de sumar esa misma funcion
sobre cada paro YA CERRADO -uno todavia abierto no se cuenta, porque
no se sabe cuanto va a durar-.

## Requiere `manufacturing`, de verdad

A diferencia de `quality` y `maintenance` (que no exigen nada),
`shopfloor` SI declara `requires: ['manufacturing']`: el terminal
marca tiempos y paros sobre una orden de produccion real, no tiene
sentido sin ella. Por eso esta migracion altera directamente
`production_orders` -le agrega `ideal_cycle_hours`-, el mismo criterio
que `lots-serials` uso para alterar `inventory_movements`/`products`:
el acoplamiento esta declarado, no es una referencia silenciosa.

## Vivo mientras abierto, historico al cerrar

Una sesion de operario y un paro siguen el mismo patron que
`traffic_fines` de `fleet` y `work_orders` de `maintenance`: editables
mientras siguen abiertos (`clocked_out_at`/`ended_at` en null),
congelados en cuanto se cierran. Verificado en vivo: marcar salida en
una sesion y luego intentar cambiar su operario se rechaza; lo mismo
con un paro ya terminado.

## El agujero de siempre (0031)

Una sesion y un paro validan que su orden de produccion sea del mismo
tenant -la misma comprobacion en ambas tablas, factorizada en una sola
funcion (`impedir_orden_ajena_sesion()`) reutilizada por los dos
triggers-.

## Lo que NO hace

- No tiene una vista de "terminal" que bloquee la navegacion del
  resto del ERP -es una pagina mas, pensada para tocarse en planta,
  pero no un modo kiosco real todavia-.
- No valida que solo haya una sesion abierta por orden a la vez: dos
  operarios pueden marcar entrada en la misma orden simultaneamente si
  asi se necesita -no se asume un solo operario por maquina-.
- El ciclo ideal (`ideal_cycle_hours`) es un numero declarado por
  quien opera el terminal, no una referencia contra el BOM ni contra
  un estandar de ingenieria -es responsabilidad de quien lo declara
  que sea razonable-.

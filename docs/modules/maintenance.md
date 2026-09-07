# `maintenance` — Mantenimiento (CMMS)

**Que resuelve:** ordenes de trabajo preventivas y correctivas con
maquina de estados real, vencimiento de mantenimiento por uso
acumulado o por fecha limite, y MTBF que promedia intervalos entre
fallas -no antiguedad del equipo-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** ninguno · **Recomienda:** `inventory`

---

## Reutiliza el vencimiento de `fleet`, generalizado

`mantenimientoEquipoVencidoPorFecha`/`mantenimientoEquipoVencidoPorUso`
son alias directos de `mantenimientoVencidoPorFecha()`/
`mantenimientoVencidoPorKm()` de `fleet.ts`: la pregunta es identica
-"ya toca el mantenimiento?"- sea un vehiculo con kilometraje o una
maquina con horas de uso. `equipoRequiereMantenimiento()` combina
ambos criterios (basta con que UNO se cumpla). Verificado en vivo con
el compresor sembrado: 1,200 horas acumuladas contra un intervalo de
1,000 desde el ultimo servicio (hace 90 dias) lo marca **Vencido**
automaticamente, sin que nadie revise el numero a mano.

## MTBF que promedia intervalos, no antiguedad

`calcularMtbfDias()` promedia los dias transcurridos ENTRE fallas
correctivas consecutivas -nunca desde la primera falla hasta hoy, que
mediria otra cosa (antiguedad del equipo, no frecuencia de fallas)-.
Verificado en vivo con las tres ordenes correctivas del compresor
sembrado (hace 75 dias, hace 30 dias, y una tercera abierta hoy):
MTBF de 37.5 dias -promedio de 45 y 30-, confirmado en el detalle del
equipo.

## Deliberadamente sin requerir nada

A diferencia de `mrp` (que exige `manufacturing`) y de `shopfloor`
(que tambien lo exigira), `maintenance` no exige ningun modulo: el
equipo a mantener es propio de este modulo, no depende de
`fixed-assets` (que es financiero) ni de `fleet` (que es de
vehiculos). Solo RECOMIENDA `inventory`, porque los repuestos usados
en una orden son productos reales -pero el descuento del stock NO es
automatico: `inventory_movements` exige el modulo `inventory` activo
en su propia RLS, y como `maintenance` no lo declara `requires`,
escribir ahi en silencio para un tenant sin `inventory` violaria la
regla del registry-.

## Maquina de estados, congelada solo al llegar a terminal

Una orden de trabajo sigue `open → in_progress → completed`, con
`cancelled` como salida desde `open` o `in_progress`; completada o
cancelada es terminal y ya no se edita ni se borra -mismo patron que
`traffic_fines` de `fleet`, no el de "campo por campo" de
`bom`/`manufacturing`-. Verificado en vivo el ciclo completo sobre la
orden correctiva sembrada: un repuesto registrado, `open → in_progress
→ completed`, confirmando que la orden completada ya no admite ningun
cambio. Revertido despues -repuesto borrado, orden devuelta a
`open`- para que la orden sembrada siga siendo un problema real por
resolver en la demo.

## Las partes son un hecho historico

`work_order_parts` es inmutable desde el primer insert, igual que
`production_order_lines` de `manufacturing`: un repuesto usado no se
corrige editando la fila, se corrige con una nota o un ajuste
posterior.

## El agujero de siempre (0031), dos veces

Una orden valida que su equipo sea del mismo tenant; una parte valida
DOS referencias por separado -que su orden y su producto sean del
mismo tenant-.

## Lo que NO hace

- No descuenta el inventario automaticamente al registrar un
  repuesto -queda registrado contra el producto, la resta real
  depende de conectar con `inventory`-.
- No tiene una nocion de plan de mantenimiento preventivo con
  calendario propio: el intervalo se declara en el equipo
  (`maintenance_interval_usage`/`maintenance_interval_days`), pero
  crear la orden preventiva sigue siendo una decision manual, no
  automatica.
- No calcula costo de mantenimiento por equipo -eso exigiria conocer
  el costo del repuesto, que vive en `products`, sin sumarlo todavia-.

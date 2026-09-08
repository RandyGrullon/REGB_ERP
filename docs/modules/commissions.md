# `commissions` — Comisiones

**Que resuelve:** una sola formula de comision por plan -porcentaje
sobre una base o monto fijo, nunca una mezcla ambigua- con liquidacion
que exige aprobar antes de pagar.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `sales-orders` · **Recomienda:**
`payroll`

Segundo modulo de S57 (F9).

---

## Una formula, nunca una mezcla ambigua

`calcularComision(baseAmount, rate, esquema)`: si el esquema es
`percentage`, `baseAmount x rate`; si es `fixed`, la tasa tal cual, sin
importar la base. Se calcula UNA vez al crear la entrada -no se
recalcula despues si el plan cambia-. Verificado en vivo: una comision
del 5% sobre una orden real de RD$25,000 dio exactamente RD$1,250.00.

## Requiere `sales-orders`, de verdad

A diferencia de `contracts` (que no exige nada), `commissions` SI
declara `requires: ['sales-orders']`: cada entrada referencia
`sales_order_id` con una FK autentica, no un monto suelto sin
respaldo.

## El bug real que encontro su propia prueba de RLS

El trigger de inmutabilidad original congelaba la fila en cuanto el
`status` salia de `pending` -pero `approved` NO es un estado terminal,
tiene que poder seguir avanzando a `paid`-. Verificado en vivo
intentando pagar una comision ya aprobada: el primer intento fallo con
"ya se resolvio y no se edita" -exactamente el bug que la prueba de
RLS debio haber atrapado y no atrapo a la primera, porque la prueba
original tambien asumia (incorrectamente) que aprobada era terminal-.
Corregido congelando solo en `paid`/`rejected` -los dos estados
verdaderamente terminales-, con la prueba reescrita para confirmar
exactamente esta secuencia: pendiente → aprobada (editable, avanza a
pagada) → pagada (ahi si se congela). El mismo patron que ya aplico
`bom` con su excepcion `active → obsolete`: el codigo de estado
"terminal" no siempre coincide con "ya no es el primer estado".

## Maquina de estados con el mismo criterio que un CAPA

`transicionValidaComision()`: `pending → approved | rejected`,
`approved → paid`. No se puede pagar sin aprobar primero -el mismo
criterio que ya uso `quality` para un CAPA-.

## El agujero de siempre (0031)

Una entrada de comision valida que su plan y su orden de venta sean
del mismo tenant.

## Lo que NO hace

- No liquida automaticamente por nomina -recomienda `payroll`, pero el
  pago en si es una accion manual, no una integracion-.
- No calcula comisiones escalonadas por volumen (mas venden, mayor
  porcentaje) -cada plan tiene una sola tasa fija-.
- No detecta ordenes de venta duplicadas entre planes -una misma orden
  podria, en teoria, generar mas de una entrada de comision si se crea
  dos veces, sin una validacion que lo impida-.

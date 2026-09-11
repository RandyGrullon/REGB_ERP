# `project-costing` — Costeo de proyectos

**Que resuelve:** saber si un proyecto va ganando o perdiendo plata
mientras todavia se puede hacer algo -no tres meses despues, cuando ya
se gasto-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** `projects` · **Recomienda:** `accounting`

Primer modulo de S68 (F10).

---

## El margen no se guarda: se deriva

`project_budget_total()`, `project_cost_total()` y `project_wip()` suman
directo del historial -mismo criterio que `loyalty_balance()` con los
puntos y `bank_account_balance()` con el saldo de una cuenta-. Un numero
guardado se desincroniza en cuanto alguien inserta una fila por otro
camino; uno derivado no puede. `desviacion()` y `margen()` viven en
`@regb/operations` y `margen()` devuelve `null` -no cero- cuando no hay
presupuesto contra que comparar, el mismo criterio que `tasaSobre()` de
`marketing`, que ademas se reutiliza aqui como `avanceSobrePresupuesto()`.

## Un costo es un hecho historico, con una excepcion pensada

`impedir_editar_costo()` congela el monto de un costo desde el insert:
lo que se gasto, se gasto. La UNICA columna que si se deja mover despues
es `billed`, porque marcar algo como facturado es **informacion nueva**,
no una correccion del pasado. Esa distincion es la misma que ya hizo
`commissions` al separar "ya no es el primer estado" de "es terminal".

## El WIP nunca es una deuda

`trabajoEnCurso()` usa `Math.max(0, ...)`: si se facturo mas de lo
gastado, el WIP es cero, no un negativo. Facturar de mas es un tema de
cuentas por cobrar, no de trabajo en curso.

Verificado en vivo sobre el proyecto sembrado (Renovacion bodega
principal): presupuesto RD$183,000 (45k mano de obra + 120k materiales +
18k equipos), gastado real RD$42,500, desviacion -RD$140,500, margen
76.8% y WIP RD$22,500 -solo el costo no facturado, porque el anticipo de
RD$20,000 ya estaba marcado facturado-.

## El agujero de siempre (0031)

Un presupuesto valida que su proyecto sea del mismo tenant; un costo
valida que su proyecto Y su linea de presupuesto lo sean.

## Lo que NO hace

- No contabiliza nada -recomienda `accounting`, pero no genera asientos;
  el costo vive aqui, el asiento se hace aparte-.
- No calcula avance de obra por porcentaje fisico -el avance que muestra
  es financiero: gastado contra presupuestado-.
- No jala automaticamente los costos de `timesheets` ni de compras -hay
  que registrarlos aqui, no se importan solos todavia-.

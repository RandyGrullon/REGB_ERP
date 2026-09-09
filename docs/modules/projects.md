# `projects` — Proyectos & Tareas

**Que resuelve:** un tablero real con dependencias que de verdad
bloquean -en vez de coordinar tareas encadenadas por memoria o por una
hoja de calculo que nadie actualiza-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** nada · **Recomienda:** `timesheets`

Primer modulo de F10 (S67). No es un vertical: la "regla de oro" de
§12.1 -que exige un cliente pagando antes de publicar un vertical como
`restaurant` o `clinic`- no le aplica.

---

## Una dependencia sin terminar bloquea de verdad

`puedeAvanzarPorDependencias()` decide si una tarea puede pasar a "en
curso" o "hecha": solo si TODAS sus dependencias estan `done`. La misma
regla vive dos veces a proposito, en dos capas distintas: en la accion
del servidor (para dar un mensaje claro sin ensuciar la transaccion) y
en el trigger `no_avance_con_dependencias_abiertas` (la garantia real,
que ningun camino de codigo puede saltarse). Verificado en vivo sobre
el proyecto sembrado: "Pintar paredes" NO pudo avanzar mientras
"Vaciar bodega" seguia pendiente, y avanzo sin problema en cuanto esa
dependencia quedo `done`.

## Un bug real que solo aparecio corriendo la pantalla

La primera version de la accion atrapaba la excepcion del trigger con
un `try/catch` dentro de la transaccion. Postgres aborta la transaccion
entera al primer error -no se puede seguir emitiendo sentencias sin un
SAVEPOINT-, asi que el `COMMIT` posterior fallaba y la pantalla moria
con "Application error: a server-side exception has occurred".
Verificado en vivo, no en teoria. Corregido precomprobando las
dependencias con la funcion pura ANTES del `update`, el mismo criterio
que ya usa cualquier otro modulo con su `transicionValidaX()`: el
trigger deja de dispararse en el flujo normal y sigue siendo la
garantia de fondo.

## Un hito vencido todavia se puede completar

Segundo bug encontrado en vivo: la pantalla mostraba solo la insignia
"Vencido" y escondia el boton de completar, dejando un hito atrasado
sin ninguna forma de cerrarlo. Corregido para mostrar la insignia Y el
boton juntos -llegar tarde no deberia impedir marcar que ya se hizo-.
`hitoVigente()` reutiliza `certificadoVigente()` de `training.ts`,
**novena vez** que esa funcion se reusa en el proyecto.

## El agujero de siempre (0031)

Una tarea y un hito validan que su proyecto sea del mismo tenant; una
dependencia valida que AMBAS tareas lo sean.

## Lo que NO hace

- No dibuja un Gantt visual -guarda fechas de inicio/fin y
  dependencias reales, pero esta version las muestra como tablero
  kanban y listas, no como barras en una linea de tiempo-.
- No tiene plantillas de proyecto todavia -el catalogo las promete,
  esta version no las incluye-.
- No asigna tareas a un usuario desde la pantalla -`assigned_to`
  existe en la tabla pero el formulario no lo expone-.

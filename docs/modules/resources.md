# `resources` — Planificacion de recursos

**Que resuelve:** ver quien esta sobrecargado ANTES de prometerle otra
tarea -no cuando ya incumplio-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** `projects` · **Recomienda:** nada

Segundo modulo de S68 (F10).

---

## Llena no es lo mismo que imposible

`estaSobrecargado()` usa **mayor estricto**: asignarle a alguien
exactamente sus 40 horas NO es sobrecarga, es una semana llena. Esa
distincion importa en la practica -si el sistema grita "sobrecargado"
cuando la semana simplemente esta completa, el equipo aprende a ignorar
la alerta y deja de servir-.

## La sobrecarga se deriva, no se guarda como bandera

`resource_allocated_hours()` suma las asignaciones de esa persona en esa
semana en el momento de preguntar -mismo criterio que el margen en
`project-costing` o el saldo de puntos en `loyalty`-. No hay columna
`sobrecargado` que alguien tenga que acordarse de actualizar.
`capacidadDisponible()` tambien usa `Math.max(0, ...)`: quedarse sin
horas da cero, nunca un negativo. `porcentajeUtilizacion()` reutiliza
`tasaSobre()` de `marketing` tal cual.

Verificado en vivo: Maria Rosario con 40 horas de capacidad y dos
asignaciones de 24 + 22 = 46 horas aparece en rojo como "Sobrecargado",
con 0 disponibles.

## Todo se ancla al lunes

Las tablas guardan `week_start` y la accion normaliza cualquier fecha al
lunes de esa semana (`lunesDe()`), asi dos personas planificando la
misma semana desde dias distintos escriben la misma fila en vez de
crear dos semanas fantasma.

## El agujero de siempre (0031)

Una asignacion valida que su tarea sea del mismo tenant.

## Lo que NO hace

- No mira `timesheets` -la capacidad planificada y las horas realmente
  trabajadas son dos cosas distintas y hoy no se comparan entre si-.
- No tiene calendario visual ni arrastrar-y-soltar: es una tabla por
  semana, no un Gantt de recursos.
- No planifica por dia, solo por semana -un dia exacto seria falsa
  precision para como se planifica de verdad en una PYME-.

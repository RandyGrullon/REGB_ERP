# `automations` — Automatizaciones

**Que resuelve:** reglas si-esto-entonces-aquello entre modulos, sin
codigo -en vez de que alguien tenga que acordarse de revisar
manualmente cuando pasa algo importante-.

**Categoria:** `advanced` · **Precio:** 400/1500/4000 instalacion ·
45/160/420 mes · **Requiere:** nada · **Recomienda:** nada

Unico modulo de S63 (F9).

---

## Consume el mismo rastro de eventos que YA usan mas de veinte modulos

Ninguna infraestructura nueva: una regla escucha un `trigger_event_type`
exacto -el mismo formato `<modulo>.<entidad>.<accion>` que `emit_event()`
exige desde el primer modulo de este proyecto-. Este modulo es el
primer CONSUMIDOR real de ese rastro de eventos, aparte del propio
despachador de fondo.

## Nunca toca el despachador real

`claim_events()`/`settle_event()` estan revocados de `authenticated`
a proposito -son del despachador global, sin filtro de tenant, pensado
para un solo worker de fondo, no para que cada tenant los llame por su
cuenta-. `automations` NUNCA los invoca. En cambio solo LEE
`public.event_outbox` -su propia RLS ya lo filtra por tenant- y lleva
su PROPIA bitacora en `automation_runs`, marcando (regla, evento) como
ya visto sin tocar `processed_at` de la fila original. Dos consumidores
independientes pueden procesar el mismo rastro sin pisarse.

## Una accion vetada, no codigo arbitrario

`action_type` tiene un `check` fijo -hoy solo `create_notification`,
que escribe en `public.notifications`, una tabla real del core-. Mismo
criterio que `bi` con su catalogo fijo de fuentes de reporte: nunca se
ejecuta una funcion libre que un tenant pudiera manipular.

## Honesto sobre no correr solo

"Procesar eventos pendientes" es un boton, no un despachador
automatico -declarado sin rodeos en el FAQ del marketplace-. Verificado
en vivo: la regla sembrada ("Avisar tickets urgentes resueltos",
disparada por `helpdesk.ticket.resolved` con la condicion
`priority = urgent`) proceso el evento sembrado y creo una notificacion
real -visible en `/notificaciones` con su titulo, cuerpo y la etiqueta
del modulo `automations`-. Procesar de nuevo NO duplico nada: el
mismo (regla, evento) ya estaba en `automation_runs`, exactamente el
comportamiento que su `unique` constraint garantiza.

## Un artefacto real que este modulo destapó

Al sembrar el evento de prueba se encontraron DOS eventos
`helpdesk.ticket.resolved` ya existentes en `distribuidora-caribe` -
residuo de una prueba en vivo anterior de `helpdesk` en esta misma
sesion, cuyo payload solo tenia `ticketId`, sin `priority`-. La regla
los evaluo correctamente y los marco "no cumplio la condicion" -el
motor de automatizaciones funciono exactamente como deberia; el
problema era el dato de prueba residual, no el modulo-. Limpiado el
residuo y sembrado el evento correcto con `priority: "urgent"`.

## El agujero de siempre (0031)

Una ejecucion valida que su regla Y su evento sean del mismo tenant.

## Lo que NO hace

- No corre en segundo plano automaticamente -hay que pedirle que
  procese los eventos pendientes desde la pantalla-.
- No ejecuta codigo arbitrario ni llama a un webhook -el catalogo de
  acciones es fijo, hoy solo crear una notificacion real-.
- No reintenta ni tiene backoff propio -esa disciplina vive en el
  despachador real (`claim_events`/`settle_event`), que este modulo
  deliberadamente no toca-.

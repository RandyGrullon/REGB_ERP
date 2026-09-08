# `helpdesk` — Mesa de ayuda

**Que resuelve:** un ticket formal para cada caso de soporte -sin
depender del chat personal de quien atendio primero-, con un SLA que
se calcula contra una fecha limite real, no de memoria.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** nada · **Recomienda:** `customer-portal`

Segundo modulo de S58 (F9) — cierra F9 con `customer-portal`.

---

## Resuelto SI se puede reabrir; cerrado es terminal de verdad

`transicionValidaTicket()`: `open → in_progress`, `in_progress →
waiting_customer | resolved`, `waiting_customer → in_progress |
resolved`, `resolved → closed | in_progress`, `closed → []`. Un
ticket resuelto puede volver a `in_progress` si el cliente responde que
el problema sigue -pero cerrado no tiene marcha atras-. Verificado en
vivo: la secuencia completa `open → in_progress → resolved (5/5
satisfaccion) → in_progress (reabierto) → resolved → closed` funciono
exactamente asi, y una vez cerrado la pantalla ya no ofrece ningun
boton de transicion ni el formulario de respuesta -el trigger
`no_editar_ticket_cerrado` lo respalda a nivel de base de datos, no
solo en la UI-.

## El SLA se fija una vez, no se recalcula

Al crear el ticket, `sla_due_at` se calcula sumando horas fijas por
prioridad (urgente 4h, alta 8h, normal 24h, baja 72h) a `now()` -y
queda fijo desde ahi, aunque la prioridad cambie despues-. El vencimiento
se comprueba reutilizando `certificadoVigente()` de `training.ts` como
`slaVigente()` -**septima vez** que esta funcion se reusa en el
proyecto (fleet, lots-serials, quality, quotes, contracts, helpdesk, y
antes de eso su uso original en training)-.

## Cada mensaje es un hecho historico

`diasAbierto()` de `quality.ts` se reusa tal cual como
`diasTicketAbierto()` para saber cuanto lleva abierto un caso. Los
mensajes del hilo (`ticket_messages`) son inmutables desde el insert
-la conversacion real, no una que se pueda reescribir despues-.
Verificado en vivo: un mensaje de agente se registro y el intento de
editarlo fallo con "no se edita ni se borra".

## Deliberadamente sin `requires`

A diferencia de `commissions` (que exige `sales-orders`), `helpdesk`
declara `requires: []` y solo `recommends: ['customer-portal']`: un
ticket puede venir de una llamada o un correo, no necesita que el
cliente tenga portal. `customer_id` en `tickets` es una FK real pero
nullable -por eso el seed de demo incluye un cliente identificado, pero
la UI permite crear un ticket "Sin cliente"-.

## El agujero de siempre (0031)

Un ticket valida que su cliente sea del mismo tenant; un mensaje valida
que su ticket lo sea.

## Lo que NO hace

- No tiene una vista publica para que el cliente responda por si mismo
  -toda la conversacion hoy la escribe el agente desde la pantalla de
  staff, aunque `author_type` ya distingue `customer`/`agent` para
  cuando esa vista exista-.
- No asigna tickets automaticamente por carga de trabajo -`assigned_to`
  existe en la tabla pero la UI actual no lo expone-.
- No calcula un SLA distinto por cliente o por plan de soporte -las
  horas por prioridad son fijas para todo el tenant-.

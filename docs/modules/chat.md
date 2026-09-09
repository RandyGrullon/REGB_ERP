# `chat` — Chat interno

**Que resuelve:** un canal propio por modulo, proyecto o sucursal -en
vez de que la conversacion del equipo viva dispersa en WhatsApp
personal sin quedar ligada al trabajo del que habla-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** nada · **Recomienda:** nada

Primer modulo de S65-66 (F9) — cierra F9 junto con `ai-copilot`.

---

## Un mensaje enviado es un hecho historico

Igual que un mensaje de ticket o una actividad de lead: inmutable
desde el insert (`impedir_editar_mensaje_chat()`), nunca se edita ni
se borra despues. Un hilo es simplemente un mensaje que apunta a otro
via `parent_message_id` -verificado en vivo: responder dentro del
mensaje sembrado de Maria Rosario creo una fila real anidada, visible
como respuesta indentada bajo el mensaje original-.

## Las menciones se eligen, nunca se adivinan

`user_profiles` no tiene un `@handle` unico -solo `display_name`-, asi
que mencionar a alguien se hace eligiendolo de una lista real de
usuarios del tenant al componer el mensaje (`mentioned_user_ids
uuid[]`), nunca parseando `@nombre` de texto libre -evita la ambiguedad
de un nombre con espacios o dos personas con el mismo nombre-.
`formatearMencion()` solo decide como se VE la mencion despues
(`@NombreSinEspacios`). Verificado en vivo: marcar a Maria Rosario en
un mensaje nuevo la mostro como `@MariaRosario` bajo el mensaje.

## El agujero de siempre (0031)

Un mensaje valida que su canal Y su mensaje padre (si responde a un
hilo) sean del mismo tenant.

## Lo que NO hace

- No permite editar ni borrar un mensaje enviado -es un hecho
  historico, la misma disciplina que ya aplican `helpdesk` y `crm`-.
- No detecta menciones escribiendo `@nombre` en el texto -se eligen de
  una lista real, ver arriba-.
- No tiene notificaciones push propias -el widget de menciones
  recientes es informativo, no dispara un aviso en tiempo real-.

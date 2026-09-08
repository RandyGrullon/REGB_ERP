# `customer-portal` — Portal de clientes

**Que resuelve:** el cliente ve sus propias facturas sin que nadie del
negocio tenga que mandarle un PDF por WhatsApp cada vez -entra con un
enlace unico, no con una contraseña que el negocio tenga que
administrar-.

**Categoria:** `standard` · **Precio:** 150/600/1800 instalacion ·
19/69/190 mes · **Requiere:** nada · **Recomienda:** `ar`

Primer modulo de S58 (F9).

---

## La primera pagina de todo el proyecto sin sesion de empleado

Todo modulo anterior se renderiza dentro del `Shell` autenticado, con
`asUser()` fijando los claims de un empleado real. `/portal-cliente/[token]`
es distinto de raiz: es una ruta publica de verdad, sin `modulePage()`,
sin rol, sin tenant en la URL. Usa la conexion de servicio `db()` -la
misma que ya existe para consultas pre-sesion, documentada en
`lib/db.ts` como "aqui NO se aplica RLS por si sola"- para buscar el
token exacto, y de ahi en adelante CADA consulta subsiguiente se filtra
por el `tenant_id`/`customer_id` que ESA busqueda devolvio, nunca por
un parametro que mande el cliente. El manifest lo refleja a proposito:
su `routes[]` solo lista `/portal-clientes` (la pantalla de staff); la
pagina publica no esta bajo el sistema de RBAC/registro de modulos en
absoluto, porque nadie con sesion de tenant la visita.

## Un enlace, no una cuenta

El token es un secreto de alta entropia (`crypto.randomBytes(24)` en
base64url) -quien lo tenga entra, sin usuario ni contraseña que
recordar-. Por eso revocar una invitacion tiene que dejarla inutilizable
de inmediato: verificado en vivo, revocando la invitacion sembrada de
Ferreteria El Martillo y confirmando que `/portal-cliente/<token>` paso
de mostrar sus dos facturas reales a un 404 limpio en el mismo
segundo. No es "un sistema de autenticacion completo, mas parecido a
un enlace magico" -documentado asi porque es la decision de alcance
correcta para lo que resuelve: ver facturas, no gestionar una cuenta.

## Cada visita es un hecho historico

`portal_access_log` es inmutable desde el primer insert -igual que
`signature_events` o `ticket_messages`-, y cada visita a la pagina
publica actualiza `last_accessed_at` en la invitacion. Verificado en
vivo: la fila de invitacion en `/portal-clientes` mostro la hora real
de la visita despues de cargar la pagina publica una sola vez.

## El agujero de siempre (0031)

Una invitacion valida que su cliente sea del mismo tenant; un acceso
valida que su invitacion lo sea.

## Lo que NO hace

- No cobra dentro del portal -el cliente ve el estado de sus facturas,
  pero pagar sigue siendo un proceso fuera de esta pantalla-.
- No permite que el cliente abra un ticket desde aqui -esa conexion
  queda para cuando `helpdesk` reciba su propia vista publica, que hoy
  no existe-.
- No expira las invitaciones por tiempo -una activa sigue activa hasta
  que alguien la revoca a mano, no hay una fecha de vencimiento
  automatica-.

# `notifications` — Notificaciones

**Que resuelve:** una bandeja dentro del ERP donde los modulos avisan de lo
que pide atencion: un pedido entregado sin facturar, un descuadre de caja,
productos bajo el punto de reorden.

**Categoria:** `core` (§5.1 #8) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✔️ (`mobileScope: view`)

---

## Personal o para todo el equipo

`public.notifications` ([`0016_core_platform.sql`](../../supabase/migrations/0016_core_platform.sql))
tiene `user_id` nullable: con usuario es personal; **nulo es para todo el
tenant** y la pantalla lo marca con "todo el equipo".

## Leido es por persona (0125)

Hasta [`0125_avisos_leidos_por_persona.sql`](../../supabase/migrations/0125_avisos_leidos_por_persona.sql)
el aviso tenia **un solo** `read_at`: el primero que marcaba uno de equipo se
lo apagaba a todos, y dejaba de contar en sus campanas. Como todo lo que llega
es de equipo, el cajero que abria la bandeja a las 8 le borraba al gerente el
"falto efectivo en el cierre".

Ahora lo leido vive en `public.notification_reads (tenant_id,
notification_id, user_id, read_at)`, una fila por persona que lo leyo, para
**todos** los avisos -personales incluidos- y `notifications.read_at` ya no
existe. Una sola forma de responder "¿lo lei?": si alguien vuelve a escribir
`set read_at`, la consulta falla en vez de apagarle la campana al equipo.

| Pieza | Que garantiza |
|---|---|
| Clave primaria `(tenant_id, notification_id, user_id)` | Tenant al frente; es justo la pregunta de la campana: "¿hay lectura de este aviso para mi?" |
| FK **compuesta** `(tenant_id, notification_id)` → `notifications (tenant_id, id)` | La guarda de tenant cruzada, en la llave: una lectura no puede apuntar al aviso de otro cliente. Borrar un aviso se lleva sus lecturas |
| Trigger `no_leer_aviso_ajeno` | Nadie marca el aviso **personal** de un companero (misma tenant, la FK lo dejaria pasar). Errcode 42501 |
| RLS forzada, `user_id = rls.regb_uid()` | Cada quien ve y escribe solo sus lecturas; nadie marca a nombre de otro |

**Lo que ya estaba leido al migrar:** un personal pasa tal cual. Uno de
equipo no dice quien lo leyo -el modelo viejo no lo guardaba-, asi que se da
por leido para todos los miembros del cliente: es exactamente lo que cada uno
veia ayer. Dejarlo sin leer le revivia a cada usuario avisos de semanas.

### La bandeja, en un solo sitio

La pantalla, la campana del Shell (`unreadCount()` en `module-page.ts`), las
acciones y las pruebas llaman a las mismas funciones SQL. Todas son `security
invoker` -corren con la RLS de quien llama- y sacan usuario y tenant del JWT,
nunca de un argumento:

| Funcion | Uso |
|---|---|
| `mis_avisos(limite)` | La lista: lo tuyo y lo de todos, con **tu** `read_at`, no leido primero |
| `avisos_sin_leer()` | El numero de la campana y el de la cabecera de `/notificaciones` (antes esa contaba solo entre los 100 que pinta) |
| `marcar_aviso_leido(id)` | Devuelve si cambio algo: marcar dos veces es un doble clic, no un error |
| `marcar_avisos_leidos()` | Todos los tuyos; los de tus companeros no se tocan |

## Privacidad de los avisos personales (0125)

La politica de 0016 filtraba por tenant y modulo, no por destinatario: por
PostgREST cualquiera del equipo leia los avisos personales de un companero.
Ahora `using` exige `user_id is null or user_id = rls.regb_uid()`. `with
check` no mira el destinatario: escribirle un aviso a otra persona sigue
permitido (sin `returning`, porque no lo puedes leer de vuelta).

## Quien escribe aqui

El modulo no genera avisos propios: los escriben otros.

| Origen | Que avisa |
|---|---|
| Despachador del bus (`apps/web/src/lib/despachador.ts`) | `sales-orders.order.delivered` → pedido entregado sin facturar · `pos.shift.closed` con diferencia → falto o sobro efectivo · `pos.sale.completed` → productos bajo reorden · `sales-orders.order.confirmed` con backorder → lineas prometidas sin existencia |
| `automations` | La accion de notificar de una regla |
| REGB Control (`control/solicitudes-actions.ts`) | "Ya tienes lo que pediste": modulos activados en prueba tras una solicitud |

Los tres escriben con `user_id` nulo: **todo lo que llega hoy es para todo el
equipo**. No hay ningun productor de avisos personales.

El despachador no repite: antes de insertar comprueba si ya hay un aviso con
el mismo titulo y enlace en las ultimas 24 horas. Una bandeja con el mismo
mensaje cinco veces hace que el cliente deje de mirarla.

## Marcar como leida no hace ruido

Marcar una sola no muestra aviso de exito (el punto desaparece a la vista);
el error si se muestra, para que un permiso denegado no parezca un boton
muerto. "Marcar todas leidas" si confirma. La descripcion de la pantalla
dice que marcar uno de equipo solo lo apaga para ti.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/notificaciones` | `notifications.view` | Las 100 mas recientes, no leidas (por ti) primero; marcar una o todas |

```
┌─ Notificaciones ──────────────── [3 sin leer] [Marcar todas leidas]┐
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ Falto efectivo en el cierre de caja  [pos] [todo el equipo]  │   │
│ │ La diferencia fue de 350.00. Casi nunca es robo...  [Leida]  │   │
│ │ 22 sept 18:40 · Ver                                          │   │
│ ├──────────────────────────────────────────────────────────────┤   │
│ │ Hay un pedido entregado sin facturar [ar] [todo el equipo]   │   │
│ │ El pedido PV-000214 ya se entrego. Emitele la factura...     │   │
│ └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `notifications.view` | Abre la bandeja |
| `notifications.edit` | Marcar como leida, una o todas |
| `notifications.create`, `notifications.delete`, `notifications.export` | Declarados; ninguna accion los usa |

## Eventos

| Evento | Estado |
|---|---|
| `notifications.notice.sent` | ✅ Se emite desde 0125, con un trigger `after insert` en `notifications` |

Un trigger porque es el unico punto por donde pasan los tres productores, y
dos de ellos escriben sin sesion de usuario. Con sesion pasa por
`emit_event()`; sin ella `emit_event()` exigiria un tenant en el JWT y
revertiria el aviso entero, asi que el tenant sale de la fila.

**Payload:** `notificationId`, `moduleId` (origen), `userId` (nulo = equipo),
`title`, `link`. **No** lleva el cuerpo: es lo que mas facil lleva un monto,
y un evento puede salir por webhook.

**Los avisos de `automations` no emiten.** Una regla "cuando se envie un
aviso, crea un aviso" se alimentaria a si misma: cada pasada del procesador
crearia el aviso que dispara la siguiente.

Para que sirve: llevar el aviso a otro canal. Hoy, un webhook de
`api-webhooks`; el dia que existan, correo y push.

## Pruebas

| Archivo | Que fija |
|---|---|
| [`supabase/tests/notifications.test.ts`](../../supabase/tests/notifications.test.ts) | Dos personas del mismo cliente: una lee, la otra lo sigue viendo sin leer en la lista y en la campana; "marcar todas" es por persona; personales privados y que nadie marca por otro; aislamiento entre clientes (ver, marcar, colar una lectura con la FK compuesta); modulo apagado; borrar se lleva las lecturas; el evento con y sin sesion, sin cuerpo y sin bucle (26 pruebas) |
| [`apps/web/src/app/notificaciones/notificaciones.accion.test.ts`](../../apps/web/src/app/notificaciones/notificaciones.accion.test.ts) | `marcarLeida` y `marcarTodasLeidas` reales: lo que marca el usuario de la demo no se lo apaga a un companero; sin `notifications.edit` no marca y lo dice; un id basura no revienta (7 pruebas) |

Antes de 0125 estaban en rojo 30 de las 33 (y con el SQL viejo de la accion,
reproducido en la demo: el colmado pasaba de 1 aviso sin leer a 0 para
**todos** en cuanto una persona lo marcaba). Despues, 33 en verde.

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ `audit:manifests` en verde |
| 2 | Migraciones + RLS probadas | ✅ `notifications.test.ts`, mas la red de `isolation.test.ts` |
| 3 | Logica pura con cobertura | ➖ no tiene; la logica de la bandeja vive en SQL y esta probada contra la base. Los handlers del despachador siguen sin prueba propia |
| 4 | UI web responsive | ⚠️ no verificado en navegador en esta entrega; la pantalla usa solo tokens, asi que sigue al tema claro y al oscuro |
| 5 | UI movil | ⚠️ `mobileScope` declarado; la app movil no tiene bandeja. Cuando la tenga, `mis_avisos()` y `marcar_aviso_leido()` se llaman igual por PostgREST |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f13.notificaciones` tiene 4 pasos |
| 8 | Datos demo | ✅ un aviso de marketplace para todo el equipo del colmado |
| 9 | ≥2 widgets | ❌ ninguno; el contador de la campana vive en el Shell |
| 10 | Eventos documentados | ✅ `notifications.notice.sent` se emite y esta documentado |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/notificaciones` en la sonda de F4, tercera pasada sin fallos. El boton "Leida" lleva ahora `aria-label` con el titulo del aviso |

## Lo que NO hace

- **Saber quien del equipo no ha leido algo.** Cada quien ve solo sus
  lecturas. Si un gerente lo necesita, es una funcion aparte con su propio
  permiso, no algo que se regale por la RLS.
- **Correo, push, WhatsApp, preferencias por usuario.** El tour
  `f13.notificaciones` dice "elige por donde te llega" y "cada quien
  configura las suyas"; §5.1 y el catalogo prometen push, correo y
  WhatsApp. Hoy solo existe la bandeja dentro del ERP, igual para todos. El
  evento `notifications.notice.sent` es el enganche para construirlo.
- **Borrar o archivar avisos.** Se acumulan; la pantalla ensena los 100 mas
  recientes. La cuenta de la campana recorre todos los avisos del usuario:
  sin el indice parcial de 0016 (se fue con `read_at`), un tenant con
  decenas de miles de avisos lo notaria. Hoy el volumen es bajo -el
  despachador no repite en 24 h-.

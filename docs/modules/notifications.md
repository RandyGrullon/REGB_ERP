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
tenant** y la pantalla lo marca con "todo el equipo". El indice parcial
`where read_at is null` hace barato el contador de no leidas de la campana,
que se calcula en cada pantalla (`unreadCount()` en `module-page.ts`).

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
muerto. "Marcar todas leidas" si confirma.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/notificaciones` | `notifications.view` | Las 100 mas recientes, no leidas primero; marcar una o todas |

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
| `notifications.notice.sent` | Declarado; **ningun codigo lo emite** |

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ⚠️ solo la red de `isolation.test.ts` (RLS `enable` + `force` + politica). Sin prueba propia |
| 3 | Logica pura con cobertura | ➖ no tiene; los handlers del despachador tampoco tienen prueba propia |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ⚠️ `mobileScope` declarado; la app movil no tiene bandeja |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f13.notificaciones` tiene 4 pasos |
| 8 | Datos demo | ✅ un aviso de marketplace para todo el equipo del colmado |
| 9 | ≥2 widgets | ❌ ninguno; el contador de la campana vive en el Shell |
| 10 | Eventos documentados | ⚠️ documentado aqui que el evento declarado no se emite |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/notificaciones` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Leido por persona en los avisos de equipo.** Un aviso con `user_id` nulo
  tiene **un solo** `read_at` para todo el tenant: el primero que lo marca
  como leido se lo apaga a los demas, y deja de contar en su campana. Como
  todos los productores escriben avisos de equipo, esto aplica a todo lo que
  llega hoy. Arreglarlo pide una tabla de lecturas por usuario (migracion
  nueva).
- **Privacidad entre companeros.** La RLS filtra por tenant y modulo activo,
  no por `user_id`. La pantalla solo pide lo tuyo y lo de equipo, pero la
  base no impide que un usuario del mismo tenant lea los avisos personales
  de otro.
- **Correo, push, WhatsApp, preferencias por usuario.** El tour
  `f13.notificaciones` dice "elige por donde te llega" y "cada quien
  configura las suyas"; §5.1 y el catalogo prometen push, correo y
  WhatsApp. Hoy solo existe la bandeja dentro del ERP, igual para todos.
- **Borrar o archivar avisos.** Se acumulan; la pantalla ensena los 100 mas
  recientes.

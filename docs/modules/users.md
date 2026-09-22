# `users` — Usuarios

**Que resuelve:** quien esta en el equipo, con que rol, y como entra alguien
nuevo. Cada persona con su propio usuario, para que la bitacora sirva.

**Categoria:** `core` (§5.1 #2) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno en el
manifiesto (el catalogo de 0009 dice `{auth}`) · **Plataformas:** web ✔️
desktop ✔️ movil ✔️ (`mobileScope: view`)

---

## Identidad en Supabase, perfil en el tenant

La clave y el MFA viven en `auth.users` de Supabase. Lo que el tenant **ve**
de su gente vive en `public.user_profiles`
([`0016_core_platform.sql`](../../supabase/migrations/0016_core_platform.sql)):
nombre, correo, telefono, puesto. El acceso vive en `public.memberships`
([`0003_tenant_core.sql`](../../supabase/migrations/0003_tenant_core.sql)):
rol, sucursales, empresas, `is_active`, `invited_at`, `accepted_at`.

| Estado en `memberships` | Que ve la persona |
|---|---|
| `invited_at` sin `accepted_at` | Nada: el token sale sin tenant ([`auth`](auth.md)) |
| Aceptada y `is_active` | Su tenant, con su rol |
| `is_active = false` | Nada, desde el siguiente token. Su historial se queda |

## Desactivar, nunca borrar

"Desactivar" pone `is_active = false`. No hay boton de borrar: lo que esa
persona hizo sigue en la bitacora con su nombre. Nadie puede desactivarse a
si mismo (la accion lo rechaza), para que un administrador no se deje fuera
por error.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/usuarios` | `users.view` | Lista con rol y estado; cambiar rol; desactivar/reactivar; invitar |

```
┌─ Usuarios ────────────────────────────────────────────────────────┐
│ 3 en el equipo · 2 con acceso activo                              │
├───────────────┬──────────────────────┬────────────┬──────────────┤
│ Nombre        │ Correo               │ Rol        │ Estado       │
├───────────────┼──────────────────────┼────────────┼──────────────┤
│ Maria Rosario │ maria.rosario@demo.do│ [Owner v]  │ Activo       │
│ Juana Perez   │ juana@colmado.do     │ [Cajero v] │ Activo       │
│               │                      │  [Cambiar] │ [Desactivar] │
│ Pedro Almonte │ pedro@colmado.do     │ [Almac. v] │ Activo       │
│               │                      │            │ [invitado]   │
└───────────────┴──────────────────────┴────────────┴──────────────┘
┌ Invitar a alguien ────────────────────────────────────────────────┐
│ Nombre [Juana Perez] Correo [juana@tuempresa.do] Rol [v] [Invitar]│
│ La invitacion llega por correo. El rol decide que modulos ve.     │
└───────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `users.view` | Abre `/usuarios` |
| `users.create` | Invitar |
| `users.edit` | Cambiar rol, desactivar y reactivar |
| `users.delete`, `users.export` | Declarados; ninguna accion los usa |

Los **roles** en si (que permisos tiene cada uno) se editan en `/roles`, que
no pertenece a este manifiesto. El tour `core.permisos` cuelga de `users`
porque `rbac` no es un modulo del registry.

## Eventos

| Evento | Estado |
|---|---|
| `users.member.invited`, `users.member.deactivated` | Declarados; **ningun codigo los emite** |

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega. Su `requires` no coincide con el del catalogo |
| 2 | Migraciones + RLS probadas | ⚠️ parcial. `isolation.test.ts`: A no ve las membresias de B. `auth-hook.test.ts`: `invite_member()` invita en su tenant, **rechaza un rol de otro cliente** y exige tenant en el JWT. Pero la pantalla no usa `invite_member()` (ver abajo) |
| 3 | Logica pura con cobertura | ➖ no tiene |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ⚠️ `mobileScope` declarado; la app movil no tiene pantalla de usuarios |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `core.permisos` tiene 4 pasos; `core.bienvenida` (modulo `tour`) le dedica uno mas |
| 8 | Datos demo | ✅ Maria Rosario, Owner en los dos tenants demo |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ⚠️ documentado aqui que los eventos declarados no se emiten |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/usuarios` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Mandar la invitacion.** La pantalla dice "la invitacion llega por
  correo". `invitarMiembro()` inserta un perfil y una membresia con un
  `user_id` **inventado** (`crypto.randomUUID()`) y no envia nada. El comentario
  del codigo lo admite: "aqui se genera para que el flujo completo sea
  recorrible en demo". Con Supabase real, esa fila nunca se enlaza con la
  persona cuando se registre: no hay reconciliacion por correo.
- **Usar la funcion que si valida.** `public.invite_member()` (0008) comprueba
  que el rol sea del mismo tenant y busca al usuario en `auth.users`. La
  accion de la pantalla no la llama: escribe directo en `memberships`.
- **Impedir un rol de otro cliente.** `memberships.role_id` es una FK a
  `roles` **sin** trigger que compare tenants, y ni `invitarMiembro()` ni
  `cambiarRolMiembro()` validan el `roleId` del formulario. Una FK se
  comprueba sin pasar por la RLS, asi que un `roleId` de otro tenant
  enviado a mano se guarda. No se verifico que permisos acaba teniendo esa
  persona en ese caso; lo que si es seguro es que la fila no deberia poder
  existir. Pide una migracion nueva (regla de la casa: FK a tabla con
  `tenant_id` lleva trigger en `insert` y `update`).
- **Evitar dejar el tenant sin Owner.** Se impide desactivarse a uno mismo,
  pero no cambiarse el propio rol a uno sin permisos, ni desactivar al
  ultimo Owner desde otra cuenta.
- **Avatar, idioma, zona horaria, preferencias por usuario.** Estan en §5.1 y
  en el catalogo; no existen.
- **Asignar sucursales o empresas a una persona.** `branch_ids` y
  `company_ids` existen en la membresia y viajan en el token, pero esta
  pantalla no los edita.

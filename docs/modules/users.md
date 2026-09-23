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
| `invited_at` sin `accepted_at` | Nada: el token sale sin tenant ([`auth`](auth.md)). Desde 0123 invitar ya no crea filas asi |
| Aceptada y `is_active` | Su tenant, con su rol |
| `is_active = false` | Nada, desde el siguiente token. Su historial se queda |

## Invitar: la membresia nace cuando la persona acepta

Desde [`0123_invitaciones_de_usuarios.sql`](../../supabase/migrations/0123_invitaciones_de_usuarios.sql)
lo pendiente vive en `public.user_invitations`, **no** en `memberships`. Antes
se insertaba una membresia con un `user_id` inventado que nunca podia
enlazarse con la persona real.

```mermaid
sequenceDiagram
  participant A as Admin (/usuarios)
  participant DB as Postgres
  participant F as Edge Function invitar-usuario
  participant S as Supabase Auth
  participant P as Persona invitada
  A->>DB: crear_invitacion(correo, nombre, rol)
  DB-->>A: token (una sola vez; se guarda su sha256)
  A->>F: invitationId + token, con el JWT del admin
  F->>DB: invitacion_para_enviar() como el admin (RLS + users.create + hash)
  F->>S: auth.admin.inviteUserByEmail (llave de servicio)
  S-->>P: correo con /auth/invitacion/<token>?token_hash=...
  A->>DB: marcar_invitacion_enviada() solo si F respondio 200
  P->>S: verifyOtp(token_hash) -> sesion
  P->>DB: aceptar_invitacion(token) con SU JWT
  DB-->>P: membresia con user_id = sub del JWT
  P->>S: refreshSession -> el hook ya pone su tenant
```

| Estado de la invitacion | Cuando | Terminal |
|---|---|---|
| `pending` | Recien creada o reenviada | no |
| `accepted` | `aceptar_invitacion()` con el correo invitado | si |
| `revoked` | `revocar_invitacion()` | si |
| `expired` | Se intento aceptar vencida, o se invito de nuevo a ese correo | si |

Lo que hace cumplir la base, no la pantalla:

- **Token como hash.** `crear_invitacion()` y `reenviar_invitacion()`
  devuelven el token en claro una sola vez; la fila guarda `sha256`. La
  bitacora lo guarda oculto (`audit.record('users', 'token_hash')`, 0103).
  `authenticated` ni siquiera puede leer esa columna (grant por columnas).
- **Nadie escribe la tabla directo.** Sin grant de `INSERT/UPDATE/DELETE`
  para `authenticated` y sin politica de escritura: solo por las funciones,
  que miran cliente, modulo `users` y permiso (`rls.has_perm`), porque
  PostgREST no pasa por `exigir()` de la app. La politica de lectura pide
  ademas `users.view`.
- **Rol con guarda propia** (`no_rol_ajeno`): un `role_id` de otro cliente
  se rechaza aunque se salte la funcion.
- **Aceptar** (`aceptar_invitacion(token)`, security definer): usa el `sub`
  del JWT como `user_id` y el correo de `auth.users` (confirmado) o, en un
  Postgres sin Supabase, el claim `email`. Devuelve un resultado en vez de
  lanzar error para poder guardar el vencimiento: `aceptada`,
  `ya_aceptada`, `ya_miembro`, `invalida`, `vencida`, `revocada`,
  `otro_correo`, `otro_cliente`, `sin_sesion`, `correo_sin_confirmar`.
- **Una cuenta, un cliente.** Si la persona ya tiene una membresia activa en
  otro cliente, `otro_cliente`: el hook toma una con `limit 1` y sin orden,
  asi que aceptar la mudaria al azar.
- **Reenviar = token nuevo.** El enlace anterior deja de servir.
- `public.invite_member()` (0008) **se elimino**: inventaba el `user_id` si
  el correo no estaba en `auth.users`, no miraba `users.create` y su
  `on conflict ... do update set role_id` dejaba cambiar el rol de una
  membresia existente "invitandola".

### Modo demostracion: honesto

Sin Supabase no hay servidor de correo. La accion crea la invitacion igual,
**no** marca `sent_at`, y la pantalla dice "Correo NO enviado" con el
enlace para copiar. "Correo enviado" solo aparece si la Edge Function
respondio 200. La ruta `/auth/invitacion/<token>` en demo lleva a una pagina
que explica que ahi nadie puede aceptar (no hay cuentas reales).

## Configurar Supabase para que el correo salga de verdad

Nada de esto es codigo; sin ello la pantalla dira, correctamente, que el
correo no salio.

1. **SMTP propio** (Auth → SMTP Settings): el correo de fabrica de Supabase
   tiene un limite de envios por hora muy bajo y en proyectos nuevos solo
   entrega a miembros del equipo del proyecto. Cargar host, puerto,
   usuario, clave y remitente (Resend, SES, Postmark...). Subir el limite en
   Auth → Rate Limits.
2. **Plantilla "Invite user"** (Auth → Email Templates). El enlace tiene que
   volver al servidor con `token_hash` para que `/auth/invitacion/<token>`
   abra la sesion con `verifyOtp` (la plantilla de fabrica usa un flujo con
   el token en el `#fragmento`, que el servidor no ve):

   ```html
   <h2>Te invitaron a REGB ERP</h2>
   <p>Hola {{ .Data.display_name }}, te dieron acceso al equipo.</p>
   <p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Aceptar la invitacion</a></p>
   <p>El enlace sirve una sola vez y vence en 7 dias.</p>
   ```

   En local, el equivalente en `supabase/config.toml` (no lo toca esta
   entrega):
   `[auth.email.template.invite]` con `subject` y `content_path`.
3. **URLs** (Auth → URL Configuration): *Site URL* con el dominio real y, en
   *Redirect URLs*, `https://<dominio>/auth/invitacion/**`. En local,
   agregar `http://localhost:3000/auth/invitacion/**` a
   `additional_redirect_urls`. Sin esto Supabase ignora `redirectTo` y manda
   al Site URL, y el token de la invitacion se pierde.
4. **Edge Function**: `supabase functions deploy invitar-usuario` (con
   `verify_jwt` activo, que es el valor por defecto) y
   `supabase secrets set REGB_SITE_URL=https://<dominio>`. `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` y la llave de servicio las inyecta Supabase; la
   llave de servicio **no** va en ningun `.env` de `apps/`.
5. **Hook de token** activo (ya requerido por [`auth`](auth.md)): sin el,
   aceptar crea la membresia pero el token nunca trae el cliente.

Con `supabase start`, los correos caen en Inbucket (`localhost:54324`).

## Desactivar, nunca borrar

"Desactivar" pone `is_active = false`. No hay boton de borrar: lo que esa
persona hizo sigue en la bitacora con su nombre. Nadie puede desactivarse a
si mismo (la accion lo rechaza), para que un administrador no se deje fuera
por error.

## El rol, las sucursales y las empresas son siempre del mismo cliente

Resuelto en [`0121_referencias_del_mismo_cliente.sql`](../../supabase/migrations/0121_referencias_del_mismo_cliente.sql).
Antes, `memberships.role_id` era una FK a `roles` sin guarda de cliente: una
FK se comprueba sin RLS, asi que un usuario de A podia asignarse, por
insert o por update de su propia membresia, un rol de B. No era cosmetico:
el hook (0008) mete ese `role_id` en el JWT, `rls.has_perm()` (0109) devolvia
`true` cuando el rol del token no era del tenant, y `bootstrap()` leia el rol
por id sin filtrar tenant, asi que la app le aplicaba los permisos de B (las
dos cosas, corregidas en 0127).

Ahora el trigger `no_rol_ajeno` (`impedir_rol_ajeno()`) rechaza con 42501
"Ese rol no pertenece a ese cliente." en `insert` y en `update`, venga de
la pantalla, de PostgREST o de una funcion `security definer`. Revisa
tambien los arreglos `branch_ids` y `company_ids`, que viajan en el token
como alcance. Un id inexistente recibe el mismo rechazo que uno ajeno, para
que la guarda no sirva de oraculo. Prueba:
[`fk-guardas.test.ts`](../../supabase/tests/fk-guardas.test.ts), como
`authenticated` bajo RLS; en rojo sin la migracion.

La migracion no revisa filas anteriores a ella. Para mirarlo en una base
que ya tenia datos:

```sql
select m.tenant_id, m.user_id, m.role_id
from public.memberships m
join public.roles r on r.id = m.role_id
where r.tenant_id <> m.tenant_id;
```

La red de `fk-guardas.test.ts` hace lo mismo para toda FK entre tablas con
`tenant_id` del esquema.

## Nadie se sube el rol dentro de su propio cliente

Resuelto en [`0127_nadie_se_sube_el_rol.sql`](../../supabase/migrations/0127_nadie_se_sube_el_rol.sql).
Hasta ahi la RLS de `memberships` y `roles` era solo
`tenant_id = rls.tenant_id()` para todo. Por la pantalla no se notaba, pero
por PostgREST -la puerta del movil- un Cajero con su JWT de verdad podia
darse `"*": true` en su propio rol, pasar su membresia a Owner, o crear un
rol con todo y asignarselo. Verificado contra la base y reproducido en
[`escalada-rol.test.ts`](../../supabase/tests/escalada-rol.test.ts)
(21 de 26 en rojo sin la migracion).

| Regla | Donde | Error |
|---|---|---|
| Escribir membresias pide `users.create`/`users.edit`/`users.delete`; roles, `rbac.role.create`/`edit`/`delete` (los mismos ids que exigen las acciones) | Politicas de insert/update (`WITH CHECK`) y, para borrar, el trigger | 42501 |
| Nadie cambia el rol, sucursales, empresas o dueño de SU membresia, ni se da de alta | `no_escalar_membresia` | 42501 "Tu propio acceso no lo cambias tu" |
| Nadie cambia permisos, modulos o alcance del rol que tiene asignado | `no_escalar_rol` | 42501 |
| Una membresia Owner (dar, quitar, desactivar, borrar) y una invitacion como Owner solo las toca un Owner | `no_escalar_membresia`, `no_invitar_como_owner` | 42501 "Solo un Owner..." |
| El rol Owner de sistema no se recorta, no se renombra, no se borra | `no_escalar_rol` | 42501 "llave maestra" |
| Siempre queda al menos un Owner activo (con candado por cliente) | `no_escalar_membresia` | 42501 "sin ningun Owner" |
| `rls.has_perm()` con un rol que no es del cliente devuelve **false** (antes, true) | `rls.has_perm` | — |

El Owner sigue administrando todo lo demas: crea, ajusta y borra roles,
cambia el rol de otros, nombra y degrada a otros Owners mientras quede uno.
Su propio rol se lo cambia otro Owner.

Las reglas sobre "lo propio" y el Owner aplican en una sesion de miembro
sobre su cliente. No aplican sin claims (migraciones, siembra, limpieza de
pruebas) ni a `aceptar_invitacion()`, donde la persona aun no tiene cliente
en su token; la invitacion ya paso por la regla del Owner al crearse.

**La web ya lleva el rol.** `asUser()` fijaba solo `sub` y `tenant_id`: sin
`role_id`, `has_perm` respondia true y ninguna politica que mira el permiso
aplicaba en la web, solo por PostgREST. Ahora pone el `role_id` de la
membresia activa y aceptada de esa persona en ese cliente, igual que el
hook ([`as-user.accion.test.ts`](../../apps/web/src/lib/as-user.accion.test.ts)).
Y `bootstrap()` busca el rol del token dentro del tenant.

Para buscar en una base con datos si alguien se amplio el rol antes de
0127 (roles con `*` que no son de sistema, o de sistema distintos a su
plantilla), revisar a mano:

```sql
select r.tenant_id, r.name, r.permissions
from public.roles r
where r.permissions ? '*' and not (r.is_system and r.name in ('Owner', 'Admin'));
```

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/usuarios` | `users.view` | Lista con rol y estado; cambiar rol; desactivar/reactivar; invitaciones pendientes (reenviar, revocar); invitar |
| `/auth/invitacion/<token>` | publica | Canjea el enlace del correo por sesion y acepta la invitacion |
| `/auth/invitacion/resultado` | publica | Explica por que no se pudo aceptar (solo codigos conocidos) |

```
┌─ Usuarios ────────────────────────────────────────────────────────┐
│ 3 en el equipo · 2 con acceso activo · 1 invitacion pendiente     │
├───────────────┬──────────────────────┬────────────┬──────────────┤
│ Nombre        │ Correo               │ Rol        │ Estado       │
├───────────────┼──────────────────────┼────────────┼──────────────┤
│ Maria Rosario │ maria.rosario@demo.do│ [Owner v]  │ Activo       │
│ Juana Perez   │ juana@colmado.do     │ [Cajero v] │ Activo       │
│               │                      │  [Cambiar] │ [Desactivar] │
│ Pedro Almonte │ pedro@colmado.do     │ [Almac. v] │ Activo       │
└───────────────┴──────────────────────┴────────────┴──────────────┘
┌ Invitaciones pendientes ──────────────────────────────────────────┐
│ Ana Reyes           ● Sin enviar por correo   (Reenviar) (Revocar)│
│ ana@colmado.do · Cajero   Vence el 30 sep 2026                    │
└───────────────────────────────────────────────────────────────────┘
┌ Invitar a alguien ────────────────────────────────────────────────┐
│ Nombre [Juana Perez] Correo [juana@tuempresa.do] Rol [v] (Invitar)│
│ ⓘ Modo demostracion: no se envia ningun correo...                 │
│ ┌ ✉ Correo NO enviado ───────────────────────────────────────────┐│
│ │ Copia el enlace y compartelo tu con juana@tuempresa.do.        ││
│ │ [http://.../auth/invitacion/3f9a...]         (Copiar enlace)   ││
│ └────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

El resultado de invitar y de reenviar se pinta en la misma tarjeta
(`useActionState`) y recibe el foco, porque el enlace existe una sola vez:
no puede ir por la cookie de aviso. Estado siempre con icono + texto, no
solo color.

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `users.view` | Abre `/usuarios` |
| `users.create` | Invitar, reenviar y revocar invitaciones. Lo mira la app (`exigir`) **y** la base (`rls.has_perm` en las funciones de 0123) |
| `users.edit` | Cambiar rol, desactivar y reactivar |
| `users.delete`, `users.export` | Declarados; ninguna accion los usa |

Los **roles** en si (que permisos tiene cada uno) se editan en `/roles`, que
no pertenece a este manifiesto. El tour `core.permisos` cuelga de `users`
porque `rbac` no es un modulo del registry.

## Eventos

Solo ids en el payload: un evento puede salir a un webhook de terceros
(`api-webhooks`), asi que ni correos ni tokens.

| Evento | Quien lo emite | Payload |
|---|---|---|
| `users.member.invited` | `crear_invitacion()` (0123), via `emit_event()` | `invitation_id`, `role_id` |
| `users.member.joined` | `aceptar_invitacion()` (0123), insert directo al outbox: quien acepta aun no tiene cliente en el JWT y `emit_event()` lo toma de ahi | `invitation_id`, `membership_id`, `user_id`, `role_id` |
| `users.member.deactivated` | `alternarActivo()` en `/usuarios`, via `emit_event()`, solo al desactivar | `membership_id`, `user_id`, `deactivated_by` |

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ `audit:manifests` en verde (23 sep). Su `requires` no coincide con el del catalogo |
| 2 | Migraciones + RLS probadas | ⚠️ parcial. `isolation.test.ts`: A no ve las membresias de B. Invitaciones: `invitaciones.test.ts` (34 casos: token por hash, B no ve ni revoca ni reenvia las de A, sin escritura directa, rol ajeno, modulo apagado, Cajero sin permiso, aceptar crea la membresia con el `sub` real, otro correo, vencida, revocada, doble aceptacion, otro cliente, reenviar invalida el enlace viejo; mutantes comprobados en rojo) y los 3 de `auth-hook.test.ts`, ya sobre `crear_invitacion()`. `escalada-rol.test.ts` (0127, 26 casos): un Cajero con su JWT no se sube a Owner, no se da `*`, no crea ni se asigna un rol con `*`, no toca a otros; con permiso nadie toca lo propio; el Owner lo toca un Owner y siempre queda uno; `has_perm` falla cerrado. `as-user.accion.test.ts`: la web lleva el `role_id` real. `fk-guardas.test.ts` (0121): la membresia no apunta a un rol, sucursal o empresa de otro cliente, ni por insert ni por update, escriba quien escriba |
| 3 | Logica pura con cobertura | ➖ no tiene |
| 4 | UI web responsive | ⚠️ la seccion de invitaciones usa lista con `flex-wrap` y tokens de ambos temas, pero no se abrio en un navegador en esta entrega |
| 5 | UI movil | ⚠️ `mobileScope` declarado; la app movil no tiene pantalla de usuarios |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `core.permisos` tiene 4 pasos; `core.bienvenida` (modulo `tour`) le dedica uno mas |
| 8 | Datos demo | ✅ Maria Rosario, Owner en los dos tenants demo |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ✅ los tres declarados se emiten (arriba); `eventos-declarados.test.ts` en verde |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ⚠️ `/usuarios` paso la sonda de F4 antes de 0123. Lo nuevo va con etiquetas visibles, foco visible, el resultado recibe el foco y se anuncia (`role=status`/`alert`), estado con icono + texto y botones de 44px; no se ha vuelto a medir con la sonda |

## Lo que NO hace

- **Probar el envio real de extremo a extremo.** El flujo con Supabase
  (Edge Function, plantilla, `verifyOtp`, `refreshSession`) esta escrito
  pero nunca se ha corrido contra un proyecto real: no hay credenciales. Lo
  probado es la base (34 casos) y la accion en modo demostracion y con la
  respuesta de la Edge Function simulada (15 casos,
  `usuarios.accion.test.ts`).
- **Reenviar el correo a quien ya tiene cuenta.** `inviteUserByEmail` no
  invita dos veces; la pantalla lo dice ("ya tiene cuenta") y da el enlace
  para compartirlo a mano.
- **Impedir dar a OTRO lo que uno no tiene.** 0127 cierra lo propio y el
  Owner, pero no compara conjuntos de permisos: un Admin, o un Gerente de
  Sucursal (su rol trae `*.create`/`*.edit`), puede crear un rol con `*` y
  asignarselo a otra cuenta del mismo cliente, o invitarla con el. El
  principio de §10 ("ningun rol otorga lo que no tiene") necesita comparar
  permisos con comodines y denegaciones; queda como deuda.
- **Avatar, idioma, zona horaria, preferencias por usuario.** Estan en §5.1 y
  en el catalogo; no existen.
- **Asignar sucursales o empresas a una persona.** `branch_ids` y
  `company_ids` existen en la membresia y viajan en el token, pero esta
  pantalla no los edita. Si alguien los escribe por otra via, 0121 exige
  que cada id sea del mismo cliente.

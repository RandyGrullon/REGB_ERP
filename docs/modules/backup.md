# `backup` — Respaldos

**Que resuelve:** una copia **completa** de los datos del cliente en JSON,
descargable, que dice en sus primeras lineas que trae y que no, y un aviso
honesto de **cuanto perderia hoy** si la base desapareciera.

**Categoria:** `core` (§5.1 #15) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✖️

---

> **Hallazgo resuelto (0122, 23 sept 2026).** El respaldo traia seis tablas
> maestras —empresas, sucursales, roles, equipo, productos, configuracion—
> y ni una venta, mientras el aviso decia "eso es lo que perderias: mas de
> una semana de ventas, compras y cobros". Ahora trae **toda tabla de
> `public` con `tenant_id`** que el rol vea completa: ventas del POS,
> pedidos, facturas, cobros, inventario y kardex, compras, contabilidad,
> clientes, proveedores, productos, nomina... Lo que queda fuera queda
> fuera por nombre y con motivo, en el archivo y en la pantalla.

## Como se decide que tablas entran

Nada esta escrito a mano. `public.respaldo_tablas()`
([`0122_respaldo_completo.sql`](../../supabase/migrations/0122_respaldo_completo.sql))
lo deriva del catalogo cada vez:

1. **Candidatas:** toda tabla de `public` con columna `tenant_id`. Un
   modulo nuevo entra solo, el dia que existe su tabla.
2. **Modulo de cada una:** se lee de sus politicas — `module_active('x')`
   de cada politica permisiva que deja leer, sin la del proveedor. Varias
   se suman con OR, como en la RLS (`customers` es de ar, pos o
   sales-orders). Cinco tablas de plataforma no dicen modulo en su politica
   y se mapean a mano: `companies`→orgs, `branches`→branches,
   `roles`/`memberships`→users, `tour_progress`→tour.
3. **Entra** si alguno de sus modulos esta activo **y** el rol lo ve
   completo. Si no, va a `fuera` con motivo:

| Motivo | Cuando | Que dice el archivo |
|---|---|---|
| `por-diseno` | `backups`, `backup_parts`, `event_outbox` | Los respaldos mismos (cada uno cargaria con todos los anteriores) y la cola interna de eventos |
| `modulo-apagado` | El cliente tiene el modulo pero apagado | Sus datos siguen en la base pero no salen hasta que lo encienda |
| `sin-permiso` | Modulo activo que el rol no ve completo | Que lo cree alguien que si lo ve |
| `no-contratado` | Modulo que el cliente nunca tuvo | Solo se cuenta |
| `sin-modulo` | Tabla cuyo modulo no se pudo leer | No deberia pasar nunca: la prueba lo impide |

4. **Tablas personales** (`personales` en el indice): las que TODAS sus
   politicas filtran por `user_id = rls.regb_uid()` —`notifications`,
   `notification_reads` desde 0125—. Entran, pero solo con lo de quien
   creo el respaldo, y el archivo lo dice.

5. **Columnas que no salen nunca** (`omitido`), de
   `public.respaldo_columnas_omitidas()`:
   - Credenciales vivas: `webhook_endpoints.secret`, `api_keys.key_hash`,
     `portal_invites.token`. Un respaldo se guarda en una USB o un correo;
     si se pierde con un token dentro, alguien **entra**.
   - Las que la bitacora ya declara secretas (argumentos de
     `audit.record()`): `ecf_config.endpoint_token`,
     `user_invitations.token_hash`. Quien marca una columna secreta para la
     bitacora la esconde tambien del respaldo.
   - Las que el usuario no puede leer por permiso de columna:
     `stock_levels.avg_cost` (0109). No se pierde: `stock_levels` es la
     proyeccion del kardex, que viene completo.

## Por que el ROL tambien filtra, si ya hay RLS

La RLS del camino web separa **clientes**, no **roles**: `asUser()` no pone
`role_id` en los claims y `rls.has_perm()` devuelve true. Con seis tablas
daba igual; con el negocio entero, cualquiera con `backup.create` se
llevaba la nomina aunque su rol no la viera.

[`apps/web/src/app/respaldos/alcance.ts`](../../apps/web/src/app/respaldos/alcance.ts)
decide los modulos antes de llamar a la base:

- Entra un modulo si el rol tiene `<modulo>.view` **y** no tiene negada
  ninguna vista dentro de el (`inventory.cost.view: false` = no ve costos,
  y el respaldo los traeria).
- Un rol con alcance acotado (`own_only`, sucursales o empresas) **no saca
  respaldos**: el alcance lo aplica cada pantalla, no la base, y un
  respaldo es la empresa entera.
- Lo mismo al **bajarlo**: quien no ve completo un modulo que el archivo
  trae recibe un 403 con el nombre del modulo, aunque otro lo haya creado.

## Como se arma y se guarda

`crearRespaldo()` ([`actions.ts`](../../apps/web/src/app/respaldos/actions.ts))
llama a `public.crear_respaldo(p_modulos)` dentro de `asUser()`. Todo es
`security invoker`: la RLS de quien lo pide aplica en cada tabla, y cada
consulta repite `tenant_id = rls.tenant_id()` para que la politica del
proveedor que impersona no cuele a otro cliente.

- **Por partes.** Las filas van a `backup_parts`, en trozos de 1.000 filas
  por tabla. Un solo jsonb con el negocio de un cliente grande revienta el
  limite de jsonb (~255 MB) y obliga a tenerlo entero en memoria.
- **Una sola foto.** Todas las partes se escriben en UNA sentencia; como
  `respaldo_tabla()` es STABLE, usa la foto de esa sentencia. Las ventas y
  sus lineas salen del mismo instante.
- **Llave compuesta** `(tenant_id, backup_id)` hacia `backups`: un cliente
  no puede colgar una parte suya del respaldo de otro.
- **El indice** va en `backups.payload` (`formato = 2`): tablas y filas,
  modulos, `fuera`, `personales`, `omitido`, `no_incluye` (adjuntos,
  bitacora, suscripcion con REGB). Es tambien la cabecera del archivo.
- Tiempo medido: ~1 s para ~190 tablas en la demo (≈5 ms por tabla). Es
  una accion manual, no una lectura de pantalla.

Los respaldos de antes de 0122 quedan con `formato = 1`: se descargan como
estaban, la tabla los marca **"Parcial: sin ventas"** y el aviso ya no los
cuenta como proteccion.

## El archivo

```json
{
  "formato": "regb-respaldo", "version": 2, "exportado_en": "…",
  "filas": 297, "modulos": ["accounting", "ar", "pos", …],
  "tablas": { "customer_invoices": 3, "journal_entries": 2, … },
  "fuera": [ { "tabla": "event_outbox", "motivo": "por-diseno", "detalle": "…" }, … ],
  "personales": ["notification_reads", "notifications"],
  "omitido": [ { "tabla": "webhook_endpoints", "columna": "secret", "motivo": "…" }, … ],
  "no_incluye": [ "Los archivos adjuntos …", "La bitacora …", "Tu suscripcion …" ],
  "datos": { "customer_invoices": [ {…}, … ], … }
}
```

La descarga ([`[id]/descargar/route.ts`](../../apps/web/src/app/respaldos/[id]/descargar/route.ts))
va por flujo: pide las partes en lotes de ~8 MB y las junta en un arreglo
por tabla. Antes de mandar un byte comprueba que las partes suman lo que
dice el indice. Marca `downloaded_at` y emite el evento **solo despues del
ultimo trozo**: un archivo cortado a la mitad no salio de aqui.

## El estado se mide sobre el ultimo COMPLETO que SALIO

Un respaldo que vive en la misma base que respalda se pierde junto con ella,
y uno del formato viejo no trae las ventas. `datosDeRespaldos()` y
`estadoDeRespaldos()` ([`packages/operations/src/respaldos.ts`](../../packages/operations/src/respaldos.ts))
solo cuentan los completos:

| Nivel | Cuando | Tono |
|---|---|---|
| `sin-respaldo` | No hay ninguno | peligro |
| `solo-parciales` | Solo hay del formato viejo | peligro — "Tus respaldos no traen tus ventas" |
| `nunca-salio` | Hay completos, pero ninguno se descargo | peligro |
| `muy-viejo` | El ultimo completo que salio tiene ≥ 7 dias | peligro |
| `viejo` | ≥ 3 dias | aviso |
| `al-dia` | Menos de 3 dias | exito |

Los umbrales son fijos a proposito: un umbral configurable acaba puesto en el
valor que hace desaparecer el aviso.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/respaldos` | `backup.view` | Aviso de estado, **"Que trae"** (del mismo respaldo que mide el aviso, leido de su indice), lista de los ultimos 50 con su contenido, crear uno |
| `/respaldos/:id/descargar` | `backup.export` + ver completos los modulos del archivo | Descarga el JSON y marca que salio |

"Que trae" no se redacta aparte: se pinta del indice del respaldo, el
mismo texto que va arriba del archivo. Si no hay ningun respaldo completo,
dice que traeria uno nuevo segun el rol.

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `backup.view` | Abre `/respaldos` |
| `backup.create` | Boton "Crear respaldo ahora" y su accion |
| `backup.export` | Descargar el JSON |
| `backup.edit`, `backup.delete` | Declarados; ninguna accion los usa |

## Eventos

| Evento | Quien lo emite | Payload |
|---|---|---|
| `backup.snapshot.created` | `public.crear_respaldo()`, en la misma transaccion | `{ backup_id, kind, tablas, filas, size_bytes }` |
| `backup.snapshot.downloaded` | La ruta de descarga, la **primera** vez que el archivo sale completo | `{ backup_id, formato }` |

Solo numeros e ids, nunca datos: el outbox lo leen automatizaciones y
webhooks que salen a terceros. No escucha ninguno.

## Como se prueba

| Prueba | Que fija |
|---|---|
| [`apps/web/src/app/respaldos/respaldos.accion.test.ts`](../../apps/web/src/app/respaldos/respaldos.accion.test.ts) | La accion y la **ruta de descarga reales** con dos clientes sembrados: el archivo trae la venta del POS, el pedido, la factura, la orden de compra, el movimiento de inventario, las existencias y el asiento con su linea; no trae ni una fila ni el id del otro cliente; el indice coincide con `datos`; el secreto del webhook no esta; los dos eventos salen una vez; el otro cliente recibe 404; inventario apagado → `modulo-apagado`; rol sin nomina o sin contabilidad → `sin-permiso`; rol `own_only` no crea; quien no ve contabilidad no baja (403); cinco productos en partes de dos se arman en un solo arreglo |
| [`supabase/tests/backup.test.ts`](../../supabase/tests/backup.test.ts) | La derivacion: toda tabla con `tenant_id` esta en la lista; ventas/facturas/inventario/asientos con su modulo; **ninguna tabla sin modulo**; **toda politica tiene una forma que el respaldo sabe leer** (una condicion nueva se vuelve ruidosa); `has_perm` solo pide `<modulo>.view`; **ninguna columna con cara de credencial sale sin decidirlo**. Y el aislamiento de `backup_parts`: B no ve, no cambia, no borra y no cuelga partes del respaldo de A; con `backup` apagado, A no ve lo suyo |
| [`packages/operations/src/respaldos.test.ts`](../../packages/operations/src/respaldos.test.ts) | Un parcial descargado ayer no pone el aviso en verde; el reloj corre desde el ultimo completo que salio |

Rojo → verde comprobado: contra el codigo de antes, 11 de 13 pruebas de la
accion en rojo (solo pasaban las de otro cliente, que ya se cumplian).
Rompiendo a proposito `respaldo_tabla()` —como dueño y sin el filtro de
tenant— se ponen en rojo "NO trae ni una fila de otro cliente" y "las
partes son SOLO del cliente que lo pidio". Quitando el `<modulo>.view` de
`alcance.ts`, "un rol que no tiene contabilidad ni la menciona tampoco se
la lleva" se pone en rojo.

```bash
DATABASE_URL=… npx vitest run --config supabase/tests/vitest.config.ts supabase/tests/backup.test.ts
cd apps/web && DATABASE_URL=… npx vitest run src/app/respaldos/respaldos.accion.test.ts
```

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ✅ con `events`; `audit:manifests` OK (80 modulos) |
| 2 | Migraciones + RLS probadas | ✅ `backup_parts` con RLS + FORCE + politica, aislamiento propio en `backup.test.ts` |
| 3 | Logica pura con cobertura | ✅ `respaldos.ts` — 12 pruebas |
| 4 | UI web responsive | ⚠️ tipos y lint limpios, pero **no vista en el navegador** en esta entrega (el servidor compartido apunta a otra base) |
| 5 | UI movil | ➖ no aplica: `platforms.mobile = false` |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f13.respaldos` tiene 4 pasos y dice "Pruebalo restaurando" |
| 8 | Datos demo | ❌ la siembra no crea respaldos: la pantalla arranca en `sin-respaldo` |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ✅ arriba |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ⚠️ solo tokens del tema (claro y oscuro), pero la pantalla nueva no se midio |

## Lo que NO hace

- **Traer los archivos adjuntos.** Trae la ficha de cada archivo (nombre,
  tipo, tamaño), no el PDF ni la foto. Lo dice el propio archivo en
  `no_incluye`.
- **Traer la bitacora ni la suscripcion con REGB.** Tambien en `no_incluye`.
- **Respaldos programados.** `kind = 'scheduled'` existe en la tabla, pero
  no hay ninguna tarea que lo cree. La pantalla ya no dice lo contrario.
- **Restaurar.** No hay importacion del JSON ni restauracion a un punto en
  el tiempo. El catalogo (0122) ya no lo promete; el tour `f13.respaldos`
  todavia dice "Pruebalo restaurando".
- **Sustituir el respaldo de la base.** `pnpm db:respaldar` es un volcado
  de la base entera por parte del proveedor (`docs/RESPALDOS.md`), no este
  modulo.

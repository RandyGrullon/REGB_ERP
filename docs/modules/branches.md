# `branches` — Sucursales

**Que resuelve:** las ubicaciones fisicas de cada empresa del cliente, y la
base sobre la que un rol se limita a "solo su sucursal".

**Categoria:** `core` (§5.1 #5) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno en el
manifiesto (el catalogo de 0009 dice `{orgs}`) · **Plataformas:** web ✔️
desktop ✔️ movil ✔️ (`mobileScope: view`)

---

## Cada sucursal cuelga de una empresa

`public.branches` ([`0003_tenant_core.sql`](../../supabase/migrations/0003_tenant_core.sql))
tiene `company_id not null`: una sucursal es un local de **un** RNC concreto.
El codigo es unico por tenant (indice parcial, ignora borradas y nulos).

La empresa tiene que ser **del mismo cliente**. Antes no lo era por
obligacion: `company_id` era una FK a `companies` sin guarda de cliente, una
FK se comprueba sin RLS, y `crearSucursal()` toma `companyId` del formulario;
un id de empresa de otro cliente enviado a mano creaba una sucursal propia
colgando de una empresa ajena. Desde
[`0121_referencias_del_mismo_cliente.sql`](../../supabase/migrations/0121_referencias_del_mismo_cliente.sql)
el trigger `no_empresa_ajena` (`impedir_empresa_ajena_sucursal()`) lo
rechaza con 42501 "Esa empresa no pertenece a ese cliente." al abrir y al
cambiar la empresa, venga de donde venga, y da el mismo rechazo para un id
que no existe (sin oraculo). La misma migracion cubre las demas FK hacia
sucursales: `warehouses.branch_id` no tenia guarda y
`attendance_geofences.branch_id` solo la tenia al insertar. Prueba:
[`fk-guardas.test.ts`](../../supabase/tests/fk-guardas.test.ts), como
`authenticated` bajo RLS; en rojo sin la migracion.

| Columna | Para que |
|---|---|
| `company_id` | La razon social a la que pertenece |
| `code` | Codigo corto (`SD`, `STI`), unico por tenant |
| `lat`, `lng`, `geofence_m` | Posicion y radio de geocerca (150 m por defecto). **Nada los lee ni los escribe**: `attendance` usa su propia tabla de geocercas |
| `timezone` | Declarada; nada la lee |
| `is_active` | Cerrar no borra: la sucursal sigue en el historial |
| `deleted_at` | Borrado logico; ninguna accion lo pone hoy |

## El alcance por sucursal viaja en el token

`memberships.branch_ids` sale en el JWT como `branches`
(ver [`auth`](auth.md)). Es lo que permite que un rol quede limitado a sus
sucursales. Esta pantalla no asigna sucursales a personas: eso vive en la
membresia.

## Por que `warehouses` no es `branches`

El inventario cuenta por almacen, no por sucursal. La decision y su porque
estan en [inventory.md](inventory.md#por-qué-warehouses-y-no-reutilizar-branches).

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/sucursales` | `branches.view` | Lista con empresa y estado; abrir, cerrar y reabrir |

```
┌─ Sucursales ──────────────────────────────────────────────────────┐
│ 2 activas de 2. Cada rol puede limitarse a sucursales concretas.  │
├──────────────┬────────┬──────────────────────┬─────────┬─────────┤
│ Sucursal     │ Codigo │ Empresa              │ Estado  │         │
├──────────────┼────────┼──────────────────────┼─────────┼─────────┤
│ Santiago     │ STI    │ Distribuidora Caribe │ Activa  │ [Cerrar]│
│ Santo Domingo│ SD     │ Distribuidora Caribe │ Activa  │ [Cerrar]│
└──────────────┴────────┴──────────────────────┴─────────┴─────────┘
┌ Abrir sucursal ───────────────────────────────────────────────────┐
│ Nombre [Sucursal La Vega] Codigo [LV] Empresa [v] Direccion [...] │
│                                                          [Abrir]  │
└───────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `branches.view` | Abre `/sucursales` |
| `branches.create` | Abrir sucursal |
| `branches.edit` | Cerrar y reabrir |
| `branches.delete`, `branches.export` | Declarados; ninguna accion los usa |

## Eventos

| Evento | Cuando | Payload | Donde |
|---|---|---|---|
| `branches.branch.created` | Al abrir una sucursal, en la **misma transaccion** que el `insert` | `{ branchId, companyId }` | `crearSucursal()` en [`sucursales/actions.ts`](../../apps/web/src/app/sucursales/actions.ts) |

- Sin nombre ni direccion: el evento dice que paso, no copia la ficha.
- Cerrar y reabrir (`alternarSucursal()`) **no** emite: no hay tema
  declarado para eso.
- Si el evento no se puede escribir, la sucursal tampoco queda, y la
  pantalla lo dice con un aviso.
- Prueba: [`sucursales.accion.test.ts`](../../apps/web/src/app/sucursales/sucursales.accion.test.ts),
  accion real contra `event_outbox`. La vigilancia de todos los core esta
  en [`eventos-declarados.test.ts`](../../apps/web/src/lib/eventos-declarados.test.ts).

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega. Su `requires` no coincide con el del catalogo |
| 2 | Migraciones + RLS probadas | ✅ `isolation.test.ts` prueba que A no ve las sucursales de B. `fk-guardas.test.ts` (0121): una sucursal de A no apunta a una empresa de B ni por insert ni por update, un id inexistente recibe el mismo rechazo, y un almacen de A no cuelga de una sucursal de B |
| 3 | Logica pura con cobertura | ➖ no tiene |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ⚠️ `mobileScope: view` declarado; la app movil no tiene pantalla de sucursales |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f14.sucursales` tiene 4 pasos |
| 8 | Datos demo | ✅ Villa Consuelo (colmado) y Santo Domingo + Santiago (distribuidora) |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ✅ `branches.branch.created` se emite desde `crearSucursal()`; prueba de accion real contra el outbox |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/sucursales` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Jerarquia de sucursales, horarios y geocerca editable.** §5.1 y el
  catalogo los prometen. Las columnas de geocerca existen en la tabla, pero
  ninguna pantalla ni modulo las usa.
- **Editar una sucursal ya creada.** Solo se abre, se cierra y se reabre;
  nombre, codigo y direccion no se cambian desde la aplicacion.
- **Borrar.** A proposito: una sucursal con historial no desaparece.

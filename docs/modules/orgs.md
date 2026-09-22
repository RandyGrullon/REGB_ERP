# `orgs` — Empresas

**Que resuelve:** varias razones sociales (varios RNC) bajo la misma cuenta.
Quien tiene un colmado y una distribuidora con RNC distintos no necesita dos
contratos con REGB.

**Categoria:** `core` (§5.1 #4) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✔️ en el manifiesto (`mobileScope:
view`); el catalogo de 0009 dice movil ✖️

---

## Una empresa es un RNC, un tenant es un cliente de REGB

`public.companies` ([`0003_tenant_core.sql`](../../supabase/migrations/0003_tenant_core.sql))
vive dentro de un tenant. El aislamiento fuerte (RLS) es **por tenant**; entre
empresas del mismo tenant la separacion la hace cada modulo con su propio
`company_id`, no la RLS.

| Columna | Para que |
|---|---|
| `legal_name`, `trade_name` | Razon social y nombre comercial |
| `tax_id` | RNC. Texto libre en esta pantalla |
| `currency` | Moneda funcional (`DOP` por defecto; la pantalla ofrece DOP, USD, EUR) |
| `is_default` | La principal. Indice unico parcial: **una sola** por tenant |
| `deleted_at` | Borrado logico; ninguna accion lo pone hoy |

## Marcar la principal en dos pasos, en una transaccion

`marcarPrincipal()` pone todas en `false` y despues la elegida en `true`,
dentro del mismo `asUser()`. Hacerlo al reves violaria el indice unico en el
primer `update`.

## La moneda de una empresa que consolida no se cambia por detras

`consolidation` no traduce moneda. Una empresa en DOP que pasara a USD dentro
de un grupo que presenta en DOP haria que la siguiente corrida sumara sus
dolares como pesos. `0119_moneda_de_empresa_en_grupo.sql` agrega un trigger
`before update of currency` que lo rechaza si la empresa esta en un grupo de
otra moneda o ya figura en un consolidado cerrado (entrega en curso al
escribir esta ficha; `ESTADO.md` todavia la lista como deuda). Ver
[consolidation.md](consolidation.md).

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/empresas` | `orgs.view` | Lista con moneda y numero de sucursales; editar razon social y RNC; marcar principal; agregar |

```
┌─ Empresas ────────────────────────────────────────────────────────┐
│ Cada razon social (RNC) factura por separado.                     │
│ ┌Empresas┐ ┌Sucursales┐ ┌Tu plan──────────┐                       │
│ │   1    │ │    2     │ │ MEDIANO         │                       │
│ └────────┘ └──────────┘ │ incluye 3 empr. │                       │
│                         └─────────────────┘                       │
├──────────────────────────────────────┬────────┬──────┬───────────┤
│ Razon social y RNC                   │ Moneda │ Suc. │ Principal │
├──────────────────────────────────────┼────────┼──────┼───────────┤
│ [Distribuidora Caribe SRL][131-45678-2][💾] │ DOP │ 2 │[Principal]│
└──────────────────────────────────────┴────────┴──────┴───────────┘
┌ Agregar empresa ──────────────────────────────────────────────────┐
│ Razon social [Mi Segunda Empresa SRL] RNC [1-31-12345-6] [DOP v]  │
│                                                      [Agregar]    │
└───────────────────────────────────────────────────────────────────┘
```

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `orgs.view` | Abre `/empresas` |
| `orgs.create` | Agregar empresa |
| `orgs.edit` | Editar razon social y RNC; marcar principal |
| `orgs.delete`, `orgs.export` | Declarados; ninguna accion los usa |

## Eventos

| Evento | Estado |
|---|---|
| `orgs.company.created` | Declarado; **ningun codigo lo emite** |

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ✅ `isolation.test.ts` usa `companies` como tabla de prueba: A no ve, no modifica, no borra ni inserta a nombre de B; JWT sin tenant no ve nada; tenant falsificado solo alcanza a ese tenant; impersonacion de solo lectura |
| 3 | Logica pura con cobertura | ➖ no tiene |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ⚠️ `mobileScope` declarado; la app movil no tiene pantalla de empresas |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ `f14.empresas` tiene 4 pasos; `core.bienvenida` (modulo `tour`) abre con uno mas |
| 8 | Datos demo | ✅ Colmado La Esperanza SRL (RNC 130-11111-1) y Distribuidora Caribe SRL (131-45678-2) |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ⚠️ documentado aqui que el evento declarado no se emite |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/empresas` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Hacer cumplir el limite del plan.** La pantalla dice "PYME incluye 1
  empresa, MEDIANO 3, GRANDE ilimitadas", pero `crearEmpresa()` no cuenta
  nada: un tenant PYME agrega las que quiera. Tampoco se cobra la adicional.
- **Validar el RNC.** Se guarda el texto tal cual; ni formato ni digito
  verificador. El tour `core.bienvenida` avisa que el RNC sale en cada
  factura, asi que un error aqui se imprime en todas.
- **Heredar configuracion.** La pantalla dice "la configuracion se hereda de
  la principal". No hay herencia: `tenant_settings` es una sola fila por
  tenant, igual para todas las empresas (ver [`settings`](settings.md)).
- **Cambiar de empresa desde el menu.** El tour `f14.empresas` dice "la barra
  de la izquierda cambia de empresa sin cerrar sesion"; el selector del Shell
  cambia de **tenant** en modo demostracion, no de empresa.
- **Direccion, telefono, correo, logo.** Existen como columnas; esta pantalla
  no los muestra ni los edita.
- **Cambiar la moneda desde la pantalla.** Solo se elige al crear.

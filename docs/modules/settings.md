# `settings` — Configuracion

**Que resuelve:** las preferencias que el cliente decide solo: nombre
comercial, zona horaria, moneda y formato de fecha.

**Categoria:** `core` (§5.1 #10) · **Precio:** 0/0/0 instalacion · 0/0/0 mes
(derivado de `category = 'core'` en 0009) · **Requiere:** ninguno ·
**Plataformas:** web ✔️ desktop ✔️ movil ✖️

---

> **Dicho primero:** esta pantalla guarda, pero **nada del resto del ERP lee
> lo que guarda**. Ver "Lo que NO hace".

## Del proveedor o del cliente

`regb.tenants` es del proveedor: tier, estado, facturacion. Lo que el cliente
decide vive aparte, en `public.tenant_settings`
([`0016_core_platform.sql`](../../supabase/migrations/0016_core_platform.sql)),
una fila por tenant con valores por defecto dominicanos:

| Columna | Por defecto |
|---|---|
| `trade_name` | nulo |
| `timezone` | `America/Santo_Domingo` |
| `currency` | `DOP` |
| `locale` | `es-DO` |
| `date_format` | `DD/MM/YYYY` |
| `prefs` | `{}` |

## Lista cerrada en el servidor

`guardarConfiguracion()` valida contra conjuntos fijos, no contra lo que
venga del `<select>`: cinco zonas horarias, tres monedas (DOP, USD, EUR),
tres formatos de fecha. Un valor fuera de la lista se rechaza con su
motivo. Guarda con `insert … on conflict (tenant_id) do update`, asi que
funciona aunque la fila no exista todavia.

## Pantallas

| Ruta | Permiso | Que hace |
|---|---|---|
| `/configuracion` | `settings.view` | Formulario de identidad y regional; enlace al marketplace |

```
┌─ Configuracion ───────────────────────────────────────────────────┐
│ Preferencias de Colmado La Esperanza.                             │
│ ┌ Identidad y regional ─────────────────────────────────────────┐ │
│ │ Nombre comercial [La Esperanza                        ]       │ │
│ │ Zona horaria [Santo Domingo v] Moneda [DOP v] Fecha [31/12/..]│ │
│ │ [Guardar cambios]                                             │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ ┌ Plan y modulos ───────────────────────────────────────────────┐ │
│ │ Estas en el plan PYME con 18 modulos activos. Marketplace ... │ │
│ └───────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

Sin `settings.edit`, los campos salen deshabilitados y la pantalla lo dice
con el nombre del rol.

## Permisos que expone

| Permiso | Uso real |
|---|---|
| `settings.view` | Abre `/configuracion` |
| `settings.edit` | Guardar |
| `settings.branding.edit` | Declarado; no hay pantalla de marca |

## Eventos

| Evento | Estado |
|---|---|
| `settings.prefs.changed` | Declarado; **ningun codigo lo emite** |

## Definicion de Terminado

| # | Punto | Estado |
|---|---|---|
| 1 | `manifest.ts` completo | ⚠️ declarado; `audit:manifests` no se corrio en esta entrega |
| 2 | Migraciones + RLS probadas | ⚠️ solo la red de `isolation.test.ts` (RLS `enable` + `force` + politica). Sin prueba propia |
| 3 | Logica pura con cobertura | ➖ no tiene |
| 4 | UI web responsive | ⚠️ no verificado en esta entrega |
| 5 | UI movil | ➖ no aplica: `platforms.mobile = false` |
| 6 | Desktop verificado | ⚠️ no verificado |
| 7 | Tour ≥6 pasos | ❌ el unico tour con `moduleId: 'settings'` es `core.marketplace` (4 pasos), y habla del marketplace, no de esta pantalla |
| 8 | Datos demo | ✅ "La Esperanza" y "Caribe", en DOP |
| 9 | ≥2 widgets | ❌ ninguno |
| 10 | Eventos documentados | ⚠️ documentado aqui que el evento declarado no se emite |
| 11 | Precio en 3 tiers | ✅ 0/0/0 |
| 12 | E2E en 3 plataformas | ⚠️ no verificado |
| 13 | Ficha | ✅ este archivo |
| 14 | Accesibilidad AA | ✅ `/configuracion` en la sonda de F4, tercera pasada sin fallos |

## Lo que NO hace

- **Cambiar nada fuera de su propia pantalla.** `tenant_settings` solo se lee
  en `/configuracion`, en el respaldo y en el panel de datos de REGB Control.
  Las fechas se siguen formateando con `es-DO` fijo en cada pagina, la zona
  horaria de RD esta cableada donde importa (ver `horaEsperadaEnRD()` en
  `attendance`), y la moneda de cada documento sale de la empresa o del
  modulo, no de aqui. La pantalla dice "aplican a todas tus empresas y
  usuarios"; hoy no aplican a nada.
- **Moneda por empresa.** La moneda funcional real vive en
  `companies.currency` (ver [`orgs`](orgs.md)); esta es otra, a nivel de
  tenant, que nadie consulta. Dos sitios para lo mismo.
- **Herencia por empresa, sucursal y usuario.** §5.1 y el catalogo la
  prometen; es una sola fila por tenant.
- **Marca (logo, colores).** `settings.branding.edit` existe como permiso sin
  pantalla.
- **Auditar los cambios.** `tenant_settings` no tiene trigger `audit_me`.

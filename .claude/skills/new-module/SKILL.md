---
name: new-module
description: Crea un módulo completo de REGB ERP desde cero — manifest, migraciones SQL con RLS, lógica en core, UI web, UI móvil, tour de tutorial, seed demo, tests y registro en el catálogo de precios. Úsalo cuando el usuario pida agregar, crear o construir un módulo nuevo del ERP (ej. "/new-module inventory", "agrega el módulo de nómina").
---

# Crear un módulo de REGB ERP

Construyes un módulo completo y verificable. No un esqueleto: un módulo que se puede activar y vender.

## Paso 0 — Contexto

Lee siempre primero:

- `docs/PROYECTO-REGB-ERP.md` §4 (sistema de módulos) y §5 (catálogo de los 93)
- `modules/_template/` si existe

Del catálogo §5 saca: **id exacto, nombre, categoría (core/estándar/avanzado/vertical/enterprise), descripción y dependencias**. No inventes un id que no esté en el catálogo; si el usuario pide uno nuevo, añádelo primero al catálogo del documento maestro.

## Paso 1 — Precios

De §6.3, según la categoría:

| Categoría  | Instalación pyme/med/gra | Mensual pyme/med/gra |
| ---------- | ------------------------ | -------------------- |
| core       | 0 / 0 / 0                | 0 / 0 / 0            |
| estándar   | 150 / 600 / 1800         | 19 / 69 / 190        |
| avanzado   | 400 / 1500 / 4000        | 45 / 160 / 420       |
| vertical   | 600 / 2200 / 6000        | 59 / 210 / 550       |
| enterprise | — / — / 12000            | — / — / 900          |

## Paso 2 — El manifest (es el contrato, va primero)

`modules/<id>/manifest.ts` con: `id`, `name`, `description`, `icon` (lucide), `category`, `version`, `pricing` (3 tiers + perUser + metered si aplica), `requires`/`recommends`/`conflicts`, `permissions[]`, `routes[]` (cada una con su `perm`), `dashboardWidgets`, `reports`, `events` (`emits`/`listens`), `platforms`, `mobileScope`, `tour`, `onInstall`/`onUninstall`.

## Paso 3 — Base de datos

`migrations/001_init_up.sql` — toda tabla con:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `created_at/updated_at timestamptz`, `deleted_at timestamptz` (soft delete)
- Dinero `numeric(12,2)`, cantidades `numeric(14,4)`
- Índice `(tenant_id, <columna de filtro más común>)`
- Trigger de auditoría hacia `audit.log`

`migrations/001_init_down.sql` — rollback real.

`migrations/policies.sql` — por cada tabla:

```sql
alter table public.<t> enable row level security;
create policy tenant_isolation on public.<t> for all
  using      (tenant_id = auth.tenant_id() and auth.module_active('<id>'))
  with check (tenant_id = auth.tenant_id() and auth.module_active('<id>'));
```

## Paso 4 — Lógica

`core/` con esquemas Zod y funciones puras. **Cero acceso a red aquí.** Se re-exporta desde `@regb/core`.

## Paso 5 — UI

- `ui/` web: tokens Aurora (`#5865F2` blurple, superficies `#313338`/`#383A40`, filas de 40px), responsive xs→2xl, `data-tour` en los elementos que usará el tour.
- `ui-native/`: **solo** lo declarado en `mobileScope`. Pensado para el pulgar.

## Paso 6 — Tour

`tour/index.ts` con mínimo 6 pasos, ≥2 con `action: 'click'`, un `tip` de experto, español dominicano con tuteo, máximo 2 frases por paso.

## Paso 7 — Seed

`seed/demo.sql` con datos creíbles de República Dominicana: RNC reales en formato, DOP, ITBIS 18%, nombres y productos locales. Nunca "Acme" ni "John Doe".

## Paso 8 — Registro

Inserta en `regb.module_catalog` y `regb.module_pricing` (3 filas, una por tier).

## Paso 9 — Tests

- Unit de `core/` ≥80%
- Test de aislamiento: dos tenants, el A no ve nada del B
- Test de módulo desactivado: devuelve 403, no datos
- E2E del flujo principal

## Paso 10 — Cierre

Ejecuta el checklist de 14 puntos de §15.4 y reporta el resultado punto por punto. Si algo quedó pendiente, dilo explícitamente — no lo marques como terminado.

## Delegación

Para trabajo pesado en un área concreta, usa los agentes: `regb-db` (SQL/RLS), `regb-design` (Aurora), `regb-mobile` (RN), `regb-tutorial` (tour), `regb-qa` (verificación).

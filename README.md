# 🛰️ Nexus ERP

> ERP modular multi-tenant con estética Discord.
> Web · Desktop · Móvil · 92 módulos activables · Supabase

| Documento | Para qué |
|---|---|
| [docs/PROYECTO-NEXUS-ERP.md](docs/PROYECTO-NEXUS-ERP.md) | **Qué** se construye: módulos, precios, diseño, mockups |
| [docs/FASES-DE-DESARROLLO.md](docs/FASES-DE-DESARROLLO.md) | **En qué orden**: 11 fases, 84 sprints, puertas de no-avance |

---

## Arrancar

```bash
pnpm install
```

### Base de datos local

Necesitas Docker corriendo.

```bash
docker run -d --name nexus-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=nexus_test -p 55432:5432 postgres:16
```

Luego, con `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/nexus_test`:

```bash
pnpm --filter @nexus/db migrate
```

Para el entorno Supabase completo (auth, storage, realtime) usa `pnpm db:start`.

### La puerta que importa

```bash
pnpm --filter @nexus/db test
```

24 casos que verifican que **ningún tenant puede ver los datos de otro**. Si uno solo falla, no se despliega nada.

---

## Estado actual

### ✅ Fase 0 — Cimientos

| Sprint | Estado |
|---|---|
| S1 · Monorepo, CI, lint arquitectónico | ✅ |
| S2 · Supabase, esquemas, RLS, auditoría | ✅ |
| S3 · Auth, roles y membresías | 🚧 tablas y RLS listas; falta el flujo de Supabase Auth |
| S4 · Design System Aurora | 🚧 tokens listos; faltan los 12 componentes |

### 🚧 Siguiente

Fase 0 S3–S4, luego Fase 1 (registry de módulos).

---

## Estructura

```
NexusERP/
├── apps/                 web · desktop · mobile      (F2, F5)
├── packages/
│   ├── config/           ✅ tokens Aurora — fuente única
│   ├── core/             lógica de negocio            (F1)
│   ├── sdk/              acceso a datos               (F1)
│   ├── permissions/      evaluador RBAC/ABAC          (F2)
│   └── module-registry/  carga dinámica               (F1)
├── modules/              los 92 módulos               (F2+)
├── supabase/
│   ├── migrations/       ✅ 6 migraciones con RLS
│   └── tests/            ✅ 24 tests de aislamiento
├── scripts/              ✅ auditorías de la puerta
└── docs/                 ✅ documento maestro y fases
```

---

## Las reglas que el repo hace cumplir solo

Estas no son convenciones: **fallan el build**.

| Regla | Quién la aplica |
|---|---|
| `tenant_id` solo viene del JWT, nunca del request | ESLint (`no-restricted-syntax`) |
| Un módulo nunca importa otro módulo | ESLint (`no-restricted-imports`) |
| Cero lógica de negocio en `apps/` | ESLint |
| `service_role` solo en Edge Functions | `pnpm audit:secrets` |
| El core no ramifica por id de módulo | `pnpm audit:registry` |
| Ningún tenant ve datos de otro | `pnpm test:isolation` (24 casos) |
| Toda tabla tiene RLS **forzado** y política | vista `nexus.rls_coverage` + test |

```bash
pnpm gate:f0   # corre todas
```

---

## Agentes y skills

`.claude/agents/` — 12 agentes especializados (arquitecto, db, seguridad, diseño, web, desktop, móvil, facturación, tutorial, QA, docs, constructor de módulos).

`.claude/skills/` — `/new-module` · `/pricing-calc` · `/aurora-ui` · `/rls-audit` · `/tour-writer` · `/tri-platform`

---

## Grafo de conocimiento

`graphify-out/graph.html` — 537 nodos, 680 aristas. Regenerar con `graphify update`.

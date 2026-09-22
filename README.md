# 🛰️ REGB ERP

> ERP modular multi-tenant con identidad propia.
> Web · Desktop · Móvil · 93 módulos activables · Supabase

| Documento                                                  | Para qué                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| [docs/ESTADO.md](docs/ESTADO.md)                           | **Dónde estamos**: qué está hecho, qué falta y por qué       |
| [docs/PROYECTO-REGB-ERP.md](docs/PROYECTO-REGB-ERP.md)     | **Qué** se construye: módulos, precios, diseño, mockups      |
| [docs/FASES-DE-DESARROLLO.md](docs/FASES-DE-DESARROLLO.md) | **En qué orden**: 11 fases, 84 sprints, puertas de no-avance |

---

## Arrancar

```bash
pnpm install
```

### Base de datos local

Necesitas Docker corriendo.

```bash
docker run -d --name regb-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=regb_test -p 55432:5432 postgres:16
```

Luego, con `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/regb_test`:

```bash
pnpm --filter @regb/db migrate
```

Para el entorno Supabase completo (auth, storage, realtime) usa `pnpm db:start`.

### Las puertas que importan

```bash
pnpm test
```

**86 casos.** Los 24 de aislamiento verifican que **ningún tenant puede ver los datos de otro**. Si uno solo falla, no se despliega nada.

| Suite                   | Casos | Qué prueba                                                         |
| ----------------------- | ----: | ------------------------------------------------------------------ |
| `@regb/db`              |    24 | Aislamiento entre tenants, licencia de módulos, impersonación, RLS |
| `@regb/module-registry` |    26 | Puerta F1: activar un módulo es un dato, no un despliegue          |
| `@regb/permissions`     |    23 | RBAC + ABAC: la denegación siempre gana                            |
| `@regb/core`            |    13 | Dinero, redondeo bancario, contratos de sesión y eventos           |

---

## Estado actual

### ✅ Fase 0 — Cimientos

| Sprint                                  | Estado                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| S1 · Monorepo, CI, lint arquitectónico  | ✅                                                      |
| S2 · Supabase, esquemas, RLS, auditoría | ✅                                                      |
| S3 · Roles, permisos y membresías       | ✅ evaluador + tablas + RLS · 🚧 falta el flujo de auth |
| S4 · Design System Aurora               | 🚧 tokens listos; faltan los 12 componentes             |

### ✅ Fase 1 — La máquina de módulos

| Sprint                                             | Estado                                              |
| -------------------------------------------------- | --------------------------------------------------- |
| S5 · Module registry (hidratación, sidebar, rutas) | ✅                                                  |
| S6 · Contrato `manifest.ts` + ciclo de vida        | ✅                                                  |
| S7 · Bus de eventos                                | 🚧 tabla lista; falta la Edge Function despachadora |

### 🟡 Fase 2 — Core + app web (en curso)

| Sprint                                       | Estado                                                    |
| -------------------------------------------- | --------------------------------------------------------- |
| App web con layout Aurora y sidebar dinámico | ✅ verificado en navegador                                |
| Responsive xs→2xl con drawer y nav inferior  | ✅ 375 / 768 / 1440 px sin desbordar                      |
| 5 manifests de módulo reales                 | ✅ products · inventory · pos · payroll · invoice-capture |
| Los 15 módulos core                          | 🚧 solo manifests; falta la funcionalidad de cada uno     |

### 🚧 Siguiente

Flujo de Supabase Auth (F0 S3), el despachador de eventos como Edge Function
(F1 S7), y los módulos core de la Fase 2.

---

## Verlo funcionando

```bash
docker start regb-test-db && pnpm --filter @regb/web dev
```

En [localhost:3100](http://localhost:3100) puedes cambiar de **cliente**, **rol**
y **plataforma** desde la cabecera y ver cómo el sidebar se reconstruye solo.

Para comprobar que activar un módulo es un dato y no un despliegue:

```bash
docker exec regb-test-db psql -U postgres -d regb_test -c "update regb.tenant_modules set enabled=false where module_id='pos';"
```

Recarga y el POS desapareció. Vuelve a ponerlo en `true` y regresa.

---

## Estructura

```
REGB-ERP/
├── apps/                 web · desktop · mobile      (F2, F5)
├── packages/
│   ├── config/           ✅ tokens Aurora — fuente única
│   ├── core/             ✅ tipos, Zod, dinero
│   ├── permissions/      ✅ evaluador RBAC/ABAC
│   ├── module-registry/  ✅ contrato + carga dinámica
│   ├── sdk/              acceso a datos               (F2)
│   └── ui/               componentes Aurora           (F0 S4)
├── modules/              los 93 módulos               (F2+)
├── supabase/
│   ├── migrations/       ✅ 6 migraciones con RLS
│   └── tests/            ✅ 24 tests de aislamiento
├── scripts/              ✅ auditorías de la puerta
└── docs/                 ✅ documento maestro y fases
```

---

## Las reglas que el repo hace cumplir solo

Estas no son convenciones: **fallan el build**.

| Regla                                             | Quién la aplica                  |
| ------------------------------------------------- | -------------------------------- |
| `tenant_id` solo viene del JWT, nunca del request | ESLint (`no-restricted-syntax`)  |
| Un módulo nunca importa otro módulo               | ESLint (`no-restricted-imports`) |
| Cero lógica de negocio en `apps/`                 | ESLint                           |
| `service_role` solo en Edge Functions             | `pnpm audit:secrets`             |
| El core no ramifica por id de módulo              | `pnpm audit:registry`            |
| Todo manifest cobra lo que su categoría define    | `pnpm audit:manifests`           |
| Ningún tenant ve datos de otro                    | `pnpm test:isolation` (24 casos) |
| Toda tabla tiene RLS **forzado** y política       | vista `regb.rls_coverage` + test |

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

---
name: rls-audit
description: Audita el aislamiento multi-tenant de Nexus ERP — verifica que cada tabla tenga RLS activo, política de tenant, validación de módulo activo, y que ninguna ruta o query permita fugas entre clientes. Úsalo antes de cada despliegue o cuando se pida revisar seguridad, permisos o aislamiento de datos.
---

# Auditoría de RLS y aislamiento — Nexus ERP

Una sola fuga entre tenants mata el producto. Esta auditoría es obligatoria antes de cada despliegue.

## Fase 1 — Inventario de tablas

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname in ('public','nexus','audit')
order by rowsecurity, tablename;
```

**Hallazgo CRÍTICO:** cualquier tabla con `rowsecurity = false`.

## Fase 2 — Políticas

```sql
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname in ('public','nexus')
order by tablename;
```

Por cada tabla de `public` verifica que exista una política que contenga **ambas** condiciones:

- `tenant_id = auth.tenant_id()`
- `auth.module_active('<módulo>')`

Y que las políticas de escritura tengan `with_check`, no solo `using`.
Para `nexus.*`: la política debe ser `auth.is_provider()`.

**Hallazgo CRÍTICO:** tabla con RLS activo pero sin ninguna política (bloquea todo o, peor, si hay `force row level security` mal configurado, no bloquea nada al owner).

## Fase 3 — Código

Busca en todo el repo:

| Patrón                                                                | Severidad | Por qué                          |
| --------------------------------------------------------------------- | --------- | -------------------------------- |
| `service_role`, `SERVICE_ROLE_KEY` fuera de `supabase/functions/`     | CRÍTICO   | Bypasea RLS por completo         |
| `tenant_id` leído de `req.body`, `params`, `searchParams`, `formData` | CRÍTICO   | El tenant SOLO viene del JWT     |
| `.rpc(` con `security definer` sin `set search_path = ''`             | ALTO      | Escalada por search_path         |
| Query sin filtro de tenant en Edge Function                           | ALTO      | RLS no aplica con service key    |
| Ruta de API sin verificación de permiso                               | ALTO      | Ocultar el botón no es seguridad |
| Concatenación de strings en SQL                                       | CRÍTICO   | Inyección                        |
| `dangerouslySetInnerHTML` con datos de usuario                        | ALTO      | XSS                              |
| Secreto o API key en `apps/`                                          | CRÍTICO   | Va en el bundle del cliente      |

## Fase 4 — Prueba viva

Por cada tabla, ejecuta y verifica:

1. Crea tenant A y tenant B con datos.
2. Autentica como usuario de A.
3. `select count(*)` filtrando por datos de B → **debe ser 0**.
4. `update` sobre una fila de B → **0 filas afectadas**.
5. `delete` sobre una fila de B → **0 filas afectadas**.
6. Desactiva el módulo en A (`tenant_modules.enabled = false`) → A no ve ni sus propias filas.
7. Llama al endpoint de la API directamente sin permiso en el rol → **403**, con cuerpo vacío de datos.

## Fase 5 — Impersonación

Verifica que `nexus.impersonation_log` exija: `reason` no nulo, `ended_at` se cierra, ventana ≤60 min, `write_mode` false por defecto, y que la política de acceso del proveedor dependa de una sesión de impersonación **abierta y reciente**.

## Formato del reporte

```
[CRÍTICO] Tabla public.invoices sin política de módulo activo
  Archivo:     modules/ar/migrations/policies.sql:12
  Qué pasa:    la política valida tenant pero no auth.module_active('ar')
  Explotación: un tenant que desactivó el módulo sigue leyendo sus facturas por API
  Corrección:  using (tenant_id = auth.tenant_id() and auth.module_active('ar'))
```

Ordena por severidad. Termina con un resumen: `N tablas auditadas · X críticos · Y altos · Z medios`.

**No cierres la auditoría diciendo "todo bien" sin haber ejecutado la Fase 4.** Un análisis estático no demuestra aislamiento.

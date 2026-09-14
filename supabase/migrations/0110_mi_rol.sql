-- ═══════════════════════════════════════════════════════════════════════
--  0110 — Que rol tengo (para el movil)
--
--  Hermana de `public.mis_modulos()` (0105) y por la misma razon:
--  `public.roles` si vive en `public`, pero la RLS de esa tabla deja ver
--  TODOS los roles del tenant, y el telefono solo necesita EL SUYO.
--
--  ── Para que lo quiere el movil ───────────────────────────────────────
--
--  El menu ya se filtra por modulo contratado. Falta el rol: a un cajero
--  no se le enseña "Contar inventario" si su rol no lo concede, porque
--  llevarlo a una pantalla que no puede usar es la peor forma de
--  enterarse.
--
--  Con esto, la app movil evalua `can()` de @regb/permissions con los
--  mismos datos que la web. No es una segunda implementacion: es la
--  misma, alimentada igual.
--
--  ── Esto es ergonomia, NO seguridad ───────────────────────────────────
--
--  Lo que decide de verdad es la RLS y los permisos de la base. Ocultar
--  una opcion en un menu no impide nada a quien le hable directo a
--  PostgREST — ver `docs/PERMISOS-Y-RLS.md`, seccion 3, sobre lo que
--  todavia no esta cerrado.
--
--  Se devuelve el rol COMPLETO -permisos y alcance- y no un "puede si/no"
--  por accion: preguntar accion por accion serian veinte llamadas para
--  pintar un menu.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.mi_rol()
returns table (
  id               uuid,
  name             text,
  visible_modules  text[],
  permissions      jsonb,
  scope            jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.visible_modules, r.permissions, r.scope
  from public.roles r
  where r.id = rls.role_id()
    and r.tenant_id = rls.tenant_id()
$$;

comment on function public.mi_rol() is
  'El rol del que llama, para que el movil pinte el menu con @regb/permissions. Ergonomia, no seguridad: lo que decide es la RLS. Sale de rls.role_id(), jamas de un argumento.';

revoke all on function public.mi_rol() from public;
grant execute on function public.mi_rol() to authenticated;

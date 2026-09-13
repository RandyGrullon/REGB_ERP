-- ═══════════════════════════════════════════════════════════════════════
--  0105 — Que modulos tengo activos (para el movil)
--
--  ── El problema ───────────────────────────────────────────────────────
--
--  `regb.tenant_modules` vive en el esquema `regb`. La app web no se
--  entera porque habla con Postgres directo; la app movil habla por
--  PostgREST, que solo expone `public`. Resultado: el telefono no tenia
--  forma de saber que modulos tiene contratado el cliente.
--
--  Sin ese dato, el menu del movil solo puede hacer dos cosas, y las dos
--  son malas: enseñar todas las secciones -y dar un 403 al tocar una que
--  el cliente no pago, que es la peor forma de enterarse- o llevar la
--  lista escrita a mano, que se desincroniza del catalogo el primer dia.
--
--  ── Por que funcion y no vista ────────────────────────────────────────
--
--  Una vista sobre `regb.tenant_modules` tendria que exponer esa tabla
--  entera -con `status`, fechas de prueba y lo que se le agregue
--  despues- a cualquier cliente de PostgREST. La funcion devuelve UNA
--  columna: los id que estan encendidos. Nada mas.
--
--  `security definer` con `search_path` vacio, como todo lo de este
--  repo: sin el, un esquema en el path del que llama cambia a que tabla
--  apunta `tenant_modules`.
--
--  El filtro es `rls.tenant_id()` y NUNCA un parametro. Recibir el
--  tenant por argumento seria exactamente lo que prohibe la puerta F0:
--  un id que viaja desde el cliente y decide que datos salen.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.mis_modulos()
returns table (module_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.module_id
  from regb.tenant_modules tm
  where tm.tenant_id = rls.tenant_id()
    and tm.enabled
    and tm.status in ('active', 'trial')
$$;

comment on function public.mis_modulos() is
  'Los modulos encendidos del tenant de quien llama. Para el movil, que solo ve el esquema public. El tenant sale de rls.tenant_id(), jamas de un argumento.';

revoke all on function public.mis_modulos() from public;
grant execute on function public.mis_modulos() to authenticated;

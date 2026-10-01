-- ═══════════════════════════════════════════════════════════════════════
--  0155 — El Técnico de Campo abre sus órdenes de servicio
--
--  ── El fallo ──────────────────────────────────────────────────────────
--
--  El rol de fábrica "Técnico de Campo" (0006) trae
--  `field-service.execute` y `field-service.view.assigned`, pero la
--  pantalla de Servicio en campo —y su entrada en el menú— piden
--  `field-service.view`. `view.assigned` no casa con ese permiso (el
--  evaluador no deduce `view` de `view.assigned`), así que el técnico,
--  que es justo quien trabaja las órdenes, recibía 404 en su propia
--  pantalla y no la veía en el menú. Encontrado revisando la app con cada
--  rol del área de operación.
--
--  ── Cómo ─────────────────────────────────────────────────────────────
--
--  Se le da `field-service.view` para abrir el módulo. Que vea SOLO lo
--  suyo lo decide la pantalla: quien tiene `view.assigned` y no
--  `field-service.manage` ve las órdenes con `technician_id` igual a su
--  usuario, y las acciones de ejecutar comprueban lo mismo en el
--  servidor.
--
--  Mismo patrón que 0135 y 0141: una función que solo AGREGA la clave si
--  el rol no la tiene (`nuevo || actual`, manda lo actual: si un cliente
--  se la quitó a propósito, se respeta) y una envoltura más en la cadena
--  de `provision_system_roles` para los clientes nuevos. Se buscan los
--  dos nombres del rol porque 0170 lo renombra ("Tecnico" → "Técnico") y
--  las dos migraciones pueden correr en cualquier orden.
--
--  Reversión: restaurar `provision_system_roles` desde
--  `provision_system_roles_antes_0155`, borrar
--  `regb.permisos_de_fabrica_tecnico` y quitar a mano la clave del rol si
--  hiciera falta.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.permisos_de_fabrica_tecnico(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roles
  set permissions = '{"field-service.view": true}'::jsonb || permissions
  where tenant_id = p_tenant and is_system
    and name in ('Técnico de Campo', 'Tecnico de Campo');
end;
$$;

comment on function regb.permisos_de_fabrica_tecnico(uuid) is
  'Le da al Técnico de Campo de fábrica el permiso de abrir Servicio en campo (0155). Idempotente.';

revoke all on function regb.permisos_de_fabrica_tecnico(uuid) from public;

-- 1. Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica_tecnico(t.id);
  end loop;
end $$;

-- 2. Los clientes nuevos: una envoltura más en la cadena.
alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0155;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0155(p_tenant);
  perform regb.permisos_de_fabrica_tecnico(p_tenant);
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los roles de fábrica de un tenant nuevo con lo agregado después (0135, 0138, 0141, 0155, 0170). Idempotente.';

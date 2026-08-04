-- ═══════════════════════════════════════════════════════════════════════
--  0032 · "Mi cuenta" tiene que verla todo el mundo
-- ═══════════════════════════════════════════════════════════════════════
--
--  `/perfil` declara `auth.view` y solo los roles administrativos lo
--  tenian, asi que un cajero abriendo su propia cuenta recibia un 404
--  dentro de su propio ERP.
--
--  No es un permiso de negocio: es la pantalla donde el usuario ve sus
--  datos y —lo que de verdad importa— QUE LE DEJA HACER el sistema. "No me
--  deja" es la consulta de soporte numero uno de un ERP, y casi siempre la
--  respuesta es un permiso que su rol no tiene. Que lo pueda mirar solo
--  ahorra una llamada por cada vez.
--
--  Solo AGREGA. Ningun rol pierde nada.
-- ═══════════════════════════════════════════════════════════════════════

update public.roles
set permissions = permissions || '{"auth.view": true}'::jsonb
where not (permissions ? 'auth.view')
  and not (permissions ? '*');

-- Y para los clientes que vengan. Sin esto, el primer cliente real vuelve
-- a tener el mismo 404: `provision_system_roles` es quien crea sus roles.
--
-- Se envuelve la original en vez de copiar sus 90 lineas de literales: si
-- manana se anade un rol 15, hereda la regla sin que nadie se acuerde de
-- ella. Copiar los roles aqui seria crear una segunda fuente de verdad que
-- se desincroniza en la primera edicion.
alter function regb.provision_system_roles(uuid) rename to provision_system_roles_base;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_base(p_tenant);

  -- Todo el mundo ve su propia cuenta. No es un permiso de negocio.
  update public.roles
  set permissions = permissions || '{"auth.view": true}'::jsonb
  where tenant_id = p_tenant
    and not (permissions ? 'auth.view')
    and not (permissions ? '*');
end;
$$;

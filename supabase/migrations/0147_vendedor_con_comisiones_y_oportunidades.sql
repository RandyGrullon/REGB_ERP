-- ═══════════════════════════════════════════════════════════════════════
--  0147 — El Vendedor ve sus comisiones y sus oportunidades
--
--  El Vendedor de fábrica (0006) trae `commissions.view.own`, pero
--  "Comisiones" no estaba entre sus módulos visibles: la pantalla "Mis
--  comisiones" (`/comisiones/mias`) abría escribiendo la ruta y nunca
--  salía en su menú. Y tenía `crm.*`, pero ni el módulo `pipeline` ni sus
--  permisos: un vendedor no veía sus oportunidades.
--
--  Se le agrega `commissions` y `pipeline` a lo visible, y `pipeline.view`
--  y `pipeline.manage` (mover sus oportunidades de etapa es su trabajo).
--  No se le da `commissions.view` ni `commissions.manage`: las comisiones
--  de los demás y aprobarlas no son de su nivel.
--
--  Mismo patrón que 0135, 0138, 0141 y 0161: una función que solo AGREGA
--  lo que el rol no tiene (`nuevo || actual`, manda lo actual; si el dueño
--  ya se lo quitó, se respeta), y una envoltura de `provision_system_roles`
--  con nombre propio, para que el orden de las envolturas no importe.
--
--  Reversión: restaurar `provision_system_roles` desde
--  `provision_system_roles_antes_0147` y borrar
--  `regb.permisos_de_fabrica_vendedor`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.permisos_de_fabrica_vendedor(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roles
  set permissions = '{"pipeline.view": true, "pipeline.manage": true}'::jsonb || permissions,
      visible_modules = array(
        select distinct unnest(visible_modules || array['commissions', 'pipeline'])
      )
  where tenant_id = p_tenant and is_system and name = 'Vendedor';
end;
$$;

revoke all on function regb.permisos_de_fabrica_vendedor(uuid) from public;

alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0147;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0147(p_tenant);
  perform regb.permisos_de_fabrica_vendedor(p_tenant);
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los roles de fabrica de un tenant nuevo (0006) con lo agregado despues (0135, 0138, 0141, 0147, 0161, 0170). Idempotente.';

-- Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica_vendedor(t.id);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  0141 — El Almacenista registra los lotes de lo que recibe
--
--  El Almacenista ("Recibe, transfiere y cuenta") ve /lotes en su menu y
--  es quien tiene la mercancia en la mano al recibirla, pero solo tenia
--  `lots-serials.view`: la fecha de vencimiento y el lote de lo que entraba
--  los tenia que registrar el dueño. Se le da `lots-serials.manage`. El
--  retiro de un lote del mercado (`lots-serials.recall`) sigue siendo una
--  decision de otro nivel.
--
--  Mismo patron que 0135 y 0138: una funcion que solo AGREGA lo que el rol
--  no tiene (`nuevo || actual`, manda lo actual) -si un cliente ya se lo
--  quito a proposito, se respeta- y una envoltura de
--  `provision_system_roles` con nombre propio, para que el orden de las
--  envolturas no importe.
--
--  Reversion: restaurar `provision_system_roles` desde
--  `provision_system_roles_antes_0141` y borrar
--  `regb.permisos_de_fabrica_lotes`. La clave agregada se quita a mano del
--  rol si hiciera falta.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.permisos_de_fabrica_lotes(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roles
  set permissions = '{"lots-serials.manage": true}'::jsonb || permissions
  where tenant_id = p_tenant and is_system and name = 'Almacenista';
end;
$$;

revoke all on function regb.permisos_de_fabrica_lotes(uuid) from public;

alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0141;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0141(p_tenant);
  perform regb.permisos_de_fabrica_lotes(p_tenant);
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los roles de fabrica de un tenant nuevo (0006) con lo agregado despues (0135, 0138, 0141). Idempotente.';

-- Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica_lotes(t.id);
  end loop;
end $$;

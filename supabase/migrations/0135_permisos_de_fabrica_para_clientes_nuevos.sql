-- ═══════════════════════════════════════════════════════════════════════
--  0135 — Los roles de fabrica que reciben los clientes NUEVOS
--
--  ── El fallo ──────────────────────────────────────────────────────────
--
--  0025 le dio al Cajero `pos.view` y `pos.report.view`, al Vendedor los
--  pedidos, al Contador la cartera... con `update public.roles ... where
--  is_system`. Eso cambio los roles que EXISTIAN ese dia. Pero los roles de
--  un cliente nuevo los crea `regb.provision_system_roles()` desde la
--  plantilla de 0006, que nadie toco. 0032 si lo hizo bien (envolvio la
--  plantilla); 0025 no.
--
--  Resultado: todo cliente creado despues de 0025 -los dos de la demo, las
--  pruebas, y cada cliente real que se de de alta- nace con los roles
--  VIEJOS. Encontrado usando la app: el Cajero no podia abrir el ticket que
--  acababa de cobrar (404 por `pos.report.view`).
--
--  ── Y dos cosas que la plantilla nunca tuvo ──────────────────────────
--
--  * El descuento del Cajero no funcionaba nunca: tenia `pos.discount.max:
--    10` pero no `pos.discount`, y la caja exige `pos.discount` para
--    cualquier descuento. `/perfil` le decia "hasta 10". La intencion de
--    0006 es clara -hasta 10%-; ahora se cumple y el tope se comprueba en
--    el servidor (`cobrarVenta`).
--  * El Almacenista ("Recibe, transfiere y cuenta") y el Comprador tienen
--    en su menu recepciones, traslados, conteos, codigos de barra, lotes y
--    requisiciones, pero ningun permiso de esos modulos: 404 en cada uno.
--
--  ── Como ─────────────────────────────────────────────────────────────
--
--  Una sola funcion, `regb.permisos_de_fabrica(tenant)`, es la fuente de
--  verdad de lo que se agrega. La llaman la plantilla (clientes nuevos) y
--  esta misma migracion (clientes existentes). La proxima vez que un modulo
--  necesite un permiso de fabrica, se agrega AQUI y llega a los dos.
--
--  Solo AGREGA claves que el rol no tiene: `nuevo || actual`, donde manda
--  lo actual. Si un cliente le quito un permiso a su Cajero, se queda
--  quitado. Ninguna denegacion se toca (§8.1).
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.permisos_de_fabrica(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ── Cajero: su caja, sus tickets y descontar hasta su tope ───────────
  update public.roles
  set permissions = '{"pos.view": true, "pos.report.view": true, "products.view": true,
                      "pos.discount": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['products']))
  where tenant_id = p_tenant and is_system and name = 'Cajero';

  -- ── Vendedor: toma pedidos y ve lo que el cliente debe (0025) ────────
  update public.roles
  set permissions = '{"sales-orders.view": true, "sales-orders.edit": true,
                      "sales-orders.confirm": true, "sales-orders.customers.manage": true,
                      "sales-orders.discount": false, "ar.view": true,
                      "products.view": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['ar','products']))
  where tenant_id = p_tenant and is_system and name = 'Vendedor';

  -- ── Almacenista: recibe, transfiere y cuenta, como dice su descripcion ─
  update public.roles
  set permissions = '{"sales-orders.view": true, "sales-orders.deliver": true,
                      "products.view": true,
                      "receipts.view": true, "receipts.receive": true, "receipts.return": true,
                      "transfers.view": true, "transfers.create": true,
                      "transfers.dispatch": true, "transfers.receive": true,
                      "stock-counts.view": true, "stock-counts.count": true,
                      "barcode.view": true, "barcode.scan": true,
                      "lots-serials.view": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['sales-orders','products']))
  where tenant_id = p_tenant and is_system and name = 'Almacenista';

  -- ── Comprador: pide, compra y recibe; aprobar sigue siendo de gerencia ─
  update public.roles
  set permissions = '{"requisitions.view": true, "requisitions.request": true,
                      "receipts.view": true, "receipts.receive": true}'::jsonb || permissions
  where tenant_id = p_tenant and is_system and name = 'Comprador';

  -- ── Contador: la cartera completa, sin tocar la operacion (0025) ─────
  --  Y lo fiscal de la caja (0129): en un colmado solo con `pos`, sin
  --  `pos.export` ni `pos.ncf.manage` el contador no podia bajar el 607 ni
  --  cargar los NCF, que es justo su trabajo.
  update public.roles
  set permissions = '{"ar.view": true, "ar.invoice.create": true, "ar.payment.record": true,
                      "ar.export": true, "sales-orders.view": true, "inventory.view": true,
                      "inventory.cost.view": true,
                      "pos.export": true, "pos.ncf.manage": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['ar','sales-orders','inventory','pos']))
  where tenant_id = p_tenant and is_system and name = 'Contador';

  -- ── Gerentes: todo lo de F4 (0025) ───────────────────────────────────
  update public.roles
  set permissions = '{"sales-orders.*": true, "ar.*": true, "pos.*": true,
                      "inventory.*": true, "products.*": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(
        visible_modules || array['sales-orders','ar','pos','inventory','products']))
  where tenant_id = p_tenant and is_system and name in ('Gerente General', 'Gerente de Sucursal');

  -- ── Empleado: su propio portal ───────────────────────────────────────
  --  0006 le dio `hr-portal.view.own`, un permiso que ninguna ruta pide:
  --  `/portal` exige `hr-portal.view`, asi que el Empleado recibia 404 en SU
  --  portal. Darle `hr-portal.view` es seguro: desde 0132 el portal solo
  --  lee al empleado vinculado a la cuenta (`employees.user_id`) y sus
  --  volantes por `mis_volantes()`, nunca los de otro.
  update public.roles
  set permissions = '{"hr-portal.view": true, "hr-portal.request-time-off": true,
                      "hr-portal.edit-profile": true}'::jsonb || permissions
  where tenant_id = p_tenant and is_system and name = 'Empleado';

  -- ── Auditor: lee, no escribe (0025) ──────────────────────────────────
  update public.roles
  set permissions = '{"sales-orders.view": true, "ar.view": true,
                      "pos.report.view": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['sales-orders','ar','pos']))
  where tenant_id = p_tenant and is_system and name = 'Auditor';
end;
$$;

revoke all on function regb.permisos_de_fabrica(uuid) from public;

-- La plantilla de los clientes nuevos, envuelta igual que en 0032: la
-- funcion anterior sigue siendo la que crea los roles; esta les agrega lo
-- que les faltaba.
alter function regb.provision_system_roles(uuid) rename to provision_system_roles_0032;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_0032(p_tenant);
  perform regb.permisos_de_fabrica(p_tenant);
end;
$$;

-- Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica(t.id);
  end loop;
end $$;

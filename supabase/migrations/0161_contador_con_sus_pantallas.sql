-- ═══════════════════════════════════════════════════════════════════════
--  0161 — El Contador abre todas las pantallas de finanzas
--
--  ── El fallo ──────────────────────────────────────────────────────────
--
--  0006 le puso al Contador en el menú activos fijos, presupuestos,
--  centros de costo, facturación electrónica y BI (`visible_modules`),
--  pero ningún permiso de esos módulos: solo `accounting.*`, `taxes.*`,
--  `ap.*`, `treasury.*` y `bank-rec.*`. Cada una de esas pantallas le daba
--  "No encontramos esta pantalla" (la ruta exige `<módulo>.view`). Y
--  monedas y consolidación, que son trabajo de contador -la tasa del día y
--  el estado del grupo-, ni siquiera estaban en su menú.
--
--  ── Qué cambia ───────────────────────────────────────────────────────
--
--  Se le dan esos módulos completos al Contador, y monedas y consolidación
--  entran en su menú. Mismo patrón que 0135, 0138 y 0141: una función que
--  solo AGREGA lo que el rol no tiene (`nuevo || actual`, manda lo actual:
--  si un cliente se lo quitó a propósito, se respeta) y una envoltura de
--  `provision_system_roles` con nombre propio, para que el orden de las
--  envolturas no importe.
--
--  Reversión: restaurar `provision_system_roles` desde
--  `provision_system_roles_antes_0161` y borrar
--  `regb.permisos_de_fabrica_finanzas`. Las claves agregadas se quitan a
--  mano del rol si hiciera falta.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.permisos_de_fabrica_finanzas(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.roles
  set permissions = '{"fixed-assets.*": true, "budgets.*": true, "cost-centers.*": true,
                      "e-invoice.*": true, "bi.*": true, "multicurrency.*": true,
                      "consolidation.*": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(
        visible_modules || array['fixed-assets', 'budgets', 'cost-centers', 'e-invoice', 'bi',
                                 'multicurrency', 'consolidation']))
  where tenant_id = p_tenant and is_system and name = 'Contador';
end;
$$;

revoke all on function regb.permisos_de_fabrica_finanzas(uuid) from public;

alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0161;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0161(p_tenant);
  perform regb.permisos_de_fabrica_finanzas(p_tenant);
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los roles de fábrica de un tenant nuevo (0006) con lo agregado después (0135, 0138, 0141, 0161). Idempotente.';

-- Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica_finanzas(t.id);
  end loop;
end $$;

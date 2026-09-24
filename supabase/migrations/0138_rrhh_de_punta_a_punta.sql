-- ═══════════════════════════════════════════════════════════════════════
--  0138 — RRHH de punta a punta: lo que su menu promete, lo puede abrir
--
--  ── El fallo (encontrado usando la app como RRHH de la demo) ──────────
--
--  * RRHH tiene en su menu vacaciones, gastos, beneficios, reclutamiento,
--    desempeno y capacitacion (0006), pero solo permisos de empleados,
--    nomina y asistencia: 404 en /vacaciones, /gastos, /beneficios,
--    /reclutamiento, /desempeno y /capacitacion. Nadie que no fuera el
--    Owner podia aprobar unas vacaciones o reembolsar un gasto. Y los
--    anuncios del portal -"lo que RRHH publica, todos lo ven" (0132)- solo
--    los podia publicar el Owner.
--
--  * El Empleado tiene `expenses.create`, un permiso que ningun modulo
--    declara: el manifest de gastos y `reportar_gasto()` (0132) piden
--    `expenses.submit`. Su descripcion dice "sus gastos", pero la app
--    movil le escondia Gastos y la base le rechazaba el reporte.
--
--  * El Gerente de Sucursal tiene `*.view` (0006) y con eso abria
--    /payroll y los volantes de TODA la empresa -el salario del gerente
--    general incluido-, aunque nomina nunca estuvo en su menu. Se le
--    niega `payroll.view` y `payroll.export` de forma explicita: su
--    `*.view` sigue valiendo para todo lo demas.
--
--  ── Como ─────────────────────────────────────────────────────────────
--
--  Igual que 0135: una funcion que solo AGREGA claves que el rol no tiene
--  (`nuevo || actual`, manda lo actual), llamada por la plantilla de los
--  clientes nuevos y por esta migracion para los que ya existen. Si un
--  cliente ya le habia dado o quitado algo de esto a su rol, se respeta.
--
--  No se reemplaza `regb.permisos_de_fabrica()` (0135): otra migracion
--  puede estar agregandole lo suyo. Se envuelve `provision_system_roles`
--  con un nombre propio, para que el orden de las envolturas no importe.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.permisos_de_fabrica_rrhh(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ── RRHH: todo lo que su menu ya le enseñaba, y los anuncios ─────────
  update public.roles
  set permissions = '{"time-off.*": true, "expenses.*": true, "benefits.*": true,
                      "recruiting.*": true, "performance.*": true, "training.*": true,
                      "hr-portal.view": true,
                      "hr-portal.manage-announcements": true}'::jsonb || permissions,
      visible_modules = array(select distinct unnest(visible_modules || array['hr-portal']))
  where tenant_id = p_tenant and is_system and name = 'RRHH';

  -- ── Empleado: reportar SUS gastos (app movil y reportar_gasto()) ─────
  update public.roles
  set permissions = '{"expenses.submit": true}'::jsonb || permissions
  where tenant_id = p_tenant and is_system and name = 'Empleado';

  -- ── Gerente de Sucursal: la nomina de la empresa no es de su sucursal ─
  update public.roles
  set permissions = '{"payroll.view": false, "payroll.export": false}'::jsonb || permissions
  where tenant_id = p_tenant and is_system and name = 'Gerente de Sucursal';
end;
$$;

revoke all on function regb.permisos_de_fabrica_rrhh(uuid) from public;

alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0138;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0138(p_tenant);
  perform regb.permisos_de_fabrica_rrhh(p_tenant);
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los roles de fabrica de un tenant nuevo (0006) con lo agregado despues (0135, 0138). Idempotente.';

-- Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.permisos_de_fabrica_rrhh(t.id);
  end loop;
end $$;

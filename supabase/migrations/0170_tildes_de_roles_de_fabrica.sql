-- ═══════════════════════════════════════════════════════════════════════
--  0170 — Los roles de fábrica, con tildes
--
--  Los 14 roles que recibe cada cliente (0006) se escribieron sin tildes:
--  "Tecnico de Campo", "Dueno del negocio", "la facturacion de REGB",
--  "consulta margenes". Salen en Roles y permisos, en el selector de rol de
--  Usuarios y en la invitación que recibe cada persona. Es lo primero que
--  lee el dueño cuando arma su equipo, y se lee descuidado.
--
--  Lo que cambia es SOLO texto visible: el nombre de un rol (uno) y las
--  descripciones. Ningún permiso, alcance ni módulo visible.
--
--  ── Cómo, sin pisar a nadie ───────────────────────────────────────────
--
--  1. Clientes que ya existen: se corrige la descripción SOLO si sigue
--     siendo el texto de fábrica (una que el dueño escribió no se toca), y
--     el rol se renombra solo si es de sistema.
--  2. Clientes nuevos: `provision_system_roles` es una cadena de
--     envolturas (0130, 0136, 0138, 0141...). Se sigue el mismo patrón: la
--     actual pasa a `_antes_0170` y la nueva la llama y después corrige
--     los textos. Así no se reescribe el cuerpo de nadie.
--  3. Reaprovisionar un cliente que ya pasó por aquí (la cadena es
--     idempotente con `on conflict (tenant_id, name) do nothing`): la
--     envoltura vieja vuelve a insertar "Tecnico de Campo" porque el nombre
--     ya no choca. Se borra ese duplicado recién creado —no tiene a nadie—
--     en vez de dejar dos técnicos en la lista.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.tildes_de_roles_de_fabrica(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El nombre: renombrar si no existe ya el bueno; si existe, el viejo es
  -- un duplicado recién reaprovisionado y sin miembros.
  if exists (select 1 from public.roles
             where tenant_id = p_tenant and name = 'Técnico de Campo') then
    delete from public.roles r
    where r.tenant_id = p_tenant and r.name = 'Tecnico de Campo' and r.is_system
      and not exists (select 1 from public.memberships m where m.role_id = r.id)
      and not exists (select 1 from public.user_invitations i where i.role_id = r.id);
  else
    update public.roles set name = 'Técnico de Campo'
    where tenant_id = p_tenant and name = 'Tecnico de Campo' and is_system;
  end if;

  -- Las descripciones, solo si siguen siendo las de fábrica.
  update public.roles r
  set description = d.nueva
  from (values
    ('Dueno del negocio. Acceso total, incluida la suscripcion.',
     'Dueño del negocio. Acceso total, incluida la suscripción.'),
    ('Administra todo menos la facturacion de REGB.',
     'Administra todo menos la facturación de REGB.'),
    ('Ve todas las sucursales, aprueba y consulta margenes.',
     'Ve todas las sucursales, aprueba y consulta márgenes.'),
    ('Contabilidad, impuestos y conciliacion.',
     'Contabilidad, impuestos y conciliación.'),
    ('Cotiza y vende. No ve costos ni margenes.',
     'Cotiza y vende. No ve costos ni márgenes.'),
    ('Requisiciones, RFQ, ordenes de compra y proveedores.',
     'Requisiciones, cotizaciones y órdenes de compra; proveedores.'),
    ('Empleados, nomina, asistencia y contratacion.',
     'Empleados, nómina, asistencia y contratación.'),
    ('Ejecuta ordenes de servicio y consume repuestos.',
     'Ejecuta órdenes de servicio y consume repuestos.')
  ) as d(vieja, nueva)
  where r.tenant_id = p_tenant and r.is_system and r.description = d.vieja;
end;
$$;

comment on function regb.tildes_de_roles_de_fabrica(uuid) is
  'Corrige nombre y descripciones de los roles de fábrica de un cliente (0170). Idempotente.';

revoke all on function regb.tildes_de_roles_de_fabrica(uuid) from public;

-- 1. Los clientes que ya existen.
do $$
declare
  t record;
begin
  for t in select id from regb.tenants loop
    perform regb.tildes_de_roles_de_fabrica(t.id);
  end loop;
end $$;

-- 2. Los clientes nuevos: una envoltura más en la cadena.
alter function regb.provision_system_roles(uuid) rename to provision_system_roles_antes_0170;

create or replace function regb.provision_system_roles(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles_antes_0170(p_tenant);
  perform regb.tildes_de_roles_de_fabrica(p_tenant);
end;
$$;

comment on function regb.provision_system_roles(uuid) is
  'Crea los 14 roles de §8.2 para un tenant nuevo, con sus textos en castellano (0170). Idempotente.';

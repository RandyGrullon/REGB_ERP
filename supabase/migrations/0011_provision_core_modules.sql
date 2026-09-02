-- ═══════════════════════════════════════════════════════════════════════
--  0011 — Los modulos core se activan solos
--
--  §6.1: "15 core (incluidos en todos los planes)". Hasta ahora un cliente
--  nuevo nacia SIN ellos, asi que `rls.module_active('rbac')` era false
--  para todo el mundo y nadie podia ni editar sus propios roles.
--
--  El sintoma era raro y el diagnostico no: los core no son algo que se
--  compre, son el suelo del producto. Deben existir desde el minuto uno.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function regb.provision_core_modules(p_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
  select p_tenant, mc.id, 'active', true
  from regb.module_catalog mc
  where mc.category = 'core'
  on conflict (tenant_id, module_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function regb.provision_core_modules(uuid) is
  'Activa los modulos core de un cliente. Idempotente. Los core no se compran: vienen con el plan (§6.1).';

-- ── Se enganchan al alta del cliente ───────────────────────────────────
--  Reemplaza a la version de 0006, que solo creaba roles y onboarding.
create or replace function regb.on_tenant_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform regb.provision_system_roles(new.id);
  perform regb.provision_core_modules(new.id);

  insert into regb.onboarding (tenant_id, stage) values (new.id, 'sold')
    on conflict (tenant_id) do nothing;

  return new;
end;
$$;

-- ── Backfill: los clientes que ya existen ──────────────────────────────
do $$
declare
  t record;
  n integer;
begin
  for t in select id, slug from regb.tenants loop
    n := regb.provision_core_modules(t.id);
    if n > 0 then
      raise notice 'Cliente % : % modulos core activados', t.slug, n;
    end if;
  end loop;
end $$;

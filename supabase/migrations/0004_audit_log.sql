-- ═══════════════════════════════════════════════════════════════════════
--  0004 — Auditoria
--
--  "Todo evento se audita" (§2.2). Particionada por mes desde el dia uno:
--  reparticionar una tabla de 200M de filas en produccion no es opcion.
-- ═══════════════════════════════════════════════════════════════════════

create table audit.log (
  id         bigint generated always as identity,
  tenant_id  uuid not null,
  user_id    uuid,
  module_id  text,
  entity     text not null,
  entity_id  uuid,
  action     text not null
               check (action in ('create','update','delete','approve','reject',
                                 'export','login','logout','impersonate','activate','deactivate')),
  before     jsonb,
  after      jsonb,
  ip         inet,
  user_agent text,
  platform   text check (platform in ('web','desktop','mobile','api','system')),
  at         timestamptz not null default now(),
  primary key (id, at)
) partition by range (at);

create index on audit.log (tenant_id, at desc);
create index on audit.log (tenant_id, entity, entity_id);
create index on audit.log (tenant_id, user_id, at desc);

comment on table audit.log is
  'Bitacora inmutable. Sin update ni delete: solo insert por trigger y select auditado.';

-- ── Particiones ────────────────────────────────────────────────────────
create or replace function audit.ensure_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'log_' || to_char(v_start, 'YYYY_MM');
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'audit' and c.relname = v_name
  ) then
    execute format(
      'create table audit.%I partition of audit.log for values from (%L) to (%L)',
      v_name, v_start, v_end
    );

    -- CRITICO: la RLS del padre NO protege una consulta dirigida a la
    -- particion hija. Sin estas tres lineas, `select * from audit.log_2026_07`
    -- devuelve la bitacora de TODOS los tenants. Cada particion se protege sola.
    execute format('alter table audit.%I enable row level security', v_name);
    execute format('alter table audit.%I force row level security', v_name);
    execute format(
      'create policy tenant_reads_own_audit on audit.%I for select
         using (tenant_id = auth.tenant_id() or auth.is_provider())', v_name);
    execute format('grant select on audit.%I to authenticated', v_name);
  end if;
end;
$$;

-- Mes actual y los tres siguientes, para que nunca falte particion.
do $$
declare i integer;
begin
  for i in 0..3 loop
    perform audit.ensure_partition((current_date + (i || ' month')::interval)::date);
  end loop;
end $$;

-- ── Trigger generico de auditoria ──────────────────────────────────────
--  Se engancha a cualquier tabla que tenga tenant_id:
--    create trigger audit_me after insert or update or delete on public.x
--      for each row execute function audit.record('<module_id>');
create or replace function audit.record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module   text := coalesce(tg_argv[0], 'core');
  v_tenant   uuid;
  v_entity   uuid;
  v_action   text;
  v_before   jsonb;
  v_after    jsonb;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_tenant := (v_before ->> 'tenant_id')::uuid;
    v_entity := (v_before ->> 'id')::uuid;
    v_action := 'delete';
  else
    v_after  := to_jsonb(new);
    v_tenant := (v_after ->> 'tenant_id')::uuid;
    v_entity := (v_after ->> 'id')::uuid;
    if tg_op = 'UPDATE' then
      v_before := to_jsonb(old);
      v_action := 'update';
      -- Soft delete se audita como borrado, que es lo que el usuario hizo.
      if v_before ->> 'deleted_at' is null and v_after ->> 'deleted_at' is not null then
        v_action := 'delete';
      end if;
    else
      v_action := 'create';
    end if;
  end if;

  insert into audit.log (tenant_id, user_id, module_id, entity, entity_id, action, before, after)
  values (v_tenant, auth.nexus_uid(), v_module, tg_table_name, v_entity, v_action, v_before, v_after);

  return coalesce(new, old);
end;
$$;

comment on function audit.record() is
  'Trigger generico. Uso: for each row execute function audit.record(''inventory'').';
